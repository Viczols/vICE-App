import { FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { db } from "../db";
import {
  getServerMemberPermissionState,
  type PermissionMap,
  type ServerPermission,
} from "../services/serverPermissions";
import {
  createMediaEventLog,
  createMediaObject,
  getStorageKeyFromPublicUrl,
  scheduleMediaRetentionForMessage,
} from "../services/mediaAuditService";
import { createGeneralAuditLog } from "../services/auditLogService";

const channelSockets = new Map<string, Set<any>>();
const MEDIA_ROOT = path.join(process.cwd(), "uploads", "media");
const IMAGE_DIR = path.join(MEDIA_ROOT, "images");
const VIDEO_DIR = path.join(MEDIA_ROOT, "videos");
const FILE_DIR = path.join(MEDIA_ROOT, "files");
const MAX_ATTACHMENTS_PER_MESSAGE = 10;

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v"]);

type ChannelPermissionOverrides = {
  allow: Record<string, boolean>;
  deny: Record<string, boolean>;
};

function normalizePermissionObject(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[String(key)] = value === true;
  }
  return out;
}

function clonePermissionMap(source: PermissionMap): PermissionMap {
  return { ...source };
}

async function getChannelPermissionOverrides(
  channelId: string,
  userId: string,
  roleIds: string[]
): Promise<ChannelPermissionOverrides> {
  const result = await db.query(
    `SELECT subject_type, subject_id, allow_permissions, deny_permissions
       FROM channel_permission_overrides
      WHERE channel_id = $1
        AND (
          (subject_type = 'member' AND subject_id = $2)
          OR (subject_type = 'role' AND subject_id = ANY($3::uuid[]))
        )`,
    [channelId, userId, roleIds.length > 0 ? roleIds : [randomUUID()]]
  );

  const allow: Record<string, boolean> = {};
  const deny: Record<string, boolean> = {};

  for (const row of result.rows) {
    const rowAllow = normalizePermissionObject(row.allow_permissions);
    const rowDeny = normalizePermissionObject(row.deny_permissions);

    for (const [key, value] of Object.entries(rowDeny)) {
      if (value === true) deny[key] = true;
    }

    for (const [key, value] of Object.entries(rowAllow)) {
      if (value === true) allow[key] = true;
    }
  }

  return { allow, deny };
}

async function resolveChannelPermissions(
  serverId: string,
  channelId: string,
  userId: string
): Promise<PermissionMap | null> {
  const state = await getServerMemberPermissionState(serverId, userId);
  if (!state) return null;

  const resolved = clonePermissionMap(state.permissions);

  if (resolved.administrator === true) {
    return resolved;
  }

  const roleIds = state.roles.map((role) => role.id);
  const overrides = await getChannelPermissionOverrides(channelId, userId, roleIds);

  for (const [key, value] of Object.entries(overrides.deny)) {
    if (value === true && key in resolved) {
      (resolved as any)[key] = false;
    }
  }

  for (const [key, value] of Object.entries(overrides.allow)) {
    if (value === true && key in resolved) {
      (resolved as any)[key] = true;
    }
  }

  return resolved;
}

async function ensureChannelAccess(
  serverId: string,
  channelId: string,
  userId: string,
  permission: ServerPermission,
  isPrivate: boolean
): Promise<boolean> {
  const resolved = await resolveChannelPermissions(serverId, channelId, userId);
  if (!resolved) return false;

  if (resolved.administrator === true || resolved.manage_channels === true) {
    return true;
  }

  if (isPrivate) {
    const channelMembership = await db.query(
      `SELECT 1
         FROM channel_members
        WHERE channel_id = $1 AND user_id = $2
        LIMIT 1`,
      [channelId, userId]
    );

    if ((channelMembership.rowCount ?? 0) === 0 && resolved.view_channel !== true) {
      return false;
    }
  }

  return resolved[permission] === true;
}

async function canManageChannel(serverId: string, userId: string): Promise<boolean> {
  const state = await getServerMemberPermissionState(serverId, userId);
  if (!state) return false;
  return state.permissions.administrator === true || state.permissions.manage_channels === true;
}

async function getNextChannelPosition(serverId: string, type: "text" | "voice") {
  const result = await db.query(
    `SELECT COALESCE(MAX(position), -1) AS max_position
     FROM channels
     WHERE server_id = $1 AND type = $2`,
    [serverId, type]
  );

  return Number(result.rows[0]?.max_position ?? -1) + 1;
}

async function compactChannelPositionsForType(serverId: string, type: "text" | "voice") {
  const rows = await db.query(
    `SELECT id
     FROM channels
     WHERE server_id = $1 AND type = $2
     ORDER BY position ASC NULLS LAST, created_at ASC, id ASC`,
    [serverId, type]
  );

  for (let i = 0; i < rows.rows.length; i += 1) {
    await db.query(
      `UPDATE channels
       SET position = $2
       WHERE id = $1`,
      [String(rows.rows[i].id), i]
    );
  }
}

function sanitizeFileStem(value: string) {
  return (
    String(value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "file"
  );
}

function sanitizeFilename(value: string) {
  return path.basename(String(value || "file").trim()).replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function resolveAttachmentKind(mimetype?: string | null, filename?: string | null) {
  const loweredMime = String(mimetype || "").toLowerCase();
  const ext = path.extname(String(filename || "")).toLowerCase();

  if (loweredMime.startsWith("image/") || IMAGE_EXTENSIONS.has(ext)) {
    return "image" as const;
  }

  if (loweredMime.startsWith("video/") || VIDEO_EXTENSIONS.has(ext)) {
    return "video" as const;
  }

  return "file" as const;
}

function getAttachmentDirectory(kind: "image" | "video" | "file") {
  if (kind === "image") return IMAGE_DIR;
  if (kind === "video") return VIDEO_DIR;
  return FILE_DIR;
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

function broadcast(channelId: string, payload: any) {
  const set = channelSockets.get(channelId);
  if (!set) return;

  const msg = JSON.stringify(payload);

  for (const s of set) {
    try {
      s.send(msg);
    } catch {}
  }
}

async function getChannelById(channelId: string) {
  const res = await db.query(
    `SELECT id, server_id, type, is_private, name, position
     FROM channels
     WHERE id = $1`,
    [channelId]
  );

  return res.rows[0] ?? null;
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

function emitTextChannelUnread(
  app: any,
  payload: {
    serverId: string;
    channelId: string;
    messageId: string;
    senderUserId: string;
  }
) {
  try {
    const broadcastWs = app?.broadcastWs;
    if (typeof broadcastWs !== "function") return;

    void getServerMemberUserIds(payload.serverId)
      .then((memberUserIds) => {
        const targetUserIds = memberUserIds.filter(
          (memberUserId) => memberUserId && memberUserId !== payload.senderUserId
        );

        if (targetUserIds.length === 0) return;

        broadcastWs({
          type: "TEXT_CHANNEL_UNREAD",
          payload: {
            userIds: targetUserIds,
            serverId: payload.serverId,
            channelId: payload.channelId,
            messageId: payload.messageId,
            incrementBy: 1,
          },
        });
      })
      .catch((error: unknown) => {
        app?.log?.error?.(error, "text channel unread broadcast failed");
      });
  } catch (error) {
    app?.log?.error?.(error, "text channel unread emit failed");
  }
}

type StoredAttachment = {
  id: string;
  messageId: string;
  kind: "image" | "video" | "file";
  url: string;
  originalName: string;
  mimeType: string | null;
  sizeBytes: number;
  createdAt?: string;
  mediaObjectId?: string | null;
};

async function getMessageAttachments(messageId: string): Promise<StoredAttachment[]> {
  const result = await db.query(
    `SELECT id, message_id, kind, url, original_name, mime_type, size_bytes, created_at, media_object_id
     FROM channel_message_attachments
     WHERE message_id = $1
     ORDER BY created_at ASC, id ASC`,
    [messageId]
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    messageId: String(row.message_id),
    kind: row.kind === "image" || row.kind === "video" ? row.kind : "file",
    url: String(row.url),
    originalName: String(row.original_name ?? "Dosya"),
    mimeType: row.mime_type ? String(row.mime_type) : null,
    sizeBytes: Number(row.size_bytes ?? 0),
    createdAt: row.created_at ? String(row.created_at) : undefined,
    mediaObjectId: row.media_object_id ? String(row.media_object_id) : null,
  }));
}

async function getMessagePayload(messageId: string) {
  const result = await db.query(
    `SELECT
       cm.id,
       cm.channel_id,
       cm.user_id,
       CASE
         WHEN cm.deleted_at IS NOT NULL THEN ''
         ELSE cm.content
       END AS content,
       cm.created_at,
       cm.edited_at,
       cm.deleted_at,
       cm.reply_to_message_id,

       u.display_name,
       u.username,
       u.avatar_url,

       rpm.id AS reply_message_id,
       CASE
         WHEN rpm.deleted_at IS NOT NULL THEN ''
         ELSE rpm.content
       END AS reply_content,
       rpm.user_id AS reply_user_id,
       ru.display_name AS reply_display_name,
       ru.username AS reply_username,

       pm.id AS pin_id,
       pm.pinned_at,
       pm.pinned_by
     FROM channel_messages cm
     JOIN users u
       ON u.id = cm.user_id
     LEFT JOIN channel_messages rpm
       ON rpm.id = cm.reply_to_message_id
     LEFT JOIN users ru
       ON ru.id = rpm.user_id
     LEFT JOIN pinned_messages pm
       ON pm.message_id = cm.id
     WHERE cm.id = $1
     LIMIT 1`,
    [messageId]
  );

  const row = result.rows[0];
  if (!row) return null;

  const attachments = row.deleted_at ? [] : await getMessageAttachments(messageId);

  return {
    id: row.id,
    channelId: row.channel_id,
    userId: row.user_id,
    displayName: row.display_name,
    username: row.username,
    avatarUrl: row.avatar_url ?? null,
    content: row.content,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    replyToMessageId: row.reply_to_message_id,
    replyTo:
      row.reply_message_id
        ? {
            id: row.reply_message_id,
            userId: row.reply_user_id,
            displayName: row.reply_display_name,
            username: row.reply_username,
            content: row.reply_content,
          }
        : null,
    isPinned: Boolean(row.pin_id),
    pinnedAt: row.pinned_at,
    pinnedBy: row.pinned_by,
    attachments,
  };
}

async function parseIncomingMessageRequest(req: any) {
  if (!req.isMultipart?.()) {
    return {
      content: String(req.body?.content ?? "").trim(),
      replyToMessageId:
        req.body?.replyToMessageId && String(req.body.replyToMessageId).trim()
          ? String(req.body.replyToMessageId).trim()
          : null,
      attachments: [] as Array<{
        kind: "image" | "video" | "file";
        url: string;
        originalName: string;
        mimeType: string | null;
        sizeBytes: number;
        mediaObjectId?: string | null;
      }>,
    };
  }

  const attachments: Array<{
    kind: "image" | "video" | "file";
    url: string;
    originalName: string;
    mimeType: string | null;
    sizeBytes: number;
    mediaObjectId?: string | null;
  }> = [];

  let content = "";
  let replyToMessageId: string | null = null;

  await fs.mkdir(IMAGE_DIR, { recursive: true });
  await fs.mkdir(VIDEO_DIR, { recursive: true });
  await fs.mkdir(FILE_DIR, { recursive: true });

  const parts = req.parts();

  for await (const part of parts) {
    if (part.type === "file") {
      if (!part.filename) continue;

      if (attachments.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
        throw new Error("TOO_MANY_ATTACHMENTS");
      }

      const safeOriginalName = sanitizeFilename(part.filename);
      const ext = path.extname(safeOriginalName).toLowerCase();
      const fileStem = sanitizeFileStem(path.basename(safeOriginalName, ext));
      const kind = resolveAttachmentKind(part.mimetype, safeOriginalName);
      const targetDir = getAttachmentDirectory(kind);
      const storedFilename = `${Date.now()}-${randomUUID()}-${fileStem}${ext}`;
      const targetPath = path.join(targetDir, storedFilename);
      const urlPrefix = kind === "image" ? "images" : kind === "video" ? "videos" : "files";
      const publicUrl = `/uploads/media/${urlPrefix}/${storedFilename}`;

      await pipeline(part.file, createWriteStream(targetPath));
      const stat = await fs.stat(targetPath);

      attachments.push({
        kind,
        url: publicUrl,
        originalName: safeOriginalName,
        mimeType: part.mimetype ? String(part.mimetype) : null,
        sizeBytes: Number(stat.size || 0),
      });
      continue;
    }

    const fieldValue = String(part.value ?? "");
    if (part.fieldname === "content") {
      content = fieldValue.trim();
    } else if (part.fieldname === "replyToMessageId") {
      replyToMessageId = fieldValue.trim() ? fieldValue.trim() : null;
    }
  }

  return { content, replyToMessageId, attachments };
}

export const channelRoutes: FastifyPluginAsync = async (app) => {
  app.get("/server/:serverId", { preHandler: [app.auth] }, async (req: any, reply) => {
    const u: any = req.user;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
    const serverId = String(req.params.serverId);

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });

    const state = await getServerMemberPermissionState(serverId, userId);
    if (!state) {
      return reply.code(403).send({ error: "NOT_A_SERVER_MEMBER" });
    }

    const r = await db.query(
      `SELECT c.id, c.name, c.type, c.server_id, c.is_private, c.position
       FROM channels c
       WHERE c.server_id = $1
       ORDER BY c.type ASC, c.position ASC NULLS LAST, c.created_at ASC, c.id ASC`,
      [serverId]
    );

    const visibleChannels = [] as Array<{
  id: string;
  name: string;
  type: string;
  serverId: string;
  isPrivate: boolean;
  position: number;
}>;

    for (const row of r.rows) {
      const channelId = String(row.id);
      const isPrivate = Boolean(row.is_private);
      const canView = await ensureChannelAccess(serverId, channelId, userId, "view_channel", isPrivate);
      if (!canView) continue;

      visibleChannels.push({
        id: row.id,
        name: row.name,
        type: row.type,
        serverId: row.server_id,
        isPrivate,
        position: Number(row.position ?? 0),
      });
    }

    return visibleChannels;
  });

  app.post("/server/:serverId", { preHandler: [app.auth] }, async (req: any, reply) => {
    const u: any = req.user;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
    const serverId = String(req.params.serverId);
    const name = String(req.body?.name ?? "").trim();
    const type = String(req.body?.type ?? "text").trim() === "voice" ? "voice" : "text";
    const isPrivate = Boolean(req.body?.isPrivate);

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    if (name.length < 2) return reply.code(400).send({ error: "CHANNEL_NAME_REQUIRED" });

    const isAllowedToManageChannels = await canManageChannel(serverId, userId);
    if (!isAllowedToManageChannels) {
      return reply.code(403).send({ error: "MANAGE_CHANNELS_FORBIDDEN" });
    }

    const channelId = randomUUID();
    const nextPosition = await getNextChannelPosition(serverId, type);

    await db.query(
      `INSERT INTO channels (id, server_id, name, type, is_private, position, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [channelId, serverId, name, type, isPrivate, nextPosition]
    );

    emitServerEvent(app, serverId, {
      type: "SERVER_UPDATED",
      payload: { serverId },
    });

    emitServerEvent(app, serverId, {
      type: "SERVER_CHANNELS_UPDATED",
      payload: { serverId },
    });

    return {
      id: channelId,
      name,
      type,
      serverId,
      isPrivate,
      position: nextPosition,
    };
  });

  app.patch("/:id", { preHandler: [app.auth] }, async (req: any, reply) => {
    const u: any = req.user;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
    const channelId = String(req.params.id);
    const name = String(req.body?.name ?? "").trim();

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    if (name.length < 2) return reply.code(400).send({ error: "CHANNEL_NAME_REQUIRED" });

    const channel = await getChannelById(channelId);
    if (!channel) return reply.code(404).send({ error: "CHANNEL_NOT_FOUND" });

    const isAllowedToManageChannels = await canManageChannel(String(channel.server_id), userId);
    if (!isAllowedToManageChannels) {
      return reply.code(403).send({ error: "MANAGE_CHANNELS_FORBIDDEN" });
    }

    await db.query(`UPDATE channels SET name = $2 WHERE id = $1`, [channelId, name]);

    emitServerEvent(app, String(channel.server_id), {
      type: "SERVER_UPDATED",
      payload: { serverId: String(channel.server_id) },
    });

    emitServerEvent(app, String(channel.server_id), {
      type: "SERVER_CHANNELS_UPDATED",
      payload: { serverId: String(channel.server_id) },
    });

    return {
      id: channelId,
      name,
      type: channel.type,
      serverId: channel.server_id,
      isPrivate: Boolean(channel.is_private),
      position: Number(channel.position ?? 0),
    };
  });

  app.delete("/:id", { preHandler: [app.auth] }, async (req: any, reply) => {
    const u: any = req.user;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
    const channelId = String(req.params.id);

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });

    const channel = await getChannelById(channelId);
    if (!channel) return reply.code(404).send({ error: "CHANNEL_NOT_FOUND" });

    const isAllowedToManageChannels = await canManageChannel(String(channel.server_id), userId);
    if (!isAllowedToManageChannels) {
      return reply.code(403).send({ error: "MANAGE_CHANNELS_FORBIDDEN" });
    }

    await db.query("BEGIN");
    try {
      await db.query(`DELETE FROM pinned_messages WHERE channel_id = $1`, [channelId]);
      await db.query(`DELETE FROM channel_messages WHERE channel_id = $1`, [channelId]);
      await db.query(`DELETE FROM channel_members WHERE channel_id = $1`, [channelId]);
      await db.query(`DELETE FROM channels WHERE id = $1`, [channelId]);
      await compactChannelPositionsForType(
        String(channel.server_id),
        String(channel.type) === "voice" ? "voice" : "text"
      );
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }

    emitServerEvent(app, String(channel.server_id), {
      type: "SERVER_UPDATED",
      payload: { serverId: String(channel.server_id) },
    });

    emitServerEvent(app, String(channel.server_id), {
      type: "SERVER_CHANNELS_UPDATED",
      payload: { serverId: String(channel.server_id) },
    });

    return { ok: true };
  });


  app.patch("/reorder", { preHandler: [app.auth] }, async (req: any, reply) => {
    const u: any = req.user;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
    const serverId = String(req.body?.serverId ?? "").trim();
    const type = String(req.body?.type ?? "").trim() === "voice" ? "voice" : "text";
    const orderedChannelIds = Array.isArray(req.body?.orderedChannelIds)
      ? req.body.orderedChannelIds.map((value: unknown) => String(value ?? "").trim()).filter(Boolean)
      : [];

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    if (!serverId) return reply.code(400).send({ error: "SERVER_ID_REQUIRED" });
    if (orderedChannelIds.length === 0) {
      return reply.code(400).send({ error: "ORDERED_CHANNEL_IDS_REQUIRED" });
    }

    const isAllowedToManageChannels = await canManageChannel(serverId, userId);
    if (!isAllowedToManageChannels) {
      return reply.code(403).send({ error: "MANAGE_CHANNELS_FORBIDDEN" });
    }

    const channelsResult = await db.query(
      `SELECT id, type, server_id
       FROM channels
       WHERE server_id = $1 AND type = $2`,
      [serverId, type]
    );

    const existingIds = channelsResult.rows.map((row) => String(row.id));
    const existingSet = new Set(existingIds);
    const requestedSet = new Set(orderedChannelIds);

    if (existingIds.length !== orderedChannelIds.length) {
      return reply.code(400).send({ error: "CHANNEL_REORDER_LENGTH_MISMATCH" });
    }

    for (const channelId of orderedChannelIds) {
      if (!existingSet.has(channelId)) {
        return reply.code(400).send({ error: "CHANNEL_REORDER_INVALID_CHANNEL" });
      }
    }

    if (requestedSet.size !== orderedChannelIds.length) {
      return reply.code(400).send({ error: "CHANNEL_REORDER_DUPLICATE_IDS" });
    }

    await db.query("BEGIN");
    try {
      for (let i = 0; i < orderedChannelIds.length; i += 1) {
        await db.query(
          `UPDATE channels
           SET position = $2
           WHERE id = $1`,
          [orderedChannelIds[i], i]
        );
      }

      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }

    emitServerEvent(app, serverId, {
      type: "SERVER_UPDATED",
      payload: { serverId },
    });

    emitServerEvent(app, serverId, {
      type: "SERVER_CHANNELS_UPDATED",
      payload: { serverId },
    });

    return { ok: true };
  });

  app.get("/:id/messages", { preHandler: [app.auth] }, async (req: any, reply) => {
    const u: any = req.user;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
    const channelId = String(req.params.id);
    const limit = Math.min(Math.max(Number(req.query?.limit) || 50, 1), 100);
    const beforeRaw = req.query?.before ? String(req.query.before).trim() : "";
    const before = beforeRaw ? new Date(beforeRaw) : null;

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });

    const channel = await getChannelById(channelId);
    if (!channel) return reply.code(404).send({ error: "CHANNEL_NOT_FOUND" });
    if (channel.type !== "text") return reply.code(400).send({ error: "NOT_A_TEXT_CHANNEL" });

    const canViewChannel = await ensureChannelAccess(
      String(channel.server_id),
      channelId,
      userId,
      "view_channel",
      Boolean(channel.is_private)
    );
    if (!canViewChannel) return reply.code(403).send({ error: "CHANNEL_VIEW_FORBIDDEN" });

    const queryParams: any[] = [channelId];
    let whereBefore = "";

    if (before && !Number.isNaN(before.getTime())) {
      whereBefore = ` AND cm.created_at < $2`;
      queryParams.push(before.toISOString());
    }

    queryParams.push(limit + 1);

    const messagesRes = await db.query(
      `SELECT id
       FROM channel_messages cm
       WHERE cm.channel_id = $1${whereBefore}
       ORDER BY cm.created_at DESC, cm.id DESC
       LIMIT $${queryParams.length}`,
      queryParams
    );

    const rows = messagesRes.rows.map((row) => String(row.id));
    const hasMore = rows.length > limit;
    const pageIds = hasMore ? rows.slice(0, limit) : rows;

    const payloads = await Promise.all(
      pageIds.reverse().map((id) => getMessagePayload(id))
    );

    const messages = payloads.filter(Boolean);
    const oldestMessage = messages[0] as any;

    return {
      messages,
      hasMore,
      nextBefore: oldestMessage?.createdAt ?? null,
    };
  });

  app.post("/:id/messages", { preHandler: [app.auth] }, async (req: any, reply) => {
    const u: any = req.user;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
    const channelId = String(req.params.id);

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });

    let parsed;
    try {
      parsed = await parseIncomingMessageRequest(req);
    } catch (error: any) {
      if (error?.message === "TOO_MANY_ATTACHMENTS") {
        return reply.code(400).send({ error: "TOO_MANY_ATTACHMENTS" });
      }
      req.log.error(error, "channel multipart parse failed");
      return reply.code(400).send({ error: "INVALID_MULTIPART_PAYLOAD" });
    }

    const { content, replyToMessageId, attachments } = parsed;

    if (!content && attachments.length === 0) {
      return reply.code(400).send({ error: "MESSAGE_CONTENT_REQUIRED" });
    }

    if (content.length > 4000) {
      return reply.code(400).send({ error: "MESSAGE_TOO_LONG" });
    }

    const channel = await getChannelById(channelId);
    if (!channel) return reply.code(404).send({ error: "CHANNEL_NOT_FOUND" });
    if (channel.type !== "text") return reply.code(400).send({ error: "NOT_A_TEXT_CHANNEL" });

    const canSendMessages = await ensureChannelAccess(
      String(channel.server_id),
      channelId,
      userId,
      "send_messages",
      Boolean(channel.is_private)
    );
    if (!canSendMessages) return reply.code(403).send({ error: "SEND_MESSAGES_FORBIDDEN" });

    if (replyToMessageId) {
      const replyTargetRes = await db.query(
        `SELECT id, channel_id, deleted_at
         FROM channel_messages
         WHERE id = $1`,
        [replyToMessageId]
      );

      if ((replyTargetRes.rowCount ?? 0) === 0) {
        return reply.code(404).send({ error: "REPLY_TARGET_NOT_FOUND" });
      }

      const replyTarget = replyTargetRes.rows[0];
      if (String(replyTarget.channel_id) !== channelId) {
        return reply.code(400).send({ error: "REPLY_TARGET_INVALID_CHANNEL" });
      }
    }

    const messageId = randomUUID();

    const attachmentsWithMedia = [];
    for (const attachment of attachments) {
      const mediaObjectId = await createMediaObject({
        storageKey: getStorageKeyFromPublicUrl(attachment.url),
        publicUrl: attachment.url,
        kind: attachment.kind,
        mimeType: attachment.mimeType,
        originalName: attachment.originalName,
        sizeBytes: attachment.sizeBytes,
        uploadedByUserId: userId,
        sourceType: "channel",
        sourceId: channelId,
        uploadIp: req.ip ?? null,
        metadata: {
          channelId,
          serverId: String(channel.server_id),
        },
      });
      await createMediaEventLog({
        mediaObjectId,
        eventType: "uploaded",
        actorUserId: userId,
        actorIp: req.ip ?? null,
        sourceType: "channel",
        sourceId: channelId,
        details: {
          channelId,
          serverId: String(channel.server_id),
          originalName: attachment.originalName,
        },
      });
      attachmentsWithMedia.push({ ...attachment, mediaObjectId });
    }

    await db.query("BEGIN");
    try {
      await db.query(
        `INSERT INTO channel_messages (id, channel_id, user_id, content, reply_to_message_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [messageId, channelId, userId, content, replyToMessageId]
      );

      for (const attachment of attachmentsWithMedia) {
        await db.query(
          `INSERT INTO channel_message_attachments (id, message_id, kind, url, original_name, mime_type, size_bytes, media_object_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            randomUUID(),
            messageId,
            attachment.kind,
            attachment.url,
            attachment.originalName,
            attachment.mimeType,
            attachment.sizeBytes,
            attachment.mediaObjectId ?? null,
          ]
        );
      }

      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }

    for (const attachment of attachmentsWithMedia) {
      if (!attachment.mediaObjectId) continue;
      await createMediaEventLog({
        mediaObjectId: attachment.mediaObjectId,
        eventType: "attached_to_channel",
        actorUserId: userId,
        actorIp: req.ip ?? null,
        sourceType: "channel",
        sourceId: channelId,
        messageId,
        details: {
          channelId,
          serverId: String(channel.server_id),
          attachmentKind: attachment.kind,
        },
      });
    }

    const messagePayload = await getMessagePayload(messageId);

    broadcast(channelId, {
      type: "NEW_CHANNEL_MESSAGE",
      payload: messagePayload,
    });

    emitTextChannelUnread(app, {
      serverId: String(channel.server_id),
      channelId,
      messageId,
      senderUserId: userId,
    });

    await createGeneralAuditLog({
      eventType: "message_sent_channel",
      actorUserId: userId,
      actorIp: req.ip ?? null,
      serverId: String(channel.server_id),
      channelId,
      messageId,
      details: {
        hasText: Boolean(String(content ?? "").trim()),
        attachmentCount: attachments.length,
      },
    });

    return messagePayload;
  });

  app.patch("/messages/:messageId", { preHandler: [app.auth] }, async (req: any, reply) => {
    const u: any = req.user;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
    const messageId = String(req.params.messageId);
    const content = String(req.body?.content ?? "").trim();

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    if (!content) return reply.code(400).send({ error: "MESSAGE_CONTENT_REQUIRED" });
    if (content.length > 4000) return reply.code(400).send({ error: "MESSAGE_TOO_LONG" });

    const messageRes = await db.query(
      `SELECT id, channel_id, user_id, deleted_at
       FROM channel_messages
       WHERE id = $1`,
      [messageId]
    );

    if ((messageRes.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: "MESSAGE_NOT_FOUND" });
    }

    const message = messageRes.rows[0];

    if (String(message.user_id) !== userId) {
      return reply.code(403).send({ error: "MESSAGE_EDIT_FORBIDDEN" });
    }

    if (message.deleted_at) {
      return reply.code(400).send({ error: "MESSAGE_ALREADY_DELETED" });
    }

    await db.query(
      `UPDATE channel_messages
       SET content = $2,
           edited_at = NOW()
       WHERE id = $1`,
      [messageId, content]
    );

    const payload = await getMessagePayload(messageId);

    broadcast(String(message.channel_id), {
      type: "CHANNEL_MESSAGE_UPDATED",
      payload,
    });

    return payload;
  });

  app.delete("/messages/:messageId", { preHandler: [app.auth] }, async (req: any, reply) => {
    const u: any = req.user;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
    const messageId = String(req.params.messageId);

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });

    const messageRes = await db.query(
      `SELECT id, channel_id, user_id, deleted_at
       FROM channel_messages
       WHERE id = $1`,
      [messageId]
    );

    if ((messageRes.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: "MESSAGE_NOT_FOUND" });
    }

    const message = messageRes.rows[0];

    if (String(message.user_id) !== userId) {
      return reply.code(403).send({ error: "MESSAGE_DELETE_FORBIDDEN" });
    }

    if (!message.deleted_at) {
      await db.query(
        `UPDATE channel_messages
         SET content = '',
             deleted_at = NOW()
         WHERE id = $1`,
        [messageId]
      );

      await scheduleMediaRetentionForMessage({
        messageId,
        sourceType: "channel",
        actorUserId: userId,
        actorIp: req.ip ?? null,
        retentionDays: 30,
      });
    }

    const payload = await getMessagePayload(messageId);

    broadcast(String(message.channel_id), {
      type: "CHANNEL_MESSAGE_DELETED",
      payload,
    });

    await createGeneralAuditLog({
      eventType: "message_deleted_channel",
      actorUserId: userId,
      actorIp: req.ip ?? null,
      channelId: String(message.channel_id),
      messageId,
      details: {},
    });

    return { ok: true, payload };
  });

  app.post("/messages/:messageId/pin", { preHandler: [app.auth] }, async (req: any, reply) => {
    const u: any = req.user;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
    const messageId = String(req.params.messageId);

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });

    const messageRes = await db.query(
      `SELECT cm.id, cm.channel_id, c.server_id, cm.deleted_at
       FROM channel_messages cm
       JOIN channels c ON c.id = cm.channel_id
       WHERE cm.id = $1`,
      [messageId]
    );

    if ((messageRes.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: "MESSAGE_NOT_FOUND" });
    }

    const message = messageRes.rows[0];

    const canViewChannel = await ensureChannelAccess(
      String(message.server_id),
      String(message.channel_id),
      userId,
      "view_channel",
      false
    );
    if (!canViewChannel) return reply.code(403).send({ error: "CHANNEL_VIEW_FORBIDDEN" });
    if (message.deleted_at) return reply.code(400).send({ error: "MESSAGE_ALREADY_DELETED" });

    await db.query(
      `INSERT INTO pinned_messages (id, channel_id, message_id, pinned_by, pinned_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (message_id) DO NOTHING`,
      [randomUUID(), message.channel_id, messageId, userId]
    );

    const payload = await getMessagePayload(messageId);

    broadcast(String(message.channel_id), {
      type: "CHANNEL_MESSAGE_PINNED",
      payload,
    });

    return payload;
  });

  app.delete("/messages/:messageId/pin", { preHandler: [app.auth] }, async (req: any, reply) => {
    const u: any = req.user;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
    const messageId = String(req.params.messageId);

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });

    const messageRes = await db.query(
      `SELECT cm.id, cm.channel_id, c.server_id
       FROM channel_messages cm
       JOIN channels c ON c.id = cm.channel_id
       WHERE cm.id = $1`,
      [messageId]
    );

    if ((messageRes.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: "MESSAGE_NOT_FOUND" });
    }

    const message = messageRes.rows[0];
    const canViewChannel = await ensureChannelAccess(
      String(message.server_id),
      String(message.channel_id),
      userId,
      "view_channel",
      false
    );
    if (!canViewChannel) return reply.code(403).send({ error: "CHANNEL_VIEW_FORBIDDEN" });

    await db.query(`DELETE FROM pinned_messages WHERE message_id = $1`, [messageId]);
    const payload = await getMessagePayload(messageId);

    broadcast(String(message.channel_id), {
      type: "CHANNEL_MESSAGE_UNPINNED",
      payload,
    });

    return { ok: true, payload };
  });

  app.get("/:id/ws", { websocket: true }, (ws: any, req: any) => {
    const channelId = String((req.params as any)?.id ?? "");

    try {
      const token = String(req.query?.token ?? "");
      const decoded = token ? app.jwt.verify(token) : null;
      const userId = String((decoded as any)?.id ?? (decoded as any)?.userId ?? (decoded as any)?.sub ?? "");

      if (!userId || !channelId) {
        ws.close(1008, "Invalid token payload");
        return;
      }

      ws.userId = userId;
      ws.channelId = channelId;

      if (!channelSockets.has(channelId)) {
        channelSockets.set(channelId, new Set());
      }

      channelSockets.get(channelId)!.add(ws);
      ws.send(JSON.stringify({ type: "WELCOME", channelId, userId }));

      ws.on("message", (msg: Buffer) => {
        try {
          const data = JSON.parse(msg.toString());
          if (data.type === "PING") {
            ws.send(JSON.stringify({ type: "PONG" }));
          }
        } catch {}
      });

      ws.on("close", () => {
        const set = channelSockets.get(channelId);
        if (!set) return;
        set.delete(ws);
        if (set.size === 0) {
          channelSockets.delete(channelId);
        }
      });
    } catch {
      ws.close(1008, "Invalid token");
    }
  });

  app.post("/:id/join", { preHandler: [app.auth] }, async (req: any, reply) => {
    const channelId = String((req.params as any).id ?? "");
    const u: any = req.user;
    const userId: string | undefined = u?.id ?? u?.userId ?? u?.sub;

    if (!userId) {
      return reply.code(401).send({ error: "UNAUTHORIZED_NO_USERID" });
    }

    try {
      const ch = await db.query(
        `SELECT id, server_id, type, is_private
         FROM channels
         WHERE id = $1`,
        [channelId]
      );

      if ((ch.rowCount ?? 0) === 0) {
        return reply.code(404).send({ error: "CHANNEL_NOT_FOUND" });
      }

      const channel = ch.rows[0];
      const permissionKey: ServerPermission = String(channel.type) === "voice" ? "connect" : "view_channel";
      const canJoin = await ensureChannelAccess(
        String(channel.server_id),
        channelId,
        userId,
        permissionKey,
        Boolean(channel.is_private)
      );

      if (!canJoin) {
        return reply.code(403).send({ error: "CHANNEL_JOIN_FORBIDDEN" });
      }

      await db.query(
        `INSERT INTO channel_members (channel_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (channel_id, user_id) DO NOTHING`,
        [channelId, userId, "member"]
      );

      broadcast(channelId, { type: "USER_JOINED", userId });
      return { ok: true };
    } catch (e: any) {
      app.log.error({ err: e, channelId, userId }, "JOIN_FAILED_DB_ERROR");
      return reply.code(500).send({ error: "JOIN_FAILED", detail: e?.message });
    }
  });

  app.post("/:id/leave", { preHandler: [app.auth] }, async (req: any) => {
    const channelId = String((req.params as any).id ?? "");
    const u: any = req.user;
    const userId: string | undefined = u?.id ?? u?.userId ?? u?.sub;

    if (!userId) return { ok: true };

    await db.query(
      `DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2`,
      [channelId, userId]
    );

    broadcast(channelId, { type: "USER_LEFT", userId });
    return { ok: true };
  });

  app.get("/:id/members", { preHandler: [app.auth] }, async (req: any) => {
    const channelId = String((req.params as any).id ?? "");

    const r = await db.query(
      `SELECT u.id, u.display_name
       FROM channel_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.channel_id = $1
       ORDER BY u.display_name`,
      [channelId]
    );

    return r.rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
    }));
  });
};
