import { randomUUID } from "crypto";
import { db } from "../db";
import { scheduleMediaRetentionForMessage } from "../services/mediaAuditService";

const FRIENDSHIP_ACCEPTED_STATUS = "accepted";
const SYSTEM_MESSAGE_PREFIX = "__SYSTEM__:";

type UserRow = {
  id: string;
  username: string | null;
  display_name: string;
  allow_server_dms: boolean;
};

type DirectConversationRow = {
  id: string;
  user_one_id: string;
  user_two_id: string;
  created_at: string;
  updated_at?: string;
};

type DirectMessageRow = {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  content: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  reply_to_message_id: string | null;
  is_pinned: boolean;
  pinned_at: string | null;
  pinned_by: string | null;
  reply_to_sender_user_id?: string | null;
  reply_to_content?: string | null;
  reply_to_deleted_at?: string | null;
  reply_to_display_name?: string | null;
  reply_to_username?: string | null;
};


type DirectMessageAttachmentRow = {
  id: string;
  message_id: string;
  kind: "image" | "video" | "file";
  url: string;
  original_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
  media_object_id?: string | null;
};

export type NewDirectMessageAttachmentInput = {
  kind: "image" | "video" | "file";
  url: string;
  originalName: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  mediaObjectId?: string | null;
};

export type DmSystemMessageType =
  | "call_started"
  | "call_accepted"
  | "call_rejected"
  | "call_missed"
  | "call_ended";

export type DmSystemMessageMeta = {
  type: DmSystemMessageType;
  actorUserId?: string | null;
  actorDisplayName?: string | null;
  targetUserId?: string | null;
  targetDisplayName?: string | null;
  durationSeconds?: number | null;
};

function normalizePair(a: string, b: string) {
  return [a, b].sort((x, y) => x.localeCompare(y)) as [string, string];
}

function encodeSystemMessage(meta: DmSystemMessageMeta) {
  return `${SYSTEM_MESSAGE_PREFIX}${JSON.stringify(meta)}`;
}

export function isEncodedSystemMessage(content: string) {
  return typeof content === "string" && content.startsWith(SYSTEM_MESSAGE_PREFIX);
}

export function tryDecodeSystemMessage(content: string): DmSystemMessageMeta | null {
  if (!isEncodedSystemMessage(content)) return null;

  try {
    return JSON.parse(content.slice(SYSTEM_MESSAGE_PREFIX.length));
  } catch {
    return null;
  }
}

function mapConversationRow(
  row: DirectConversationRow,
  otherUser?: {
    id: string;
    username: string | null;
    display_name: string;
    avatar_url?: string | null;
  } | null,
  lastMessage?: {
    id: string;
    content: string;
    created_at: string;
    sender_user_id: string;
    edited_at: string | null;
  } | null
) {
  return {
    id: row.id,
    userOneId: row.user_one_id,
    userTwoId: row.user_two_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    otherUser: otherUser
      ? {
          id: otherUser.id,
          username: otherUser.username,
          displayName: otherUser.display_name,
          avatarUrl: otherUser.avatar_url ?? null,
        }
      : null,
    lastMessage: lastMessage
      ? {
          id: lastMessage.id,
          content: lastMessage.content,
          createdAt: lastMessage.created_at,
          senderUserId: lastMessage.sender_user_id,
          editedAt: lastMessage.edited_at,
        }
      : null,
  };
}

function mapMessageRow(row: DirectMessageRow, attachmentsByMessageId?: Map<string, any[]>) {
  const rawContent = row.deleted_at ? "" : row.content;
  const systemMeta = row.deleted_at ? null : tryDecodeSystemMessage(rawContent);
  const attachments = row.deleted_at ? [] : (attachmentsByMessageId?.get(row.id) || []);

  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderUserId: row.sender_user_id,
    content: rawContent,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    replyToMessageId: row.reply_to_message_id,
    replyTo:
      row.reply_to_message_id && row.reply_to_sender_user_id
        ? {
            id: row.reply_to_message_id,
            userId: row.reply_to_sender_user_id,
            displayName: row.reply_to_display_name || "Kullanıcı",
            username: row.reply_to_username || undefined,
            content: row.reply_to_deleted_at ? "" : row.reply_to_content || "",
          }
        : null,
    isPinned: Boolean(row.is_pinned),
    pinnedAt: row.pinned_at,
    pinnedBy: row.pinned_by,
    messageType: systemMeta ? "system" : "user",
    systemMeta,
    attachments,
  };
}


function mapAttachmentRow(row: DirectMessageAttachmentRow) {
  return {
    id: row.id,
    messageId: row.message_id,
    kind: row.kind,
    url: row.url,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes ?? undefined,
    createdAt: row.created_at,
    mediaObjectId: row.media_object_id ? String(row.media_object_id) : null,
  };
}

async function getAttachmentsForMessageIds(messageIds: string[]) {
  if (!messageIds.length) return new Map<string, any[]>();

  const result = await db.query<DirectMessageAttachmentRow>(
    `SELECT
       id,
       message_id,
       kind,
       url,
       original_name,
       mime_type,
       size_bytes,
       created_at,
       media_object_id
     FROM direct_message_attachments
     WHERE message_id = ANY($1::uuid[])
     ORDER BY created_at ASC, id ASC`,
    [messageIds]
  );

  const grouped = new Map<string, any[]>();
  for (const row of result.rows) {
    const next = grouped.get(row.message_id) || [];
    next.push(mapAttachmentRow(row));
    grouped.set(row.message_id, next);
  }
  return grouped;
}

export async function getDmSettings(userId: string) {
  const result = await db.query(
    `SELECT allow_server_dms
     FROM users
     WHERE id = $1`,
    [userId]
  );

  if (!result.rows.length) {
    throw new Error("USER_NOT_FOUND");
  }

  return {
    allowServerDms: Boolean(result.rows[0].allow_server_dms),
  };
}

export async function updateDmSettings(userId: string, allowServerDms: boolean) {
  const result = await db.query(
    `UPDATE users
     SET allow_server_dms = $2
     WHERE id = $1
     RETURNING allow_server_dms`,
    [userId, allowServerDms]
  );

  if (!result.rows.length) {
    throw new Error("USER_NOT_FOUND");
  }

  return {
    allowServerDms: Boolean(result.rows[0].allow_server_dms),
  };
}

export async function getUserById(userId: string) {
  const result = await db.query<UserRow>(
    `SELECT id, username, display_name, allow_server_dms
     FROM users
     WHERE id = $1`,
    [userId]
  );

  if (!result.rows.length) {
    return null;
  }

  const row = result.rows[0];

  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    allowServerDms: Boolean(row.allow_server_dms),
  };
}

export async function areFriends(userId: string, targetUserId: string) {
  const result = await db.query(
    `SELECT 1
     FROM friendships
     WHERE (
       (user_id = $1 AND friend_user_id = $2)
       OR
       (user_id = $2 AND friend_user_id = $1)
     )
     AND status = $3
     LIMIT 1`,
    [userId, targetUserId, FRIENDSHIP_ACCEPTED_STATUS]
  );

  return result.rows.length > 0;
}

export async function shareAnyServer(userId: string, targetUserId: string) {
  const result = await db.query(
    `SELECT 1
     FROM server_members sm1
     JOIN server_members sm2
       ON sm1.server_id = sm2.server_id
     WHERE sm1.user_id = $1
       AND sm2.user_id = $2
     LIMIT 1`,
    [userId, targetUserId]
  );

  return result.rows.length > 0;
}



export async function areUsersBlocked(userId: string, targetUserId: string) {
  const result = await db.query(
    `SELECT 1
     FROM user_blocks
     WHERE (user_id = $1 AND blocked_user_id = $2)
        OR (user_id = $2 AND blocked_user_id = $1)
     LIMIT 1`,
    [userId, targetUserId]
  );

  return result.rows.length > 0;
}

export async function canUsersDirectMessage(userId: string, targetUserId: string) {
  if (!userId || !targetUserId) {
    return {
      allowed: false,
      reason: "INVALID_USER",
    } as const;
  }

  if (userId === targetUserId) {
    return {
      allowed: false,
      reason: "CANNOT_DM_SELF",
    } as const;
  }

  if (await areUsersBlocked(userId, targetUserId)) {
    return {
      allowed: false,
      reason: "USER_BLOCKED",
    } as const;
  }

  const targetUser = await getUserById(targetUserId);
  if (!targetUser) {
    return {
      allowed: false,
      reason: "TARGET_USER_NOT_FOUND",
    } as const;
  }

  const friends = await areFriends(userId, targetUserId);
  if (friends) {
    return {
      allowed: true,
      reason: "FRIENDS",
    } as const;
  }

  const sharedServer = await shareAnyServer(userId, targetUserId);
  if (!sharedServer) {
    return {
      allowed: false,
      reason: "NO_SHARED_SERVER",
    } as const;
  }

  if (!targetUser.allowServerDms) {
    return {
      allowed: false,
      reason: "TARGET_BLOCKS_SERVER_DMS",
    } as const;
  }

  return {
    allowed: true,
    reason: "SHARED_SERVER",
  } as const;
}

export async function getConversationById(conversationId: string) {
  const result = await db.query<DirectConversationRow>(
    `SELECT id, user_one_id, user_two_id, created_at, updated_at
     FROM direct_conversations
     WHERE id = $1`,
    [conversationId]
  );

  if (!result.rows.length) {
    return null;
  }

  return result.rows[0];
}

export async function isConversationParticipant(userId: string, conversationId: string) {
  const result = await db.query(
    `SELECT 1
     FROM direct_conversations
     WHERE id = $1
       AND (user_one_id = $2 OR user_two_id = $2)
     LIMIT 1`,
    [conversationId, userId]
  );

  return result.rows.length > 0;
}

export async function getOrCreateConversation(userId: string, targetUserId: string) {
  const permission = await canUsersDirectMessage(userId, targetUserId);

  if (!permission.allowed) {
    throw new Error(permission.reason);
  }

  const [userOneId, userTwoId] = normalizePair(userId, targetUserId);

  const existing = await db.query<DirectConversationRow>(
    `SELECT id, user_one_id, user_two_id, created_at, updated_at
     FROM direct_conversations
     WHERE user_one_id = $1 AND user_two_id = $2
     LIMIT 1`,
    [userOneId, userTwoId]
  );

  let conversation: DirectConversationRow | null =
    existing.rows.length > 0 ? existing.rows[0] : null;

  if (!conversation) {
    try {
      const created = await db.query<DirectConversationRow>(
        `INSERT INTO direct_conversations (
           id,
           user_one_id,
           user_two_id,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, now(), now())
         RETURNING id, user_one_id, user_two_id, created_at, updated_at`,
        [randomUUID(), userOneId, userTwoId]
      );

      conversation = created.rows[0];
    } catch (error: any) {
      if (error?.code !== "23505") {
        throw error;
      }

      const retry = await db.query<DirectConversationRow>(
        `SELECT id, user_one_id, user_two_id, created_at, updated_at
         FROM direct_conversations
         WHERE user_one_id = $1 AND user_two_id = $2
         LIMIT 1`,
        [userOneId, userTwoId]
      );

      if (!retry.rows.length) {
        throw error;
      }

      conversation = retry.rows[0];
    }
  }

  const otherUserId =
    conversation.user_one_id === userId
      ? conversation.user_two_id
      : conversation.user_one_id;

  const otherUserResult = await db.query(
    `SELECT id, username, display_name, avatar_url
     FROM users
     WHERE id = $1`,
    [otherUserId]
  );

  const otherUser = otherUserResult.rows.length > 0 ? otherUserResult.rows[0] : null;

  return mapConversationRow(conversation, otherUser, null);
}

export async function getUserConversations(userId: string) {
  const result = await db.query(
    `SELECT
       dc.id,
       dc.user_one_id,
       dc.user_two_id,
       dc.created_at,
       dc.updated_at,
       u.id AS other_user_id,
       u.username AS other_username,
       u.display_name AS other_display_name,
       u.avatar_url AS other_avatar_url,
       lm.id AS last_message_id,
       lm.content AS last_message_content,
       lm.created_at AS last_message_created_at,
       lm.sender_user_id AS last_message_sender_user_id,
       lm.edited_at AS last_message_edited_at
     FROM direct_conversations dc
     JOIN users u
       ON u.id = CASE
         WHEN dc.user_one_id = $1 THEN dc.user_two_id
         ELSE dc.user_one_id
       END
     LEFT JOIN LATERAL (
       SELECT
         dm.id,
         dm.content,
         dm.created_at,
         dm.sender_user_id,
         dm.edited_at
       FROM direct_messages dm
       WHERE dm.conversation_id = dc.id
       ORDER BY dm.created_at DESC
       LIMIT 1
     ) lm ON true
     WHERE dc.user_one_id = $1 OR dc.user_two_id = $1
     ORDER BY dc.updated_at DESC, dc.created_at DESC`,
    [userId]
  );

  return result.rows.map((row) =>
    mapConversationRow(
      {
        id: row.id,
        user_one_id: row.user_one_id,
        user_two_id: row.user_two_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
      {
        id: row.other_user_id,
        username: row.other_username,
        display_name: row.other_display_name,
        avatar_url: row.other_avatar_url,
      },
      row.last_message_id
        ? {
            id: row.last_message_id,
            content: row.last_message_content,
            created_at: row.last_message_created_at,
            sender_user_id: row.last_message_sender_user_id,
            edited_at: row.last_message_edited_at,
          }
        : null
    )
  );
}

export async function getConversationMessages(
  userId: string,
  conversationId: string,
  limit = 50,
  beforeMessageId?: string | null
) {
  const allowed = await isConversationParticipant(userId, conversationId);
  if (!allowed) {
    throw new Error("CONVERSATION_FORBIDDEN");
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const safeBeforeMessageId = String(beforeMessageId ?? "").trim() || null;

  const result = await db.query<DirectMessageRow>(
    `SELECT
       dm.id,
       dm.conversation_id,
       dm.sender_user_id,
       dm.content,
       dm.created_at,
       dm.edited_at,
       dm.deleted_at,
       dm.reply_to_message_id,
       dm.is_pinned,
       dm.pinned_at,
       dm.pinned_by,
       r.sender_user_id AS reply_to_sender_user_id,
       r.content AS reply_to_content,
       r.deleted_at AS reply_to_deleted_at,
       ru.display_name AS reply_to_display_name,
       ru.username AS reply_to_username
     FROM direct_messages dm
     LEFT JOIN direct_messages r
       ON r.id = dm.reply_to_message_id
     LEFT JOIN users ru
       ON ru.id = r.sender_user_id
     WHERE dm.conversation_id = $1
       AND (
         $2::uuid IS NULL
         OR dm.created_at < (
           SELECT created_at
           FROM direct_messages
           WHERE id = $2
             AND conversation_id = $1
           LIMIT 1
         )
         OR (
           dm.created_at = (
             SELECT created_at
             FROM direct_messages
             WHERE id = $2
               AND conversation_id = $1
             LIMIT 1
           )
           AND dm.id < $2
         )
       )
     ORDER BY dm.created_at DESC, dm.id DESC
     LIMIT $3`,
    [conversationId, safeBeforeMessageId, safeLimit]
  );

  const orderedRows = result.rows.reverse();
  const attachmentsByMessageId = await getAttachmentsForMessageIds(orderedRows.map((row) => row.id));
  return orderedRows.map((row) => mapMessageRow(row, attachmentsByMessageId));
}

export async function sendDirectMessage(
  userId: string,
  conversationId: string,
  rawContent: string,
  replyToMessageId?: string | null,
  attachmentsInput: NewDirectMessageAttachmentInput[] = []
) {
  const allowed = await isConversationParticipant(userId, conversationId);
  if (!allowed) {
    throw new Error("CONVERSATION_FORBIDDEN");
  }

  const conversation = await getConversationById(conversationId);
  if (!conversation) {
    throw new Error("CONVERSATION_FORBIDDEN");
  }

  const targetUserId = conversation.user_one_id === userId ? conversation.user_two_id : conversation.user_one_id;
  if (await areUsersBlocked(userId, targetUserId)) {
    throw new Error("USER_BLOCKED");
  }

  const content = String(rawContent ?? "").trim();
  const attachments = Array.isArray(attachmentsInput) ? attachmentsInput.slice(0, 10) : [];

  if (!content && attachments.length === 0) {
    throw new Error("MESSAGE_CONTENT_REQUIRED");
  }

  if (content.length > 4000) {
    throw new Error("MESSAGE_TOO_LONG");
  }

  const messageId = randomUUID();
  const safeReplyToMessageId = replyToMessageId ? String(replyToMessageId).trim() : null;

  await db.query("BEGIN");

  try {
    if (safeReplyToMessageId) {
      const replyCheck = await db.query(
        `SELECT 1
         FROM direct_messages
         WHERE id = $1
           AND conversation_id = $2
         LIMIT 1`,
        [safeReplyToMessageId, conversationId]
      );

      if (!replyCheck.rows.length) {
        throw new Error("REPLY_MESSAGE_NOT_FOUND");
      }
    }

    await db.query<DirectMessageRow>(
      `INSERT INTO direct_messages (
         id,
         conversation_id,
         sender_user_id,
         content,
         created_at,
         edited_at,
         deleted_at,
         reply_to_message_id,
         is_pinned,
         pinned_at,
         pinned_by
       )
       VALUES ($1, $2, $3, $4, now(), null, null, $5, false, null, null)`,
      [messageId, conversationId, userId, content, safeReplyToMessageId]
    );

    for (const attachment of attachments) {
      await db.query(
        `INSERT INTO direct_message_attachments (
           id,
           message_id,
           kind,
           url,
           original_name,
           mime_type,
           size_bytes,
           media_object_id,
           created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
        [
          randomUUID(),
          messageId,
          attachment.kind,
          attachment.url,
          attachment.originalName,
          attachment.mimeType ?? null,
          attachment.sizeBytes ?? null,
          attachment.mediaObjectId ?? null,
        ]
      );
    }

    await db.query(
      `UPDATE direct_conversations
       SET updated_at = now()
       WHERE id = $1`,
      [conversationId]
    );

    const inserted = await db.query<DirectMessageRow>(
      `SELECT
         dm.id,
         dm.conversation_id,
         dm.sender_user_id,
         dm.content,
         dm.created_at,
         dm.edited_at,
         dm.deleted_at,
         dm.reply_to_message_id,
         dm.is_pinned,
         dm.pinned_at,
         dm.pinned_by,
         r.sender_user_id AS reply_to_sender_user_id,
         r.content AS reply_to_content,
         r.deleted_at AS reply_to_deleted_at,
         ru.display_name AS reply_to_display_name,
         ru.username AS reply_to_username
       FROM direct_messages dm
       LEFT JOIN direct_messages r
         ON r.id = dm.reply_to_message_id
       LEFT JOIN users ru
         ON ru.id = r.sender_user_id
       WHERE dm.id = $1
       LIMIT 1`,
      [messageId]
    );

    await db.query("COMMIT");

    const attachmentsByMessageId = await getAttachmentsForMessageIds([inserted.rows[0].id]);
    return mapMessageRow(inserted.rows[0], attachmentsByMessageId);
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

export async function sendDirectSystemMessage(
  actorUserId: string,
  conversationId: string,
  meta: DmSystemMessageMeta
) {
  const allowed = await isConversationParticipant(actorUserId, conversationId);
  if (!allowed) {
    throw new Error("CONVERSATION_FORBIDDEN");
  }

  const content = encodeSystemMessage(meta);
  const messageId = randomUUID();

  await db.query("BEGIN");

  try {
    await db.query<DirectMessageRow>(
      `INSERT INTO direct_messages (
         id,
         conversation_id,
         sender_user_id,
         content,
         created_at,
         edited_at,
         deleted_at,
         reply_to_message_id,
         is_pinned,
         pinned_at,
         pinned_by
       )
       VALUES ($1, $2, $3, $4, now(), null, null, null, false, null, null)`,
      [messageId, conversationId, actorUserId, content]
    );

    const inserted = await db.query<DirectMessageRow>(
      `SELECT
         dm.id,
         dm.conversation_id,
         dm.sender_user_id,
         dm.content,
         dm.created_at,
         dm.edited_at,
         dm.deleted_at,
         dm.reply_to_message_id,
         dm.is_pinned,
         dm.pinned_at,
         dm.pinned_by,
         r.sender_user_id AS reply_to_sender_user_id,
         r.content AS reply_to_content,
         r.deleted_at AS reply_to_deleted_at,
         ru.display_name AS reply_to_display_name,
         ru.username AS reply_to_username
       FROM direct_messages dm
       LEFT JOIN direct_messages r
         ON r.id = dm.reply_to_message_id
       LEFT JOIN users ru
         ON ru.id = r.sender_user_id
       WHERE dm.id = $1
       LIMIT 1`,
      [messageId]
    );

    await db.query(
      `UPDATE direct_conversations
       SET updated_at = now()
       WHERE id = $1`,
      [conversationId]
    );

    await db.query("COMMIT");

    const attachmentsByMessageId = await getAttachmentsForMessageIds([inserted.rows[0].id]);
    return mapMessageRow(inserted.rows[0], attachmentsByMessageId);
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

export async function getDirectMessageById(messageId: string) {
  const result = await db.query<DirectMessageRow>(
    `SELECT
       dm.id,
       dm.conversation_id,
       dm.sender_user_id,
       dm.content,
       dm.created_at,
       dm.edited_at,
       dm.deleted_at,
       dm.reply_to_message_id,
       dm.is_pinned,
       dm.pinned_at,
       dm.pinned_by,
       r.sender_user_id AS reply_to_sender_user_id,
       r.content AS reply_to_content,
       r.deleted_at AS reply_to_deleted_at,
       ru.display_name AS reply_to_display_name,
       ru.username AS reply_to_username
     FROM direct_messages dm
     LEFT JOIN direct_messages r
       ON r.id = dm.reply_to_message_id
     LEFT JOIN users ru
       ON ru.id = r.sender_user_id
     WHERE dm.id = $1
     LIMIT 1`,
    [messageId]
  );

  if (!result.rows.length) return null;
  const attachmentsByMessageId = await getAttachmentsForMessageIds([result.rows[0].id]);
  return mapMessageRow(result.rows[0], attachmentsByMessageId);
}

export async function updateDirectMessage(
  userId: string,
  messageId: string,
  rawContent: string
) {
  const content = String(rawContent ?? "").trim();
  if (!content) throw new Error("MESSAGE_CONTENT_REQUIRED");
  if (content.length > 4000) throw new Error("MESSAGE_TOO_LONG");

  const updated = await db.query<DirectMessageRow>(
    `UPDATE direct_messages dm
     SET content = $3,
         edited_at = now()
     WHERE dm.id = $1
       AND dm.sender_user_id = $2
       AND dm.deleted_at IS NULL
     RETURNING dm.id, dm.conversation_id, dm.sender_user_id, dm.content, dm.created_at, dm.edited_at, dm.deleted_at,
               dm.reply_to_message_id, dm.is_pinned, dm.pinned_at, dm.pinned_by`,
    [messageId, userId, content]
  );

  if (!updated.rows.length) {
    throw new Error("MESSAGE_NOT_FOUND_OR_FORBIDDEN");
  }

  return (await getDirectMessageById(messageId))!;
}

export async function deleteDirectMessage(userId: string, messageId: string, actorIp?: string | null) {
  const updated = await db.query<DirectMessageRow>(
    `UPDATE direct_messages dm
     SET deleted_at = now(),
         content = '',
         edited_at = coalesce(dm.edited_at, now()),
         is_pinned = false,
         pinned_at = null,
         pinned_by = null
     WHERE dm.id = $1
       AND dm.sender_user_id = $2
       AND dm.deleted_at IS NULL
     RETURNING dm.id`,
    [messageId, userId]
  );

  if (!updated.rows.length) {
    throw new Error("MESSAGE_NOT_FOUND_OR_FORBIDDEN");
  }

  await scheduleMediaRetentionForMessage({
    messageId,
    sourceType: "dm",
    actorUserId: userId,
    actorIp: actorIp ?? null,
    retentionDays: 30,
  });

  return (await getDirectMessageById(messageId))!;
}

export async function togglePinDirectMessage(
  userId: string,
  messageId: string,
  pin: boolean
) {
  const client = await db.connect();
  const nextPinned = Boolean(pin);

  try {
    await client.query("BEGIN");

    const existing = await client.query<DirectMessageRow & { conversation_id: string }>(
      `SELECT
         dm.id,
         dm.conversation_id,
         dm.sender_user_id,
         dm.content,
         dm.created_at,
         dm.edited_at,
         dm.deleted_at,
         dm.reply_to_message_id,
         dm.is_pinned,
         dm.pinned_at,
         dm.pinned_by
       FROM direct_messages dm
       JOIN direct_conversations dc
         ON dc.id = dm.conversation_id
       WHERE dm.id = $1
         AND (dc.user_one_id = $2 OR dc.user_two_id = $2)
         AND dm.deleted_at IS NULL
       LIMIT 1`,
      [messageId, userId]
    );

    if (!existing.rows.length) {
      throw new Error("MESSAGE_NOT_FOUND_OR_FORBIDDEN");
    }

    await client.query(
      `UPDATE direct_messages
       SET is_pinned = $2,
           pinned_at = CASE WHEN $2 THEN now() ELSE null END,
           pinned_by = CASE WHEN $2 THEN $3::uuid ELSE null END
       WHERE id = $1`,
      [messageId, nextPinned, userId]
    );

    await client.query(
      `UPDATE direct_conversations
       SET updated_at = now()
       WHERE id = $1`,
      [existing.rows[0].conversation_id]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return (await getDirectMessageById(messageId))!;
}
