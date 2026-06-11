import { FastifyPluginAsync } from "fastify";
import { db } from "../db";
import { createGeneralAuditLog } from "../services/auditLogService";

function getAuthUserId(req: any) {
  const u = req.user as any;
  return String(u?.id ?? u?.userId ?? u?.sub ?? "");
}

async function areUsersBlocked(userId: string, targetUserId: string) {
  const result = await db.query(
    `SELECT 1
     FROM user_blocks
     WHERE (user_id = $1 AND blocked_user_id = $2)
        OR (user_id = $2 AND blocked_user_id = $1)
     LIMIT 1`,
    [String(userId), String(targetUserId)]
  );

  return (result.rowCount ?? 0) > 0;
}

async function isUserBannedInServer(serverId: string, userId: string) {
  const result = await db.query(
    `SELECT 1
     FROM server_bans
     WHERE server_id = $1
       AND user_id = $2
     LIMIT 1`,
    [String(serverId), String(userId)]
  );

  return (result.rowCount ?? 0) > 0;
}

async function getServerMemberUserIds(serverId: string) {
  const result = await db.query(
    `SELECT user_id
     FROM server_members
     WHERE server_id = $1`,
    [String(serverId)]
  );

  return result.rows.map((row) => String(row.user_id));
}

function emitServerEvent(app: any, serverId: string, payload: any) {
  try {
    const fn =
      app?.emitServerEvent ||
      app?.broadcastServerEvent ||
      app?.wsHub?.broadcastServerEvent ||
      app?.wsHub?.broadcastToServer;

    if (typeof fn === "function") {
      fn.call(app?.wsHub ?? app, String(serverId), payload);
    }
  } catch (error) {
    app?.log?.error?.(error, "server event broadcast failed");
  }
}

async function ensureDefaultMemberRoleAssigned(serverId: string, userId: string) {
  const defaultRole = await db.query(
    `SELECT id
     FROM server_roles
     WHERE server_id = $1
       AND is_default = true
     LIMIT 1`,
    [String(serverId)]
  );

  if ((defaultRole.rowCount ?? 0) === 0) return;

  await db.query(
    `INSERT INTO server_member_roles (server_id, user_id, role_id)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [String(serverId), String(userId), String(defaultRole.rows[0].id)]
  );
}

const serverUserInviteRoutes: FastifyPluginAsync = async (app) => {
  app.post("/servers/invite-user", { preHandler: [app.auth] }, async (req: any, reply) => {
    const inviter = getAuthUserId(req);
    const serverId = String(req.body?.serverId ?? "").trim();
    const targetUserId = String(req.body?.targetUserId ?? "").trim();

    if (!inviter) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    if (!serverId || !targetUserId) {
      return reply.code(400).send({ error: "SERVER_ID_AND_TARGET_USER_ID_REQUIRED" });
    }

    if (inviter === targetUserId) {
      return reply.code(400).send({ error: "CANNOT_INVITE_SELF" });
    }

    if (await areUsersBlocked(inviter, targetUserId)) {
      return reply.code(403).send({ error: "USER_BLOCKED" });
    }

    // Sadece bu sunucu için ban kontrolü
    if (await isUserBannedInServer(serverId, targetUserId)) {
      return reply.code(403).send({ error: "USER_BANNED_FROM_SERVER" });
    }

    const inviterMembership = await db.query(
      `SELECT 1
       FROM server_members
       WHERE server_id = $1 AND user_id = $2
       LIMIT 1`,
      [serverId, inviter]
    );

    if ((inviterMembership.rowCount ?? 0) === 0) {
      return reply.code(403).send({ error: "NOT_A_SERVER_MEMBER" });
    }

    const targetMembership = await db.query(
      `SELECT 1
       FROM server_members
       WHERE server_id = $1 AND user_id = $2
       LIMIT 1`,
      [serverId, targetUserId]
    );

    if ((targetMembership.rowCount ?? 0) > 0) {
      return reply.code(409).send({ error: "USER_ALREADY_IN_SERVER" });
    }

    const existing = await db.query(
      `SELECT id
       FROM server_user_invites
       WHERE server_id = $1
         AND inviter_user_id = $2
         AND target_user_id = $3
         AND status = 'pending'
       LIMIT 1`,
      [serverId, inviter, targetUserId]
    );

    if ((existing.rowCount ?? 0) > 0) {
      return reply.code(409).send({ error: "INVITE_ALREADY_EXISTS" });
    }

    await db.query(
      `INSERT INTO server_user_invites
       (server_id, inviter_user_id, target_user_id, status, created_at)
       VALUES ($1, $2, $3, 'pending', now())`,
      [serverId, inviter, targetUserId]
    );

    app.broadcastWs?.({
      type: "SERVER_INVITES_UPDATED",
      payload: { userIds: [targetUserId] },
    });

    return { success: true };
  });

  app.get("/servers/invites/incoming", { preHandler: [app.auth] }, async (req: any, reply) => {
    const userId = getAuthUserId(req);

    if (!userId) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    const r = await db.query(
      `SELECT sui.id,
              sui.created_at,
              sui.inviter_user_id,
              s.name AS server_name,
              s.avatar_url AS server_avatar_url,
              u.display_name AS inviter_display_name
       FROM server_user_invites sui
       JOIN servers s
         ON s.id = sui.server_id
       JOIN users u
         ON u.id = sui.inviter_user_id
       WHERE sui.target_user_id = $1
         AND sui.status = 'pending'
       ORDER BY sui.created_at DESC`,
      [userId]
    );

    return r.rows.map((row) => ({
      id: row.id,
      serverName: row.server_name,
      inviterDisplayName: row.inviter_display_name,
      inviterUserId: String(row.inviter_user_id),
      avatarUrl: row.server_avatar_url ?? null,
      createdAt: row.created_at,
    }));
  });

  app.post("/servers/invites/:inviteId/accept", { preHandler: [app.auth] }, async (req: any, reply) => {
    const userId = getAuthUserId(req);
    const inviteId = String(req.params?.inviteId ?? "").trim();

    if (!userId) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    const inviteLookup = await db.query(
      `SELECT *
       FROM server_user_invites
       WHERE id = $1
         AND target_user_id = $2
         AND status = 'pending'
       LIMIT 1`,
      [inviteId, userId]
    );

    if ((inviteLookup.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: "INVITE_NOT_FOUND" });
    }

    const inviteRow = inviteLookup.rows[0];
    const serverId = String(inviteRow.server_id);

    // Sadece davetin ait olduğu sunucu için ban kontrolü
    if (await isUserBannedInServer(serverId, userId)) {
      return reply.code(403).send({ error: "USER_BANNED_FROM_SERVER" });
    }

    await db.query("BEGIN");

    try {
      await db.query(
        `UPDATE server_user_invites
         SET status = 'accepted'
         WHERE id = $1`,
        [inviteId]
      );

      await db.query(
        `INSERT INTO server_members (server_id, user_id, role)
         VALUES ($1, $2, 'member')
         ON CONFLICT (server_id, user_id) DO NOTHING`,
        [serverId, userId]
      );

      await ensureDefaultMemberRoleAssigned(serverId, userId);

      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }

    await createGeneralAuditLog({
      eventType: "server_join",
      actorUserId: userId,
      actorIp: (req as any).ip ?? null,
      serverId,
      details: {
        source: "server_invite_accept",
        inviteId,
      },
    });

    app.broadcastWs?.({
      type: "SERVER_INVITES_UPDATED",
      payload: { userIds: [userId] },
    });

    const affectedUserIds = await getServerMemberUserIds(serverId);

    app.broadcastWs?.({
      type: "SERVERS_UPDATED",
      payload: {
        userIds: affectedUserIds,
        serverId,
        reason: "joined",
      },
    });

    emitServerEvent(app, serverId, {
      type: "SERVER_MEMBER_UPDATED",
      payload: { serverId, userId },
    });

    return { success: true, serverId };
  });

  app.post("/servers/invites/:inviteId/reject", { preHandler: [app.auth] }, async (req: any, reply) => {
    const userId = getAuthUserId(req);
    const inviteId = String(req.params?.inviteId ?? "").trim();

    if (!userId) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    const updated = await db.query(
      `UPDATE server_user_invites
       SET status = 'rejected'
       WHERE id = $1
         AND target_user_id = $2
         AND status = 'pending'
       RETURNING id`,
      [inviteId, userId]
    );

    if ((updated.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: "INVITE_NOT_FOUND" });
    }

    app.broadcastWs?.({
      type: "SERVER_INVITES_UPDATED",
      payload: { userIds: [userId] },
    });

    return { success: true };
  });
};

export default serverUserInviteRoutes;
