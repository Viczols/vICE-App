import { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs/promises";
import { db } from "../db";
import { voicePresence } from "../services/voicePresence";
import {
  SERVER_PERMISSION_KEYS,
  canActOnTargetUser,
  getDefaultServerRoleId,
  getServerMemberPermissionState,
  getServerRoleById,
  getVisibleServerMembersWithRoles,
  hasServerPermission,
  requireServerPermission,
  type ServerPermission,
} from "../services/serverPermissions";
import { createGeneralAuditLog } from "../services/auditLogService";

function generateInviteCode(length = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function normalizeRole(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function canManageServer(role: unknown) {
  const normalized = normalizeRole(role);
  return normalized === "owner" || normalized === "admin";
}

function emitServerEvent(app: any, serverId: string, payload: any) {
  try {
    const fn =
      app?.emitServerEvent ||
      app?.broadcastServerEvent ||
      app?.wsHub?.broadcastServerEvent ||
      app?.wsHub?.broadcastToServer;

    if (typeof fn === "function") {
      fn.call(app?.wsHub ?? app, serverId, payload);
    }
  } catch (error) {
    app?.log?.error?.(error, "server event broadcast failed");
  }
}

async function getServerMemberUserIds(serverId: string) {
  const result = await db.query(
    `SELECT user_id
     FROM server_members
     WHERE server_id = $1`,
    [serverId]
  );
  return result.rows.map((row) => String(row.user_id));
}

async function getPendingServerInviteTargetUserIds(serverId: string) {
  const result = await db.query(
    `SELECT target_user_id
     FROM server_user_invites
     WHERE server_id = $1
       AND status = 'pending'`,
    [serverId]
  );

  return result.rows.map((row) => String(row.target_user_id));
}

function emitServersUpdated(
  app: any,
  userIds: string[],
  serverId: string,
  reason: string
) {
  try {
    app?.broadcastWs?.({
      type: "SERVERS_UPDATED",
      payload: {
        userIds,
        serverId,
        reason,
      },
    });
  } catch (error) {
    app?.log?.error?.(error, "servers updated broadcast failed");
  }
}

async function forceLeaveFromServerVoice(
  app: any,
  serverId: string,
  targetUserId: string
) {
  try {
    const targetPresence = voicePresence.getByUserId(targetUserId);
    if (!targetPresence) return;

    const channelRes = await db.query(
      `SELECT server_id
       FROM channels
       WHERE id = $1
       LIMIT 1`,
      [targetPresence.channelId]
    );

    if ((channelRes.rowCount ?? 0) === 0) return;

    const channelServerId = String(channelRes.rows[0].server_id ?? "");
    if (!channelServerId || channelServerId !== serverId) return;

    const existing = voicePresence.leave(targetUserId);
    if (!existing) return;

    app?.broadcastWs?.({
      type: "VOICE_LEFT",
      payload: {
        channelId: existing.channelId,
        userId: targetUserId,
      },
    });

    if (typeof app?.broadcastVoiceSnapshot === "function") {
      await app.broadcastVoiceSnapshot();
    }
  } catch (error) {
    app?.log?.error?.(error, "forceLeaveFromServerVoice failed");
  }
}

function sanitizeFileStem(value: string) {
  return (
    String(value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "server-avatar"
  );
}

function getAvatarExtension(mimetype: string, filename?: string | null) {
  const loweredMime = String(mimetype || "").toLowerCase();
  const loweredFilename = String(filename || "").toLowerCase();

  if (loweredMime.includes("png") || loweredFilename.endsWith(".png")) {
    return "png";
  }

  if (
    loweredMime.includes("jpeg") ||
    loweredMime.includes("jpg") ||
    loweredFilename.endsWith(".jpg") ||
    loweredFilename.endsWith(".jpeg")
  ) {
    return "jpg";
  }

  if (loweredMime.includes("webp") || loweredFilename.endsWith(".webp")) {
    return "webp";
  }

  return null;
}

async function deletePreviousAvatarIfLocal(avatarUrl: string | null | undefined) {
  const normalized = String(avatarUrl ?? "").trim();
  if (!normalized.startsWith("/uploads/avatars/")) {
    return;
  }

  const filename = normalized.split("/").pop();
  if (!filename) return;

  const filepath = path.join(process.cwd(), "uploads", "avatars", filename);

  try {
    await fs.unlink(filepath);
  } catch {}
}

function sanitizeRoleColor(value: unknown) {
  const color = String(value ?? "").trim();
  if (!color) return null;
  if (!/^#([0-9a-fA-F]{6})$/.test(color)) return null;
  return color;
}

function normalizePermissionsInput(value: unknown) {
  const result: Record<string, boolean> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return result;
  }

  for (const key of SERVER_PERMISSION_KEYS) {
    result[key] = (value as Record<string, unknown>)[key] === true;
  }

  return result;
}

function getActorRoleManagementCeiling(state: Awaited<ReturnType<typeof getServerMemberPermissionState>>) {
  if (!state) return -Infinity;
  if (state.isOwner) return Number.POSITIVE_INFINITY;
  const highestPosition = Number(state.highestRole?.position ?? 0);
  return highestPosition - 1;
}

function canActorGrantPermissions(
  state: Awaited<ReturnType<typeof getServerMemberPermissionState>>,
  requestedPermissions: Record<string, boolean>
) {
  if (!state) return false;
  if (state.isOwner) return true;

  for (const key of SERVER_PERMISSION_KEYS) {
    if (requestedPermissions[key] === true && state.permissions[key] !== true) {
      return false;
    }
  }

  return true;
}

async function isServerOwner(serverId: string, userId: string) {
  const result = await db.query(
    `SELECT 1
     FROM servers
     WHERE id = $1 AND owner_id = $2
     LIMIT 1`,
    [serverId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

async function reconcileBuiltInRolesForServer(serverId: string) {
  await db.query(
    `UPDATE server_roles
     SET color = NULL,
         is_managed = true,
         is_default = false,
         updated_at = NOW()
     WHERE server_id = $1
       AND lower(name) = 'owner'`,
    [serverId]
  );

  await db.query(
    `UPDATE server_roles
     SET is_managed = false,
         is_default = true,
         updated_at = NOW()
     WHERE server_id = $1
       AND lower(name) = 'member'`,
    [serverId]
  );

  await db.query(
    `DELETE FROM server_member_roles
     WHERE server_id = $1
       AND role_id IN (
         SELECT id
         FROM server_roles
         WHERE server_id = $1
           AND lower(name) = 'admin'
       )`,
    [serverId]
  );

  await db.query(
    `DELETE FROM server_roles
     WHERE server_id = $1
       AND lower(name) = 'admin'`,
    [serverId]
  );

  await db.query(
    `INSERT INTO server_member_roles (server_id, user_id, role_id)
     SELECT sm.server_id, sm.user_id, sr.id
     FROM server_members sm
     JOIN server_roles sr
       ON sr.server_id = sm.server_id
      AND lower(sr.name) = 'owner'
     JOIN servers s
       ON s.id = sm.server_id
      AND s.owner_id = sm.user_id
     WHERE sm.server_id = $1
     ON CONFLICT DO NOTHING`,
    [serverId]
  );

  await db.query(
    `INSERT INTO server_member_roles (server_id, user_id, role_id)
     SELECT sm.server_id, sm.user_id, sr.id
     FROM server_members sm
     JOIN server_roles sr
       ON sr.server_id = sm.server_id
      AND sr.is_default = true
     WHERE sm.server_id = $1
       AND NOT EXISTS (
         SELECT 1
         FROM server_member_roles smr
         WHERE smr.server_id = sm.server_id
           AND smr.user_id = sm.user_id
           AND smr.role_id = sr.id
       )`,
    [serverId]
  );
}

async function ensureDefaultMemberRoleAssigned(serverId: string, userId: string) {
  const defaultRoleId = await getDefaultServerRoleId(serverId);
  if (!defaultRoleId) return;

  await db.query(
    `INSERT INTO server_member_roles (server_id, user_id, role_id)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [serverId, userId, defaultRoleId]
  );
}

async function createBuiltInRolesForServer(serverId: string) {
  const existing = await db.query(
    `SELECT name
     FROM server_roles
     WHERE server_id = $1`,
    [serverId]
  );

  const existingNames = new Set(
    existing.rows.map((row) => String(row.name ?? "").toLowerCase())
  );

  if (!existingNames.has("owner")) {
    await db.query(
      `INSERT INTO server_roles (
         id, server_id, name, color, position, permissions, is_default, is_managed
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
      [
        randomUUID(),
        serverId,
        "Owner",
        null,
        1000,
        JSON.stringify(
          SERVER_PERMISSION_KEYS.reduce<Record<string, boolean>>((acc, key) => {
            acc[key] = true;
            return acc;
          }, {})
        ),
        false,
        true,
      ]
    );
  }

  if (!existingNames.has("member")) {
    await db.query(
      `INSERT INTO server_roles (
         id, server_id, name, color, position, permissions, is_default, is_managed
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
      [
        randomUUID(),
        serverId,
        "Member",
        null,
        0,
        JSON.stringify({
          view_channel: true,
          send_messages: true,
          connect: true,
          speak: true,
        }),
        true,
        false,
      ]
    );
  }
}

async function assignBuiltInOwnerRole(serverId: string, userId: string) {
  const ownerRole = await db.query(
    `SELECT id
     FROM server_roles
     WHERE server_id = $1
       AND lower(name) = 'owner'
     LIMIT 1`,
    [serverId]
  );

  const ownerRoleId = ownerRole.rows[0]?.id ? String(ownerRole.rows[0].id) : null;
  if (!ownerRoleId) return;

  await db.query(
    `INSERT INTO server_member_roles (server_id, user_id, role_id)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [serverId, userId, ownerRoleId]
  );
}

async function removeAllMemberRoles(serverId: string, userId: string) {
  await db.query(
    `DELETE FROM server_member_roles
     WHERE server_id = $1 AND user_id = $2`,
    [serverId, userId]
  );
}

export async function serverRoutes(app: FastifyInstance) {
  app.post("/", { preHandler: [app.auth] }, async (req: any, reply) => {
    const u = req.user as any;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
    const { name } = req.body ?? {};

    if (!userId) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    if (!name || String(name).trim().length < 2) {
      return reply.code(400).send({ error: "SERVER_NAME_REQUIRED" });
    }

    const serverId = randomUUID();
    const trimmedName = String(name).trim();
    const inviteId = randomUUID();
    const inviteCode = generateInviteCode(8);

    const defaultTextChannelId = randomUUID();
    const defaultVoiceChannelId = randomUUID();

    await db.query("BEGIN");

    try {
      await db.query(
        `INSERT INTO servers (id, name, owner_id, avatar_url)
         VALUES ($1, $2, $3, $4)`,
        [serverId, trimmedName, userId, null]
      );

      await db.query(
        `INSERT INTO server_members (server_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [serverId, userId]
      );

      await createBuiltInRolesForServer(serverId);
      await reconcileBuiltInRolesForServer(serverId);
      await assignBuiltInOwnerRole(serverId, userId);

      await db.query(
        `INSERT INTO invites (id, code, server_id, created_by, max_uses, uses)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [inviteId, inviteCode, serverId, userId, 999999, 0]
      );

      await db.query(
        `INSERT INTO channels (id, server_id, name, type, is_private, created_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [defaultTextChannelId, serverId, "general", "text", false]
      );

      await db.query(
        `INSERT INTO channels (id, server_id, name, type, is_private, created_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [defaultVoiceChannelId, serverId, "General Voice", "voice", false]
      );

      await db.query("COMMIT");

      emitServersUpdated(app, [userId], serverId, "created");

      return {
        id: serverId,
        name: trimmedName,
        ownerId: userId,
        avatarUrl: null,
        inviteCode,
        defaultChannels: [
          {
            id: defaultTextChannelId,
            name: "general",
            type: "text",
          },
          {
            id: defaultVoiceChannelId,
            name: "General Voice",
            type: "voice",
          },
        ],
      };
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  });

  app.get("/my", { preHandler: [app.auth] }, async (req: any, reply) => {
    const u = req.user as any;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");

    if (!userId) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    const { rows } = await db.query(
      `SELECT s.id, s.name, s.owner_id, s.avatar_url
       FROM servers s
       JOIN server_members sm
         ON sm.server_id = s.id
       WHERE sm.user_id = $1
       AND NOT EXISTS (
         SELECT 1
         FROM server_bans sb
         WHERE sb.server_id = s.id
           AND sb.user_id = $1
       )
       ORDER BY s.created_at ASC`,
      [userId]
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      ownerId: row.owner_id,
      avatarUrl: row.avatar_url ?? null,
    }));
  });

  app.get("/:id/permissions", { preHandler: [app.auth] }, async (req: any, reply) => {
    const serverId = String(req.params.id);
    const u = req.user as any;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");

    if (!userId) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    await reconcileBuiltInRolesForServer(serverId);

    await reconcileBuiltInRolesForServer(serverId);

    const memberState = await getServerMemberPermissionState(serverId, userId);
    if (!memberState) {
      return reply.code(403).send({ error: "NOT_A_SERVER_MEMBER" });
    }

    return {
      canManageServer:
        memberState.permissions.manage_server === true ||
        memberState.permissions.administrator === true ||
        memberState.isOwner === true,
      canManageRoles:
        memberState.permissions.manage_roles === true ||
        memberState.permissions.administrator === true ||
        memberState.isOwner === true,
      canManageChannels:
        memberState.permissions.manage_channels === true ||
        memberState.permissions.administrator === true ||
        memberState.isOwner === true,
      canKickMembers:
        memberState.permissions.kick_members === true ||
        memberState.permissions.administrator === true ||
        memberState.isOwner === true,
      canBanMembers:
        memberState.permissions.ban_members === true ||
        memberState.permissions.administrator === true ||
        memberState.isOwner === true,
      canMuteMembers:
        memberState.permissions.mute_members === true ||
        memberState.permissions.administrator === true ||
        memberState.isOwner === true,
      canDeafenMembers:
        memberState.permissions.deafen_members === true ||
        memberState.permissions.administrator === true ||
        memberState.isOwner === true,
      canMoveMembers:
        memberState.permissions.move_members === true ||
        memberState.permissions.administrator === true ||
        memberState.isOwner === true,
      canDisconnectMembers:
        memberState.permissions.disconnect_members === true ||
        memberState.permissions.administrator === true ||
        memberState.isOwner === true,
      permissions: memberState.permissions,
      highestRole: memberState.highestRole,
      isOwner: memberState.isOwner === true,
      serverMuted: memberState.serverMuted,
      serverDeafened: memberState.serverDeafened,
      timeoutUntil: memberState.timeoutUntil,
    };
  });

  app.get("/:id", { preHandler: [app.auth] }, async (req: any, reply) => {
    const serverId = String(req.params.id);
    const u = req.user as any;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");

    if (!userId) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    const memberState = await getServerMemberPermissionState(serverId, userId);
    if (!memberState) {
      return reply.code(403).send({ error: "NOT_A_SERVER_MEMBER" });
    }

    const { rows } = await db.query(
      `SELECT id, name, owner_id, avatar_url, created_at
       FROM servers
       WHERE id = $1`,
      [serverId]
    );

    if (rows.length === 0) {
      return reply.code(404).send({ error: "SERVER_NOT_FOUND" });
    }

    return {
      id: rows[0].id,
      name: rows[0].name,
      ownerId: rows[0].owner_id,
      avatarUrl: rows[0].avatar_url ?? null,
      createdAt: rows[0].created_at,
      permissions: memberState.permissions,
      highestRole: memberState.highestRole,
      serverMuted: memberState.serverMuted,
      serverDeafened: memberState.serverDeafened,
      timeoutUntil: memberState.timeoutUntil,
    };
  });

  app.get("/:id/members", { preHandler: [app.auth] }, async (req: any, reply) => {
    const serverId = String(req.params.id);
    const u = req.user as any;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");

    if (!userId) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    await reconcileBuiltInRolesForServer(serverId);

    const state = await getServerMemberPermissionState(serverId, userId);
    if (!state) {
      return reply.code(403).send({ error: "NOT_A_SERVER_MEMBER" });
    }

    const members = await getVisibleServerMembersWithRoles(serverId);
    return members;
  });

  app.post("/join", { preHandler: [app.auth] }, async (req: any, reply) => {
    const u = req.user as any;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
    const code = String(req.body?.code ?? "").trim().toUpperCase();

    if (!userId) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    if (!code) {
      return reply.code(400).send({ error: "INVITE_CODE_REQUIRED" });
    }

    const inviteRes = await db.query(
      `SELECT id, code, server_id, max_uses, uses, expires_at
       FROM invites
       WHERE code = $1`,
      [code]
    );

    if (inviteRes.rowCount === 0) {
      return reply.code(404).send({ error: "INVITE_NOT_FOUND" });
    }

    const invite = inviteRes.rows[0];

    if (!invite.server_id) {
      return reply.code(400).send({ error: "INVITE_HAS_NO_SERVER" });
    }

    if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
      return reply.code(400).send({ error: "INVITE_EXPIRED" });
    }

    if (invite.max_uses !== null && invite.uses >= invite.max_uses) {
      return reply.code(400).send({ error: "INVITE_MAX_USES_REACHED" });
    }

    const banCheck = await db.query(
      `SELECT 1
       FROM server_bans
       WHERE server_id = $1 AND user_id = $2
       LIMIT 1`,
      [invite.server_id, userId]
    );

    if ((banCheck.rowCount ?? 0) > 0) {
      return reply.code(403).send({ error: "USER_BANNED_FROM_SERVER" });
    }

    await db.query("BEGIN");
    try {
      await db.query(
        `INSERT INTO server_members (server_id, user_id, role)
         VALUES ($1, $2, 'member')
         ON CONFLICT (server_id, user_id) DO NOTHING`,
        [invite.server_id, userId]
      );

      await ensureDefaultMemberRoleAssigned(String(invite.server_id), userId);

      await db.query(
        `UPDATE invites
         SET uses = uses + 1
         WHERE id = $1`,
        [invite.id]
      );

      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }

    const serverRes = await db.query(
      `SELECT id, name, owner_id, avatar_url
       FROM servers
       WHERE id = $1`,
      [invite.server_id]
    );

    await createGeneralAuditLog({
      eventType: "server_join",
      actorUserId: userId,
      actorIp: (req as any).ip ?? null,
      serverId: String(invite.server_id),
      details: {
        inviteCode: code,
      },
    });

    const affectedUserIds = await getServerMemberUserIds(String(invite.server_id));
    emitServersUpdated(app, affectedUserIds, String(invite.server_id), "joined");

    return {
      ok: true,
      server: {
        id: serverRes.rows[0].id,
        name: serverRes.rows[0].name,
        ownerId: serverRes.rows[0].owner_id,
        avatarUrl: serverRes.rows[0].avatar_url ?? null,
      },
    };
  });

  app.patch("/:id", { preHandler: [app.auth] }, async (req: any, reply) => {
    const u = req.user as any;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
    const serverId = String(req.params.id);
    const hasName = Object.prototype.hasOwnProperty.call(req.body ?? {}, "name");
    const hasAvatarUrl = Object.prototype.hasOwnProperty.call(req.body ?? {}, "avatarUrl");
    const nextName = hasName ? String(req.body?.name ?? "").trim() : undefined;
    const nextAvatarUrl = hasAvatarUrl
      ? req.body?.avatarUrl === null
        ? null
        : String(req.body?.avatarUrl ?? "").trim()
      : undefined;

    if (!userId) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    if (!hasName && !hasAvatarUrl) {
      return reply.code(400).send({ error: "NO_SERVER_UPDATE_FIELDS" });
    }

    if (hasName && (!nextName || nextName.length < 2)) {
      return reply.code(400).send({ error: "SERVER_NAME_REQUIRED" });
    }

    if (
      hasAvatarUrl &&
      nextAvatarUrl !== null &&
      nextAvatarUrl &&
      !nextAvatarUrl.startsWith("/uploads/avatars/")
    ) {
      return reply.code(400).send({ error: "INVALID_SERVER_AVATAR_URL" });
    }

    const permissionState = await requireServerPermission(
      serverId,
      userId,
      "manage_server"
    );

    if (!permissionState) {
      const membership = await db.query(
        `SELECT role
         FROM server_members
         WHERE server_id = $1 AND user_id = $2`,
        [serverId, userId]
      );

      if ((membership.rowCount ?? 0) === 0) {
        return reply.code(403).send({ error: "NOT_A_SERVER_MEMBER" });
      }

      const role = normalizeRole(membership.rows[0]?.role);
      if (!canManageServer(role)) {
        return reply.code(403).send({ error: "INSUFFICIENT_SERVER_PERMISSION" });
      }
    }

    const existing = await db.query(
      `SELECT id, name, owner_id, avatar_url, created_at
       FROM servers
       WHERE id = $1
       LIMIT 1`,
      [serverId]
    );

    if ((existing.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: "SERVER_NOT_FOUND" });
    }

    const current = existing.rows[0];
    const finalName = hasName ? nextName! : String(current.name ?? "");
    const finalAvatarUrl =
      hasAvatarUrl
        ? nextAvatarUrl === null || nextAvatarUrl === ""
          ? null
          : nextAvatarUrl
        : current.avatar_url ?? null;

    if (
      hasAvatarUrl &&
      (current.avatar_url ?? null) &&
      current.avatar_url !== finalAvatarUrl
    ) {
      await deletePreviousAvatarIfLocal(current.avatar_url);
    }

    const updated = await db.query(
      `UPDATE servers
       SET name = $2,
           avatar_url = $3
       WHERE id = $1
       RETURNING id, name, owner_id, avatar_url, created_at`,
      [serverId, finalName, finalAvatarUrl]
    );

    emitServerEvent(app, serverId, {
      type: "SERVER_UPDATED",
      payload: {
        serverId,
        name: finalName,
        avatarUrl: finalAvatarUrl,
      },
    });

    const affectedUserIds = await getServerMemberUserIds(serverId);
    const pendingInviteTargetUserIds = await getPendingServerInviteTargetUserIds(serverId);
    emitServersUpdated(app, affectedUserIds, serverId, "updated");

    if (pendingInviteTargetUserIds.length > 0) {
      app.broadcastWs?.({
        type: "SERVER_INVITES_UPDATED",
        payload: { userIds: pendingInviteTargetUserIds },
      });
    }

    return {
      id: updated.rows[0].id,
      name: updated.rows[0].name,
      ownerId: updated.rows[0].owner_id,
      avatarUrl: updated.rows[0].avatar_url ?? null,
      createdAt: updated.rows[0].created_at,
    };
  });

  app.post("/:id/avatar", { preHandler: [app.auth] }, async (req: any, reply) => {
    const u = req.user as any;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
    const serverId = String(req.params.id);

    if (!userId) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    const permissionState = await requireServerPermission(
      serverId,
      userId,
      "manage_server"
    );

    if (!permissionState) {
      const membership = await db.query(
        `SELECT role
         FROM server_members
         WHERE server_id = $1 AND user_id = $2`,
        [serverId, userId]
      );

      if ((membership.rowCount ?? 0) === 0) {
        return reply.code(403).send({ error: "NOT_A_SERVER_MEMBER" });
      }

      const role = normalizeRole(membership.rows[0]?.role);
      if (!canManageServer(role)) {
        return reply.code(403).send({ error: "INSUFFICIENT_SERVER_PERMISSION" });
      }
    }

    const part = await req.file();
    if (!part) {
      return reply.code(400).send({ error: "AVATAR_FILE_REQUIRED" });
    }

    const ext = getAvatarExtension(part.mimetype, part.filename);
    if (!ext) {
      return reply.code(400).send({ error: "INVALID_AVATAR_FILE_TYPE" });
    }

    const serverRes = await db.query(
      `SELECT id, name, avatar_url
       FROM servers
       WHERE id = $1
       LIMIT 1`,
      [serverId]
    );

    if ((serverRes.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: "SERVER_NOT_FOUND" });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of part.file) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const buffer = Buffer.concat(chunks);
    if (!buffer.length) {
      return reply.code(400).send({ error: "EMPTY_AVATAR_FILE" });
    }

    const safeName = sanitizeFileStem(serverRes.rows[0]?.name ?? serverId);
    const filename = `${safeName}-${serverId}-${Date.now()}.${ext}`;
    const uploadsDir = path.join(process.cwd(), "uploads", "avatars");
    const filepath = path.join(uploadsDir, filename);

    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.writeFile(filepath, buffer);

    const nextAvatarUrl = `/uploads/avatars/${filename}`;
    const previousAvatarUrl = serverRes.rows[0]?.avatar_url
      ? String(serverRes.rows[0].avatar_url)
      : null;

    await db.query(
      `UPDATE servers
       SET avatar_url = $2
       WHERE id = $1`,
      [serverId, nextAvatarUrl]
    );

    if (previousAvatarUrl && previousAvatarUrl !== nextAvatarUrl) {
      await deletePreviousAvatarIfLocal(previousAvatarUrl);
    }

    emitServerEvent(app, serverId, {
      type: "SERVER_UPDATED",
      payload: {
        serverId,
        name: String(serverRes.rows[0]?.name ?? ""),
        avatarUrl: nextAvatarUrl,
      },
    });

    const affectedUserIds = await getServerMemberUserIds(serverId);
    const pendingInviteTargetUserIds = await getPendingServerInviteTargetUserIds(serverId);
    emitServersUpdated(app, affectedUserIds, serverId, "updated");

    if (pendingInviteTargetUserIds.length > 0) {
      app.broadcastWs?.({
        type: "SERVER_INVITES_UPDATED",
        payload: { userIds: pendingInviteTargetUserIds },
      });
    }

    return {
      ok: true,
      avatarUrl: nextAvatarUrl,
    };
  });

  app.post("/:id/leave", { preHandler: [app.auth] }, async (req: any, reply) => {
    const u = req.user as any;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
    const serverId = String(req.params.id);

    if (!userId) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    const serverRes = await db.query(
      `SELECT id, owner_id
       FROM servers
       WHERE id = $1`,
      [serverId]
    );

    if ((serverRes.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: "SERVER_NOT_FOUND" });
    }

    const ownerId = String(serverRes.rows[0].owner_id ?? "");
    if (ownerId === userId) {
      return reply.code(400).send({ error: "OWNER_CANNOT_LEAVE_SERVER" });
    }

    await db.query("BEGIN");
    try {
      await removeAllMemberRoles(serverId, userId);

      await db.query(
        `DELETE FROM server_members
         WHERE server_id = $1 AND user_id = $2`,
        [serverId, userId]
      );

      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }

    await createGeneralAuditLog({
      eventType: "server_leave",
      actorUserId: userId,
      actorIp: (req as any).ip ?? null,
      serverId,
      details: {},
    });

    await forceLeaveFromServerVoice(app, serverId, userId);

    emitServerEvent(app, serverId, {
      type: "SERVER_UPDATED",
      payload: { serverId },
    });

    const remainingUserIds = await getServerMemberUserIds(serverId);
    emitServersUpdated(
      app,
      [...new Set([...remainingUserIds, userId])],
      serverId,
      "left"
    );

    return { ok: true };
  });

  app.delete("/:id", { preHandler: [app.auth] }, async (req: any, reply) => {
    const u = req.user as any;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
    const serverId = String(req.params.id);

    if (!userId) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    const serverRes = await db.query(
      `SELECT id, owner_id
       FROM servers
       WHERE id = $1`,
      [serverId]
    );

    if ((serverRes.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: "SERVER_NOT_FOUND" });
    }

    if (String(serverRes.rows[0].owner_id ?? "") !== userId) {
      return reply.code(403).send({ error: "ONLY_OWNER_CAN_DELETE_SERVER" });
    }

    const affectedUserIds = await getServerMemberUserIds(serverId);

    await db.query("BEGIN");

    try {
      await db.query(`DELETE FROM server_bans WHERE server_id = $1`, [serverId]);
      await db.query(`DELETE FROM server_member_roles WHERE server_id = $1`, [serverId]);
      await db.query(`DELETE FROM server_roles WHERE server_id = $1`, [serverId]);

      await db.query(
        `DELETE FROM invites
         WHERE server_id = $1`,
        [serverId]
      );

      await db.query(
        `DELETE FROM channel_permission_overrides
         WHERE channel_id IN (
           SELECT id FROM channels WHERE server_id = $1
         )`,
        [serverId]
      );

      await db.query(
        `DELETE FROM channel_members
         WHERE channel_id IN (
           SELECT id FROM channels WHERE server_id = $1
         )`,
        [serverId]
      );

      await db.query(
        `DELETE FROM channel_messages
         WHERE channel_id IN (
           SELECT id FROM channels WHERE server_id = $1
         )`,
        [serverId]
      );

      await db.query(
        `DELETE FROM channels
         WHERE server_id = $1`,
        [serverId]
      );

      await db.query(
        `DELETE FROM server_members
         WHERE server_id = $1`,
        [serverId]
      );

      await db.query(
        `DELETE FROM servers
         WHERE id = $1`,
        [serverId]
      );

      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }

    emitServerEvent(app, serverId, {
      type: "SERVER_DELETED",
      payload: { serverId },
    });

    emitServersUpdated(app, affectedUserIds, serverId, "deleted");

    return { ok: true };
  });

  app.post("/:id/invites", { preHandler: [app.auth] }, async (req: any, reply) => {
    const u = req.user as any;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
    const serverId = String(req.params.id);
    const rawMaxUses = req.body?.maxUses;

    if (!userId) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    const memberState = await getServerMemberPermissionState(serverId, userId);
    if (!memberState) {
      return reply.code(403).send({ error: "NOT_A_SERVER_MEMBER" });
    }

    let maxUses: number | null = null;

    if (rawMaxUses !== null && rawMaxUses !== undefined) {
      const parsed = Number(rawMaxUses);

      if (![10, 50, 100, 9999].includes(parsed)) {
        return reply.code(400).send({ error: "INVALID_MAX_USES" });
      }

      maxUses = parsed;
    }

    const inviteId = randomUUID();
    const inviteCode = generateInviteCode(8);

    await db.query(
      `INSERT INTO invites (id, code, server_id, created_by, max_uses, uses)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [inviteId, inviteCode, serverId, userId, maxUses, 0]
    );

    return {
      code: inviteCode,
      serverId,
      maxUses,
    };
  });

  app.get("/:id/roles", { preHandler: [app.auth] }, async (req: any, reply) => {
    const serverId = String(req.params.id);
    const u = req.user as any;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");

    if (!userId) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    const state = await getServerMemberPermissionState(serverId, userId);
    if (!state) {
      return reply.code(403).send({ error: "NOT_A_SERVER_MEMBER" });
    }

    const result = await db.query(
      `SELECT id, server_id, name, color, position, permissions, is_default, is_managed, created_at, updated_at
       FROM server_roles
       WHERE server_id = $1
       ORDER BY position DESC, created_at ASC`,
      [serverId]
    );

    return result.rows.map((row) => ({
      id: String(row.id),
      serverId: String(row.server_id),
      name: String(row.name),
      color: row.color ? String(row.color) : null,
      position: Number(row.position ?? 0),
      permissions: row.permissions ?? {},
      isDefault: row.is_default === true,
      isManaged: row.is_managed === true,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  });

  app.post("/:id/roles", { preHandler: [app.auth] }, async (req: any, reply) => {
    const serverId = String(req.params.id);
    const u = req.user as any;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
    const name = String(req.body?.name ?? "").trim();
    const color = sanitizeRoleColor(req.body?.color);
    const permissions = normalizePermissionsInput(req.body?.permissions);

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    if (!name || name.length < 2) {
      return reply.code(400).send({ error: "ROLE_NAME_REQUIRED" });
    }

    await reconcileBuiltInRolesForServer(serverId);

    const state = await requireServerPermission(serverId, userId, "manage_roles");
    if (!state) {
      return reply.code(403).send({ error: "MANAGE_ROLES_FORBIDDEN" });
    }

    const actorIsOwner = state.isOwner || (await isServerOwner(serverId, userId));

    if (!canActorGrantPermissions({ ...state, isOwner: actorIsOwner }, permissions)) {
      return reply.code(403).send({ error: "CANNOT_GRANT_HIGHER_PERMISSIONS_THAN_SELF" });
    }

    const roleManagementCeiling = actorIsOwner
      ? Number.POSITIVE_INFINITY
      : getActorRoleManagementCeiling(state);

    if (!Number.isFinite(roleManagementCeiling) && actorIsOwner === false) {
      return reply.code(403).send({ error: "CANNOT_CREATE_ROLE_ABOVE_SELF" });
    }

    if (!actorIsOwner && roleManagementCeiling < 1) {
      return reply.code(403).send({ error: "CANNOT_CREATE_ROLE_ABOVE_SELF" });
    }

    const defaultRoleRes = await db.query(
      `SELECT position
       FROM server_roles
       WHERE server_id = $1
         AND is_default = true
       ORDER BY position DESC
       LIMIT 1`,
      [serverId]
    );

    const defaultRolePosition = Number(defaultRoleRes.rows[0]?.position ?? 0);

    const desiredCreatePosition = actorIsOwner
      ? defaultRolePosition + 10
      : Math.min(
          Math.max(defaultRolePosition + 10, 1),
          Math.max(1, Math.floor(roleManagementCeiling))
        );

    const result = await db.query(
      `INSERT INTO server_roles (id, server_id, name, color, position, permissions, is_default, is_managed)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, false, false)
       RETURNING id, server_id, name, color, position, permissions, is_default, is_managed, created_at, updated_at`,
      [
        randomUUID(),
        serverId,
        name,
        color,
        desiredCreatePosition,
        JSON.stringify(permissions),
      ]
    );

    emitServerEvent(app, serverId, {
      type: "SERVER_ROLES_UPDATED",
      payload: { serverId },
    });

    return {
      id: String(result.rows[0].id),
      serverId: String(result.rows[0].server_id),
      name: String(result.rows[0].name),
      color: result.rows[0].color ? String(result.rows[0].color) : null,
      position: Number(result.rows[0].position ?? 0),
      permissions: result.rows[0].permissions ?? {},
      isDefault: result.rows[0].is_default === true,
      isManaged: result.rows[0].is_managed === true,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at,
    };
  });

  app.patch("/:id/roles/:roleId", { preHandler: [app.auth] }, async (req: any, reply) => {
    const serverId = String(req.params.id);
    const roleId = String(req.params.roleId);
    const u = req.user as any;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });

    await reconcileBuiltInRolesForServer(serverId);

    const state = await requireServerPermission(serverId, userId, "manage_roles");
    if (!state) {
      return reply.code(403).send({ error: "MANAGE_ROLES_FORBIDDEN" });
    }

    const role = await getServerRoleById(serverId, roleId);
    if (!role) {
      return reply.code(404).send({ error: "ROLE_NOT_FOUND" });
    }

    if (role.isManaged) {
      return reply.code(400).send({ error: "MANAGED_ROLE_CANNOT_BE_EDITED" });
    }

    if (state.highestRole && role.position >= state.highestRole.position && !state.isOwner) {
      return reply.code(403).send({ error: "CANNOT_EDIT_EQUAL_OR_HIGHER_ROLE" });
    }

    const hasName = Object.prototype.hasOwnProperty.call(req.body ?? {}, "name");
    const hasColor = Object.prototype.hasOwnProperty.call(req.body ?? {}, "color");
    const hasPermissions = Object.prototype.hasOwnProperty.call(req.body ?? {}, "permissions");
    const hasPosition = Object.prototype.hasOwnProperty.call(req.body ?? {}, "position");

    const nextName = hasName ? String(req.body?.name ?? "").trim() : role.name;
    const nextColor = hasColor
      ? (req.body?.color === null || req.body?.color === "" ? null : sanitizeRoleColor(req.body?.color))
      : role.color;
    const nextPermissions = hasPermissions
      ? normalizePermissionsInput(req.body?.permissions)
      : role.permissions;
    const nextPosition = hasPosition ? Number(req.body?.position ?? role.position) : role.position;

    if (!nextName || nextName.length < 2) {
      return reply.code(400).send({ error: "ROLE_NAME_REQUIRED" });
    }

    if (!Number.isFinite(nextPosition)) {
      return reply.code(400).send({ error: "INVALID_ROLE_POSITION" });
    }

    if (state.highestRole && nextPosition >= state.highestRole.position && !state.isOwner) {
      return reply.code(403).send({ error: "CANNOT_SET_ROLE_ABOVE_SELF" });
    }

    if (!canActorGrantPermissions(state, nextPermissions)) {
      return reply.code(403).send({ error: "CANNOT_GRANT_HIGHER_PERMISSIONS_THAN_SELF" });
    }

    const result = await db.query(
      `UPDATE server_roles
       SET name = $3,
           color = $4,
           position = $5,
           permissions = $6::jsonb,
           updated_at = NOW()
       WHERE id = $1 AND server_id = $2
       RETURNING id, server_id, name, color, position, permissions, is_default, is_managed, created_at, updated_at`,
      [
        roleId,
        serverId,
        nextName,
        nextColor,
        Math.floor(nextPosition),
        JSON.stringify(nextPermissions),
      ]
    );

    emitServerEvent(app, serverId, {
      type: "SERVER_ROLES_UPDATED",
      payload: { serverId },
    });

    return {
      id: String(result.rows[0].id),
      serverId: String(result.rows[0].server_id),
      name: String(result.rows[0].name),
      color: result.rows[0].color ? String(result.rows[0].color) : null,
      position: Number(result.rows[0].position ?? 0),
      permissions: result.rows[0].permissions ?? {},
      isDefault: result.rows[0].is_default === true,
      isManaged: result.rows[0].is_managed === true,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at,
    };
  });

  app.delete("/:id/roles/:roleId", { preHandler: [app.auth] }, async (req: any, reply) => {
    const serverId = String(req.params.id);
    const roleId = String(req.params.roleId);
    const u = req.user as any;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });

    await reconcileBuiltInRolesForServer(serverId);

    const state = await requireServerPermission(serverId, userId, "manage_roles");
    if (!state) {
      return reply.code(403).send({ error: "MANAGE_ROLES_FORBIDDEN" });
    }

    const role = await getServerRoleById(serverId, roleId);
    if (!role) {
      return reply.code(404).send({ error: "ROLE_NOT_FOUND" });
    }

    if (role.isManaged || role.isDefault) {
      return reply.code(400).send({ error: "ROLE_CANNOT_BE_DELETED" });
    }

    if (state.highestRole && role.position >= state.highestRole.position && !state.isOwner) {
      return reply.code(403).send({ error: "CANNOT_DELETE_EQUAL_OR_HIGHER_ROLE" });
    }

    await db.query("BEGIN");
    try {
      await db.query(
        `DELETE FROM server_member_roles
         WHERE server_id = $1 AND role_id = $2`,
        [serverId, roleId]
      );

      await db.query(
        `DELETE FROM channel_permission_overrides
         WHERE subject_type = 'role' AND subject_id = $1`,
        [roleId]
      );

      await db.query(
        `DELETE FROM server_roles
         WHERE server_id = $1 AND id = $2`,
        [serverId, roleId]
      );

      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }

    emitServerEvent(app, serverId, {
      type: "SERVER_ROLES_UPDATED",
      payload: { serverId },
    });

    return { ok: true };
  });

  app.post("/:id/members/:targetUserId/roles/:roleId", { preHandler: [app.auth] }, async (req: any, reply) => {
    const serverId = String(req.params.id);
    const targetUserId = String(req.params.targetUserId);
    const roleId = String(req.params.roleId);
    const u = req.user as any;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });

    await reconcileBuiltInRolesForServer(serverId);

    const state = await requireServerPermission(serverId, userId, "manage_roles");
    if (!state) return reply.code(403).send({ error: "MANAGE_ROLES_FORBIDDEN" });

    const targetMember = await db.query(
      `SELECT 1
       FROM server_members
       WHERE server_id = $1 AND user_id = $2
       LIMIT 1`,
      [serverId, targetUserId]
    );

    if ((targetMember.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: "TARGET_MEMBER_NOT_FOUND" });
    }

    const role = await getServerRoleById(serverId, roleId);
    if (!role) {
      return reply.code(404).send({ error: "ROLE_NOT_FOUND" });
    }

    if (role.isManaged) {
      return reply.code(400).send({ error: "ROLE_CANNOT_BE_ASSIGNED" });
    }

    const canAct = await canActOnTargetUser(serverId, userId, targetUserId);
    if (!canAct && !state.isOwner) {
      return reply.code(403).send({ error: "CANNOT_MANAGE_TARGET_MEMBER" });
    }

    if (state.highestRole && role.position >= state.highestRole.position && !state.isOwner) {
      return reply.code(403).send({ error: "CANNOT_ASSIGN_EQUAL_OR_HIGHER_ROLE" });
    }

    await db.query(
      `INSERT INTO server_member_roles (server_id, user_id, role_id)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [serverId, targetUserId, roleId]
    );

    emitServerEvent(app, serverId, {
      type: "SERVER_MEMBER_UPDATED",
      payload: { serverId, userId: targetUserId },
    });

    return { ok: true };
  });

  app.delete("/:id/members/:targetUserId/roles/:roleId", { preHandler: [app.auth] }, async (req: any, reply) => {
    const serverId = String(req.params.id);
    const targetUserId = String(req.params.targetUserId);
    const roleId = String(req.params.roleId);
    const u = req.user as any;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });

    const state = await requireServerPermission(serverId, userId, "manage_roles");
    if (!state) return reply.code(403).send({ error: "MANAGE_ROLES_FORBIDDEN" });

    const role = await getServerRoleById(serverId, roleId);
    if (!role) {
      return reply.code(404).send({ error: "ROLE_NOT_FOUND" });
    }

    if (role.isManaged) {
      return reply.code(400).send({ error: "ROLE_CANNOT_BE_REMOVED" });
    }

    const canAct = await canActOnTargetUser(serverId, userId, targetUserId);
    if (!canAct && !state.isOwner) {
      return reply.code(403).send({ error: "CANNOT_MANAGE_TARGET_MEMBER" });
    }

    if (state.highestRole && role.position >= state.highestRole.position && !state.isOwner) {
      return reply.code(403).send({ error: "CANNOT_REMOVE_EQUAL_OR_HIGHER_ROLE" });
    }

    await db.query(
      `DELETE FROM server_member_roles
       WHERE server_id = $1 AND user_id = $2 AND role_id = $3`,
      [serverId, targetUserId, roleId]
    );

    await ensureDefaultMemberRoleAssigned(serverId, targetUserId);

    emitServerEvent(app, serverId, {
      type: "SERVER_MEMBER_UPDATED",
      payload: { serverId, userId: targetUserId },
    });

    return { ok: true };
  });

  app.post("/:id/kick", { preHandler: [app.auth] }, async (req: any, reply) => {
    const serverId = String(req.params.id);
    const targetUserId = String(req.body?.targetUserId ?? "").trim();
    const u = req.user as any;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    if (!targetUserId) return reply.code(400).send({ error: "TARGET_USER_REQUIRED" });

    const state = await requireServerPermission(serverId, userId, "kick_members");
    if (!state) return reply.code(403).send({ error: "KICK_MEMBERS_FORBIDDEN" });

    const targetIsOwner = await isServerOwner(serverId, targetUserId);
    if (targetIsOwner) {
      return reply.code(403).send({ error: "CANNOT_KICK_SERVER_OWNER" });
    }

    const canAct = await canActOnTargetUser(serverId, userId, targetUserId);
    if (!canAct && !state.isOwner) {
      return reply.code(403).send({ error: "CANNOT_KICK_TARGET_MEMBER" });
    }

    await db.query("BEGIN");
    try {
      await removeAllMemberRoles(serverId, targetUserId);

      await db.query(
        `DELETE FROM server_members
         WHERE server_id = $1 AND user_id = $2`,
        [serverId, targetUserId]
      );

      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }

    await forceLeaveFromServerVoice(app, serverId, targetUserId);

    emitServerEvent(app, serverId, {
      type: "SERVER_MEMBER_KICKED",
      payload: { serverId, userId: targetUserId },
    });

    const affectedUserIds = await getServerMemberUserIds(serverId);
    emitServersUpdated(
      app,
      [...new Set([...affectedUserIds, targetUserId])],
      serverId,
      "member_kicked"
    );

    return { ok: true };
  });

  app.post("/:id/ban", { preHandler: [app.auth] }, async (req: any, reply) => {
    const serverId = String(req.params.id);
    const targetUserId = String(req.body?.targetUserId ?? "").trim();
    const reason = String(req.body?.reason ?? "").trim() || null;
    const u = req.user as any;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    if (!targetUserId) return reply.code(400).send({ error: "TARGET_USER_REQUIRED" });

    const state = await requireServerPermission(serverId, userId, "ban_members");
    if (!state) return reply.code(403).send({ error: "BAN_MEMBERS_FORBIDDEN" });

    const targetIsOwner = await isServerOwner(serverId, targetUserId);
    if (targetIsOwner) {
      return reply.code(403).send({ error: "CANNOT_BAN_SERVER_OWNER" });
    }

    const canAct = await canActOnTargetUser(serverId, userId, targetUserId);
    if (!canAct && !state.isOwner) {
      return reply.code(403).send({ error: "CANNOT_BAN_TARGET_MEMBER" });
    }

    await db.query("BEGIN");
    try {
      await db.query(
        `INSERT INTO server_bans (server_id, user_id, banned_by, reason)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (server_id, user_id)
         DO UPDATE SET banned_by = EXCLUDED.banned_by, reason = EXCLUDED.reason, created_at = NOW()`,
        [serverId, targetUserId, userId, reason]
      );

      await removeAllMemberRoles(serverId, targetUserId);

      await db.query(
        `DELETE FROM server_members
         WHERE server_id = $1 AND user_id = $2`,
        [serverId, targetUserId]
      );

      await db.query(
        `DELETE FROM server_user_invites
         WHERE server_id = $1
           AND target_user_id = $2
           AND status = 'pending'`,
        [serverId, targetUserId]
      );

      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }

    await forceLeaveFromServerVoice(app, serverId, targetUserId);

    app.broadcastWs?.({
      type: "SERVER_INVITES_UPDATED",
      payload: { userIds: [targetUserId] },
    });

    emitServerEvent(app, serverId, {
      type: "SERVER_MEMBER_BANNED",
      payload: { serverId, userId: targetUserId },
    });

    const affectedUserIds = await getServerMemberUserIds(serverId);
    emitServersUpdated(
      app,
      [...new Set([...affectedUserIds, targetUserId])],
      serverId,
      "member_banned"
    );

    return { ok: true };
  });

  app.get("/:id/bans", { preHandler: [app.auth] }, async (req: any, reply) => {
    const serverId = String(req.params.id);
    const u = req.user as any;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });

    const allowed = await hasServerPermission(serverId, userId, "ban_members");
    if (!allowed) return reply.code(403).send({ error: "BAN_MEMBERS_FORBIDDEN" });

    const result = await db.query(
      `SELECT
         sb.server_id,
         sb.user_id,
         sb.banned_by,
         sb.reason,
         sb.created_at,
         u.username,
         u.display_name,
         u.avatar_url,
         bu.display_name AS banned_by_display_name
       FROM server_bans sb
       JOIN users u
         ON u.id = sb.user_id
       LEFT JOIN users bu
         ON bu.id = sb.banned_by
       WHERE sb.server_id = $1
       ORDER BY sb.created_at DESC`,
      [serverId]
    );

    return result.rows.map((row) => ({
      serverId: String(row.server_id),
      userId: String(row.user_id),
      username: row.username ? String(row.username) : null,
      displayName: String(row.display_name ?? "User"),
      avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      bannedBy: row.banned_by ? String(row.banned_by) : null,
      bannedByDisplayName: row.banned_by_display_name
        ? String(row.banned_by_display_name)
        : null,
      reason: row.reason ? String(row.reason) : null,
      createdAt: row.created_at,
    }));
  });

  app.delete("/:id/bans/:targetUserId", { preHandler: [app.auth] }, async (req: any, reply) => {
    const serverId = String(req.params.id);
    const targetUserId = String(req.params.targetUserId);
    const u = req.user as any;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });

    const allowed = await hasServerPermission(serverId, userId, "ban_members");
    if (!allowed) return reply.code(403).send({ error: "BAN_MEMBERS_FORBIDDEN" });

    await db.query(
      `DELETE FROM server_bans
       WHERE server_id = $1 AND user_id = $2`,
      [serverId, targetUserId]
    );

    emitServerEvent(app, serverId, {
      type: "SERVER_BAN_REMOVED",
      payload: { serverId, userId: targetUserId },
    });

    return { ok: true };
  });
}
