import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { db } from "../db";
import { voicePresence } from "../services/voicePresence";
import {
  getConversationById,
  isConversationParticipant,
  sendDirectMessage,
  sendDirectSystemMessage,
  areUsersBlocked,
  updateDirectMessage,
  deleteDirectMessage,
  togglePinDirectMessage,
} from "../services/dmService";
import {
  startTyping,
  stopTyping,
  stopTypingEverywhereForUser,
} from "../services/dmTyping";
import { createGeneralAuditLog } from "../services/auditLogService";

type WsClient = {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  terminate?: () => void;
  ping?: (data?: unknown) => void;
  on: (
    event: "close" | "message" | "error" | "pong",
    cb: (...args: any[]) => void
  ) => void;
  readyState?: number;
  userId?: string;
  isAlive?: boolean;
  __viceClosed?: boolean;
};

type OnlineUser = {
  userId: string;
  username?: string;
  displayName: string;
  status: string;
  avatarUrl: string | null;
};

type IncomingWsMessage =
  | {
      type: "DM_SEND";
      payload?: {
        conversationId?: string;
        content?: string;
        tempId?: string;
        replyToMessageId?: string | null;
      };
    }
  | {
      type: "DM_EDIT";
      payload?: {
        messageId?: string;
        content?: string;
      };
    }
  | {
      type: "DM_DELETE";
      payload?: {
        messageId?: string;
      };
    }
  | {
      type: "DM_PIN";
      payload?: {
        messageId?: string;
        pin?: boolean;
      };
    }
  | {
      type: "DM_TYPING_START";
      payload?: {
        conversationId?: string;
      };
    }
  | {
      type: "DM_TYPING_STOP";
      payload?: {
        conversationId?: string;
      };
    }
  | {
      type: "DM_CALL_START";
      payload?: {
        conversationId?: string;
      };
    }
  | {
      type: "DM_CALL_ACCEPT";
      payload?: {
        conversationId?: string;
      };
    }
  | {
      type: "DM_CALL_REJECT";
      payload?: {
        conversationId?: string;
      };
    }
  | {
      type: "DM_CALL_END";
      payload?: {
        conversationId?: string;
      };
    }
  | {
      type: "VOICE_STREAM_ANNOUNCEMENTS_UPDATE";
      payload?: {
        channelId?: string;
        announcements?: Array<{
          trackSid?: string;
          participantId?: string;
          participantName?: string;
          source?: "camera" | "screen";
          previewDataUrl?: string | null;
          previewUpdatedAt?: number | null;
        }>;
        emittedAt?: number;
        trackSid?: string;
        source?: "camera" | "screen";
      };
    }
  | {
      type: "VOICE_STREAM_ANNOUNCEMENTS_CLEAR";
      payload?: {
        channelId?: string;
        trackSid?: string;
        source?: "camera" | "screen";
      };
    };

type DmCallSession = {
  conversationId: string;
  callerUserId: string;
  callerDisplayName: string;
  recipientUserId: string;
  roomName: string;
  startedAt: number;
  acceptedAt: number | null;
  activeParticipantUserIds: Set<string>;
};

type StreamAnnouncement = {
  trackSid: string;
  participantId: string;
  participantName: string;
  source: "camera" | "screen";
  previewDataUrl?: string | null;
  previewUpdatedAt?: number | null;
};

type VoiceStreamAnnouncementState = {
  channelId: string;
  userId: string;
  announcements: StreamAnnouncement[];
  updatedAt: number;
};

const userSockets = new Map<string, Set<WsClient>>();
const dmCallSessions = new Map<string, DmCallSession>();
const dmCallTimeouts = new Map<string, NodeJS.Timeout>();
const voiceStreamAnnouncementStates = new Map<string, VoiceStreamAnnouncementState>();

const DM_CALL_RING_TIMEOUT_MS = 30_000;



function getDmConversationIdFromChannelId(channelId: string | null | undefined) {
  const normalized = String(channelId ?? "").trim();
  if (!normalized.startsWith("dm:")) return null;

  const conversationId = normalized.slice(3).trim();
  return conversationId || null;
}

async function getAnnouncementRecipientUserIdsForChannel(channelId: string) {
  const conversationId = getDmConversationIdFromChannelId(channelId);

  if (!conversationId) {
    return null;
  }

  const conversation = await getConversationById(conversationId);
  if (!conversation) {
    return [];
  }

  return [conversation.user_one_id, conversation.user_two_id];
}

function buildVoiceStreamAnnouncementsSnapshotPayloadForChannelIds(
  allowedChannelIds?: Set<string> | null
) {
  const announcementsByChannel: Record<
    string,
    { channelId: string; announcements: StreamAnnouncement[]; updatedAt: number }
  > = {};

  for (const state of voiceStreamAnnouncementStates.values()) {
    if (!state.channelId || state.announcements.length === 0) continue;
    if (allowedChannelIds && !allowedChannelIds.has(state.channelId)) continue;

    const current = announcementsByChannel[state.channelId] ?? {
      channelId: state.channelId,
      announcements: [],
      updatedAt: state.updatedAt,
    };

    current.announcements.push(...state.announcements);
    current.updatedAt = Math.max(current.updatedAt, state.updatedAt);
    announcementsByChannel[state.channelId] = current;
  }

  return { announcementsByChannel };
}

function getVoiceStreamAnnouncementStateKey(
  userId: string,
  source: "camera" | "screen",
  channelId: string
) {
  return `${userId}:${channelId}:${source}`;
}

function safeSend(client: WsClient, payload: unknown) {
  try {
    client.send(JSON.stringify(payload));
  } catch {}
}

function markSocketAlive(client: WsClient) {
  client.isAlive = true;
}

function terminateSocket(client: WsClient) {
  if (client.__viceClosed) return;
  client.__viceClosed = true;

  try {
    client.terminate?.();
    return;
  } catch {}

  try {
    client.close(4000, "stale_socket");
  } catch {}
}

function isSocketDead(client: WsClient) {
  return client.readyState === 3 || client.__viceClosed === true;
}

function cleanupDeadSocketsForUser(userId: string) {
  const sockets = userSockets.get(userId);
  if (!sockets) return 0;

  for (const socket of Array.from(sockets)) {
    if (isSocketDead(socket)) {
      sockets.delete(socket);
    }
  }

  if (sockets.size === 0) {
    userSockets.delete(userId);
    return 0;
  }

  return sockets.size;
}

function cleanupAllDeadSockets() {
  for (const userId of Array.from(userSockets.keys())) {
    cleanupDeadSocketsForUser(userId);
  }
}

function addUserSocket(userId: string, client: WsClient) {
  cleanupDeadSocketsForUser(userId);

  let sockets = userSockets.get(userId);
  if (!sockets) {
    sockets = new Set<WsClient>();
    userSockets.set(userId, sockets);
  }
  sockets.add(client);
}

function removeUserSocket(userId: string, client: WsClient) {
  const sockets = userSockets.get(userId);
  if (!sockets) return;

  sockets.delete(client);
  cleanupDeadSocketsForUser(userId);

  if (sockets.size === 0) {
    userSockets.delete(userId);
  }
}

function getUserSocketCount(userId: string) {
  return cleanupDeadSocketsForUser(userId);
}

function hasAnyUserSocket(userId: string) {
  return getUserSocketCount(userId) > 0;
}

async function getUserDisplayName(userId: string): Promise<string> {
  const result = await db.query(
    `SELECT display_name
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    return "User";
  }

  return String(result.rows[0]?.display_name ?? "User");
}

async function getOnlineUsersPayload(): Promise<OnlineUser[]> {
  cleanupAllDeadSockets();
  const connectedUserIds = [...userSockets.keys()];

  if (connectedUserIds.length === 0) {
    return [];
  }

  const result = await db.query(
    `SELECT id, username, display_name, status, avatar_url
     FROM users
     WHERE id = ANY($1::uuid[])`,
    [connectedUserIds]
  );

  return result.rows.map((row) => ({
    userId: String(row.id),
    username: row.username ? String(row.username) : undefined,
    displayName: String(row.display_name ?? "User"),
    status: String(row.status ?? "online"),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
  }));
}

async function sendOnlineUsersSnapshot(client: WsClient) {
  const payload = await getOnlineUsersPayload();

  safeSend(client, {
    type: "ONLINE_USERS",
    payload,
  });
}

async function broadcastOnlineUsersSnapshot(
  clients: Iterable<{ send: (data: string) => void }>
) {
  const payload = await getOnlineUsersPayload();
  broadcastToAll(clients, {
    type: "ONLINE_USERS",
    payload,
  });
}


function broadcastToAll(
  clients: Iterable<{ send: (data: string) => void }>,
  payload: unknown
) {
  const serialized = JSON.stringify(payload);

  for (const wsClient of clients) {
    try {
      wsClient.send(serialized);
    } catch {}
  }
}

function sendToUser(userId: string, payload: unknown) {
  const sockets = userSockets.get(userId);
  if (!sockets || sockets.size === 0) return;

  const serialized = JSON.stringify(payload);

  for (const socket of sockets) {
    try {
      socket.send(serialized);
    } catch {}
  }
}

async function emitDmConversationEvent(
  conversationId: string,
  payload: unknown
) {
  const conversation = await getConversationById(conversationId);
  if (!conversation) return;

  sendToUser(conversation.user_one_id, payload);
  if (conversation.user_two_id !== conversation.user_one_id) {
    sendToUser(conversation.user_two_id, payload);
  }
}


function sendDmMutationError(client: WsClient, error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

  if (message === "MESSAGE_NOT_FOUND_OR_FORBIDDEN") {
    safeSend(client, { type: "ERROR", payload: "DM_MESSAGE_FORBIDDEN" });
    return;
  }

  if (message === "MESSAGE_CONTENT_REQUIRED") {
    safeSend(client, { type: "ERROR", payload: "DM_MESSAGE_CONTENT_REQUIRED" });
    return;
  }

  if (message === "MESSAGE_TOO_LONG") {
    safeSend(client, { type: "ERROR", payload: "DM_MESSAGE_TOO_LONG" });
    return;
  }

  safeSend(client, { type: "ERROR", payload: "WS_MESSAGE_HANDLER_ERROR" });
}

function relayRealtimeEvent(event: { type: string; payload?: any }) {
  const allowedTypes = new Set([
    "FRIEND_REQUESTS_UPDATED",
    "FRIENDS_UPDATED",
    "SERVER_INVITES_UPDATED",
    "BLOCKS_UPDATED",
    "SERVERS_UPDATED",
    "TEXT_CHANNEL_UNREAD",
  ]);

  if (!allowedTypes.has(String(event?.type ?? ""))) return false;

  const userIds = Array.isArray(event?.payload?.userIds)
    ? event.payload.userIds.map((x: any) => String(x))
    : [];

  if (userIds.length === 0) return true;

  for (const userId of userIds) {
    sendToUser(userId, event);
  }

  return true;
}

async function emitConversationSystemMessage(
  actorUserId: string,
  conversationId: string,
  meta: Parameters<typeof sendDirectSystemMessage>[2]
) {
  const savedMessage = await sendDirectSystemMessage(
    actorUserId,
    conversationId,
    meta
  );
  const conversation = await getConversationById(conversationId);

  if (!conversation) return savedMessage;

  const userOneId = conversation.user_one_id;
  const userTwoId = conversation.user_two_id;

  const outgoingEvent = {
    type: "DM_MESSAGE",
    payload: {
      conversationId,
      message: savedMessage,
    },
  };

  sendToUser(userOneId, outgoingEvent);
  if (userTwoId !== userOneId) {
    sendToUser(userTwoId, outgoingEvent);
  }

  return savedMessage;
}

function getCallSession(conversationId: string) {
  return dmCallSessions.get(conversationId) ?? null;
}

function clearDmCallTimeout(conversationId: string) {
  const timer = dmCallTimeouts.get(conversationId);
  if (timer) {
    clearTimeout(timer);
    dmCallTimeouts.delete(conversationId);
  }
}

function scheduleDmCallTimeout(
  fastify: any,
  conversationId: string,
  callerUserId: string,
  recipientUserId: string
) {
  clearDmCallTimeout(conversationId);

  const timer = setTimeout(async () => {
    const session = getCallSession(conversationId);
    if (!session || session.acceptedAt) return;

    dmCallSessions.delete(conversationId);
    dmCallTimeouts.delete(conversationId);

    try {
      const actorDisplayName = await getUserDisplayName(callerUserId);

      await emitConversationSystemMessage(callerUserId, conversationId, {
        type: "call_missed",
        actorUserId: callerUserId,
        actorDisplayName,
        targetUserId: recipientUserId,
      });
    } catch (error) {
      fastify.log.error(error, "dm call timeout emit error");
    }

    const endPayload = {
      conversationId,
      endedByUserId: callerUserId,
      reason: "timeout",
    };

    sendToUser(callerUserId, {
      type: "DM_CALL_ENDED",
      payload: endPayload,
    });

    sendToUser(recipientUserId, {
      type: "DM_CALL_ENDED",
      payload: endPayload,
    });
  }, DM_CALL_RING_TIMEOUT_MS);

  dmCallTimeouts.set(conversationId, timer);
}

async function finalizeAcceptedCall(
  conversationId: string,
  actorUserId: string,
  actorDisplayName: string | null
) {
  if (!dmCallSessions.has(conversationId)) return;

  const session = getCallSession(conversationId);
  if (!session) return;

  clearDmCallTimeout(conversationId);
  dmCallSessions.delete(conversationId);
  session.activeParticipantUserIds.clear();

  const acceptedAt = session.acceptedAt;

  if (!acceptedAt) {
    const endPayload = {
      conversationId,
      endedByUserId: actorUserId,
    };

    sendToUser(session.callerUserId, {
      type: "DM_CALL_ENDED",
      payload: endPayload,
    });

    sendToUser(session.recipientUserId, {
      type: "DM_CALL_ENDED",
      payload: endPayload,
    });

    return;
  }

  const durationSeconds = Math.max(
    0,
    Math.floor((Date.now() - acceptedAt) / 1000)
  );

  await emitConversationSystemMessage(actorUserId, conversationId, {
    type: "call_ended",
    actorUserId,
    actorDisplayName: actorDisplayName ?? "User",
    targetUserId:
      session.callerUserId === actorUserId
        ? session.recipientUserId
        : session.callerUserId,
    durationSeconds,
  });

  const endPayload = {
    conversationId,
    endedByUserId: actorUserId,
  };

  sendToUser(session.callerUserId, {
    type: "DM_CALL_ENDED",
    payload: endPayload,
  });

  sendToUser(session.recipientUserId, {
    type: "DM_CALL_ENDED",
    payload: endPayload,
  });
}

async function handleAcceptedCallDeparture(
  session: DmCallSession,
  leavingUserId: string,
  leavingDisplayName: string | null
) {
  const wasParticipant = session.activeParticipantUserIds.has(leavingUserId);
  if (!wasParticipant) return;

  await finalizeAcceptedCall(
    session.conversationId,
    leavingUserId,
    leavingDisplayName
  );
}


async function buildVoicePresenceUsers(
  participants: Array<{
    userId: string;
    channelId: string;
    joinedAt: number;
    muted: boolean;
    deafened: boolean;
  }>
) {
  const userIds = [...new Set(participants.map((p) => p.userId))];
  const channelIds = [...new Set(participants.map((p) => p.channelId))];
  const identityMap = new Map<
    string,
    { displayName: string; username?: string; avatarUrl: string | null }
  >();

  if (userIds.length > 0) {
    const r = await db.query(
      `SELECT id, username, display_name, avatar_url
       FROM users
       WHERE id = ANY($1::uuid[])`,
      [userIds]
    );

    for (const row of r.rows) {
      identityMap.set(String(row.id), {
        displayName: String(row.display_name ?? "User"),
        username: row.username ? String(row.username) : undefined,
        avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      });
    }
  }

  const channelServerMap = new Map<string, string>();
  if (channelIds.length > 0) {
    const rows = await db.query(
      `SELECT id, server_id
       FROM channels
       WHERE id = ANY($1::uuid[])`,
      [channelIds]
    );

    for (const row of rows.rows) {
      if (row.server_id) {
        channelServerMap.set(String(row.id), String(row.server_id));
      }
    }
  }

  const serverIds = [...new Set(Array.from(channelServerMap.values()))];
  const memberStateMap = new Map<string, { serverMuted: boolean; serverDeafened: boolean }>();

  if (serverIds.length > 0 && userIds.length > 0) {
    const rows = await db.query(
      `SELECT server_id, user_id, server_muted, server_deafened
       FROM server_members
       WHERE server_id = ANY($1::uuid[])
         AND user_id = ANY($2::uuid[])`,
      [serverIds, userIds]
    );

    for (const row of rows.rows) {
      memberStateMap.set(`${String(row.server_id)}:${String(row.user_id)}`, {
        serverMuted: row.server_muted === true,
        serverDeafened: row.server_deafened === true,
      });
    }
  }

  return participants.map((p) => {
    const identity = identityMap.get(p.userId);
    const serverId = channelServerMap.get(p.channelId);
    const memberState = serverId
      ? memberStateMap.get(`${serverId}:${p.userId}`)
      : undefined;

    const selfMuted = Boolean(p.muted);
    const selfDeafened = Boolean(p.deafened);
    const serverMuted = Boolean(memberState?.serverMuted);
    const serverDeafened = Boolean(memberState?.serverDeafened);

    return {
      userId: p.userId,
      displayName: identity?.displayName ?? "User",
      username: identity?.username,
      avatarUrl: identity?.avatarUrl ?? null,
      joinedAt: p.joinedAt,
      selfMuted,
      selfDeafened,
      serverMuted,
      serverDeafened,
      muted: selfMuted || serverMuted,
      deafened: selfDeafened || serverDeafened,
    };
  });
}

async function buildVoicePresencePayload() {
  const participants = voicePresence.getAll();
  const users = await buildVoicePresenceUsers(participants);

  const presence: Record<string, any[]> = {};

  for (let i = 0; i < participants.length; i++) {
    const participant = participants[i];
    const user = users[i];
    if (!presence[participant.channelId]) presence[participant.channelId] = [];
    presence[participant.channelId].push(user);
  }

  return { presence };
}

async function sendVoiceSnapshot(client: WsClient) {
  const payload = await buildVoicePresencePayload();

  safeSend(client, {
    type: "VOICE_SNAPSHOT",
    payload,
  });
}

async function broadcastVoiceSnapshot(
  clients: Iterable<{ send: (data: string) => void }>
) {
  const payload = await buildVoicePresencePayload();
  broadcastToAll(clients, {
    type: "VOICE_SNAPSHOT",
    payload,
  });
}

function buildVoiceStreamAnnouncementsSnapshotPayload() {
  return buildVoiceStreamAnnouncementsSnapshotPayloadForChannelIds(null);
}

async function sendVoiceStreamAnnouncementsSnapshot(client: WsClient) {
  const allowedDmChannelIds = new Set<string>();

  for (const state of voiceStreamAnnouncementStates.values()) {
    const conversationId = getDmConversationIdFromChannelId(state.channelId);
    if (!conversationId) continue;
    if (!client.userId) continue;

    const isParticipant = await isConversationParticipant(
      client.userId,
      conversationId
    );

    if (isParticipant) {
      allowedDmChannelIds.add(state.channelId);
    }
  }

  const allowedChannelIds = new Set<string>();

  for (const state of voiceStreamAnnouncementStates.values()) {
    const conversationId = getDmConversationIdFromChannelId(state.channelId);

    if (!conversationId) {
      allowedChannelIds.add(state.channelId);
      continue;
    }

    if (allowedDmChannelIds.has(state.channelId)) {
      allowedChannelIds.add(state.channelId);
    }
  }

  safeSend(client, {
    type: "VOICE_STREAM_ANNOUNCEMENTS_SNAPSHOT",
    payload: buildVoiceStreamAnnouncementsSnapshotPayloadForChannelIds(
      allowedChannelIds
    ),
  });
}

async function broadcastVoiceStreamAnnouncementsUpdated(
  clients: Iterable<{ send: (data: string) => void }>,
  channelId: string
) {
  const channelStates = Array.from(voiceStreamAnnouncementStates.values()).filter(
    (state) => state.channelId === channelId
  );

  const announcements = channelStates.flatMap((state) => state.announcements);
  const updatedAt = channelStates.reduce(
    (maxValue, state) => Math.max(maxValue, state.updatedAt),
    Date.now()
  );

  const payload = {
    type: "VOICE_STREAM_ANNOUNCEMENTS_UPDATED",
    payload: {
      channelId,
      announcements,
      updatedAt,
    },
  };

  const recipientUserIds = await getAnnouncementRecipientUserIdsForChannel(channelId);

  if (recipientUserIds === null) {
    broadcastToAll(clients, payload);
    return;
  }

  for (const userId of recipientUserIds) {
    sendToUser(userId, payload);
  }
}

async function broadcastVoiceStreamAnnouncementsCleared(
  clients: Iterable<{ send: (data: string) => void }>,
  channelId: string,
  options?: {
    userId?: string | null;
    trackSid?: string | null;
    source?: "camera" | "screen" | null;
  }
) {
  const payload = {
    type: "VOICE_STREAM_ANNOUNCEMENTS_CLEARED",
    payload: {
      channelId,
      userId: options?.userId ?? null,
      trackSid: options?.trackSid ?? null,
      source: options?.source ?? null,
      updatedAt: Date.now(),
    },
  };

  const recipientUserIds = await getAnnouncementRecipientUserIdsForChannel(channelId);

  if (recipientUserIds === null) {
    broadcastToAll(clients, payload);
    return;
  }

  for (const userId of recipientUserIds) {
    sendToUser(userId, payload);
  }
}

function upsertVoiceStreamAnnouncementState(
  state: VoiceStreamAnnouncementState
) {
  if (!state.channelId || state.announcements.length === 0) return;

  const groupedBySource = state.announcements.reduce(
    (map, item) => {
      const group = map.get(item.source) ?? [];
      group.push(item);
      map.set(item.source, group);
      return map;
    },
    new Map<"camera" | "screen", StreamAnnouncement[]>()
  );

  for (const [source, announcements] of groupedBySource.entries()) {
    const key = getVoiceStreamAnnouncementStateKey(state.userId, source, state.channelId);

    for (const [existingKey, existingState] of voiceStreamAnnouncementStates.entries()) {
      if (
        existingKey !== key &&
        existingState.userId === state.userId &&
        existingState.announcements.some((item) => item.source === source)
      ) {
        voiceStreamAnnouncementStates.delete(existingKey);
      }
    }

    voiceStreamAnnouncementStates.set(key, {
      channelId: state.channelId,
      userId: state.userId,
      announcements,
      updatedAt: state.updatedAt,
    });
  }
}

function clearVoiceStreamAnnouncementStateForUser(
  userId: string,
  options?: {
    source?: "camera" | "screen" | null;
    trackSid?: string | null;
    channelId?: string | null;
  }
) {
  const cleared: VoiceStreamAnnouncementState[] = [];

  for (const [key, state] of Array.from(voiceStreamAnnouncementStates.entries())) {
    if (state.userId !== userId) continue;
    if (options?.channelId != null && state.channelId !== options.channelId) continue;

    const shouldRemove =
      options?.trackSid != null
        ? state.announcements.some((item) => item.trackSid === options.trackSid)
        : options?.source != null
          ? state.announcements.some((item) => item.source === options.source)
          : true;

    if (!shouldRemove) continue;

    voiceStreamAnnouncementStates.delete(key);
    cleared.push(state);
  }

  if (cleared.length === 0) return null;
  return cleared;
}

function getVoiceStreamAnnouncementStatesForChannel(channelId: string) {
  return Array.from(voiceStreamAnnouncementStates.values()).filter(
    (state) => state.channelId === channelId
  );
}


declare module "fastify" {
  interface FastifyInstance {
    emitDmConversationEvent?: (conversationId: string, payload: unknown) => Promise<void>;
    clearVoiceMediaStateForUser?: (
      userId: string,
      options?: {
        channelId?: string | null;
      }
    ) => Promise<void>;
  }
}

async function clearVoiceMediaStateForUser(
  clients: Iterable<{ send: (data: string) => void }>,
  userId: string,
  options?: {
    channelId?: string | null;
  }
) {
  const clearedAnnouncementStates = clearVoiceStreamAnnouncementStateForUser(
    userId,
    {
      channelId: options?.channelId ?? null,
    }
  );

  if (!clearedAnnouncementStates) return;

  const affectedChannelIds = Array.from(
    new Set(clearedAnnouncementStates.map((state) => state.channelId))
  );

  for (const clearedAnnouncementState of clearedAnnouncementStates) {
    const clearedAnnouncementChannelId = clearedAnnouncementState.channelId;
    const remainingStates = getVoiceStreamAnnouncementStatesForChannel(
      clearedAnnouncementChannelId
    );

    if (remainingStates.length > 0) {
      await broadcastVoiceStreamAnnouncementsUpdated(
        clients,
        clearedAnnouncementChannelId
      );
    } else {
      const lastAnnouncement =
        clearedAnnouncementState.announcements[0] ?? null;
      await broadcastVoiceStreamAnnouncementsCleared(
        clients,
        clearedAnnouncementChannelId,
        {
          userId,
          trackSid: lastAnnouncement?.trackSid ?? null,
          source: lastAnnouncement?.source ?? null,
        }
      );
    }
  }

  for (const affectedChannelId of affectedChannelIds) {
    if (getVoiceStreamAnnouncementStatesForChannel(affectedChannelId).length > 0) {
      await broadcastVoiceStreamAnnouncementsUpdated(clients, affectedChannelId);
    }
  }
}

const wsRoutes: FastifyPluginAsync = async (fastify) => {
  (fastify as any).broadcastVoiceSnapshot = async () => {
    await broadcastVoiceSnapshot(fastify.wsClients);
  };

  (fastify as any).broadcastWs = (event: { type: string; payload?: any }) => {
    if (relayRealtimeEvent(event)) return;
    broadcastToAll(fastify.wsClients, event);
  };

  if (!(fastify as any).emitDmConversationEvent) {
    fastify.decorate("emitDmConversationEvent", emitDmConversationEvent);
  }

  if (!(fastify as any).clearVoiceMediaStateForUser) {
    fastify.decorate(
      "clearVoiceMediaStateForUser",
      async (
        userId: string,
        options?: {
          channelId?: string | null;
        }
      ) => {
        await clearVoiceMediaStateForUser(fastify.wsClients, userId, options);
      }
    );
  }

  const HEARTBEAT_INTERVAL_MS = 15000;

  const heartbeatInterval = setInterval(() => {
    for (const client of Array.from(fastify.wsClients as Set<WsClient>)) {
      if (!client) continue;

      if (client.isAlive === false) {
        terminateSocket(client);
        if (client.userId) {
          cleanupDeadSocketsForUser(client.userId);
        }
        continue;
      }

      client.isAlive = false;

      try {
        client.ping?.();
      } catch {
        terminateSocket(client);
        if (client.userId) {
          cleanupDeadSocketsForUser(client.userId);
        }
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  fastify.addHook("onClose", async () => {
    clearInterval(heartbeatInterval);
  });

  fastify.get("/ws", { websocket: true }, async (socket, req) => {
    const client = socket as unknown as WsClient;

    try {
      const token = (req.query as any)?.token as string | undefined;

      if (!token) {
        safeSend(client, { type: "ERROR", payload: "MISSING_TOKEN" });
        try {
          client.close();
        } catch {}
        return;
      }

      const payload = await fastify.jwt.verify(token);

      const userId = String(
        (payload as any)?.id ??
          (payload as any)?.userId ??
          (payload as any)?.sub ??
          ""
      );

      if (!userId) {
        safeSend(client, { type: "ERROR", payload: "INVALID_TOKEN" });
        try {
          client.close();
        } catch {}
        return;
      }

      client.userId = userId;
      client.isAlive = true;
      client.__viceClosed = false;

      fastify.wsClients.add(client);
      addUserSocket(userId, client);

      client.on("pong", () => {
        markSocketAlive(client);
      });

      await sendVoiceSnapshot(client);
      await sendVoiceStreamAnnouncementsSnapshot(client);
      await sendOnlineUsersSnapshot(client);
      await broadcastOnlineUsersSnapshot(fastify.wsClients);

      client.on("message", async (rawData: any) => {
        try {
          markSocketAlive(client);

          const text =
            typeof rawData === "string"
              ? rawData
              : Buffer.isBuffer(rawData)
                ? rawData.toString("utf8")
                : String(rawData ?? "");

          if (!text) return;

          const message = JSON.parse(text) as IncomingWsMessage;

          if (!client.userId) {
            safeSend(client, {
              type: "ERROR",
              payload: "UNAUTHENTICATED_SOCKET",
            });
            return;
          }

          if (message.type === "VOICE_STREAM_ANNOUNCEMENTS_UPDATE") {
            const channelId = String(message.payload?.channelId ?? "").trim();
            if (!channelId) return;

            const dmConversationId = getDmConversationIdFromChannelId(channelId);
            if (dmConversationId) {
              const isParticipant = await isConversationParticipant(
                client.userId,
                dmConversationId
              );

              if (!isParticipant) {
                safeSend(client, {
                  type: "ERROR",
                  payload: "DM_CONVERSATION_FORBIDDEN",
                });
                return;
              }
            } else {
              const currentPresence = voicePresence.getAll().find((participant) => participant.userId === client.userId) ?? null;
              if (!currentPresence || currentPresence.channelId !== channelId) {
                return;
              }
            }

            const announcements: StreamAnnouncement[] = Array.isArray(
              message.payload?.announcements
            )
              ? message.payload.announcements
                  .map((item): StreamAnnouncement | null => {
                    const trackSid = String(item?.trackSid ?? "").trim();
                    const participantId = String(item?.participantId ?? "").trim();

                    if (!trackSid || !participantId) {
                      return null;
                    }

                    if (participantId !== client.userId) {
                      return null;
                    }

                    const source: StreamAnnouncement["source"] =
                      item?.source === "camera" ? "camera" : "screen";

                    return {
                      trackSid,
                      participantId,
                      participantName: String(item?.participantName ?? "User"),
                      source,
                      previewDataUrl:
                        typeof item?.previewDataUrl === "string"
                          ? item.previewDataUrl
                          : null,
                      previewUpdatedAt:
                        typeof item?.previewUpdatedAt === "number"
                          ? item.previewUpdatedAt
                          : null,
                    };
                  })
                  .filter((item): item is StreamAnnouncement => item !== null)
              : [];

            if (announcements.length === 0) {
              const clearedStates = clearVoiceStreamAnnouncementStateForUser(
                client.userId,
                {
                  source:
                    message.payload?.source === "camera" ||
                    message.payload?.source === "screen"
                      ? message.payload.source
                      : null,
                  trackSid:
                    typeof (message.payload as any)?.trackSid === "string"
                      ? String((message.payload as any).trackSid)
                      : null,
                }
              );

              if (clearedStates) {
                const affectedChannelIds = Array.from(
                  new Set(clearedStates.map((state) => state.channelId))
                );

                for (const clearedState of clearedStates) {
                  const clearedChannelId = clearedState.channelId;
                  const remainingStates = getVoiceStreamAnnouncementStatesForChannel(
                    clearedChannelId
                  );

                  if (remainingStates.length > 0) {
                    await broadcastVoiceStreamAnnouncementsUpdated(
                      fastify.wsClients,
                      clearedChannelId
                    );
                  } else {
                    const lastAnnouncement = clearedState.announcements[0] ?? null;
                    await broadcastVoiceStreamAnnouncementsCleared(
                      fastify.wsClients,
                      clearedChannelId,
                      {
                        userId: client.userId,
                        trackSid: lastAnnouncement?.trackSid ?? null,
                        source: lastAnnouncement?.source ?? null,
                      }
                    );
                  }
                }

                for (const affectedChannelId of affectedChannelIds) {
                  if (
                    getVoiceStreamAnnouncementStatesForChannel(affectedChannelId)
                      .length > 0
                  ) {
                    await broadcastVoiceStreamAnnouncementsUpdated(
                      fastify.wsClients,
                      affectedChannelId
                    );
                  }
                }
              }
              return;
            }

            upsertVoiceStreamAnnouncementState({
              channelId,
              userId: client.userId,
              announcements,
              updatedAt: Number(message.payload?.emittedAt ?? Date.now()),
            });

            await broadcastVoiceStreamAnnouncementsUpdated(
              fastify.wsClients,
              channelId
            );
            return;
          }

          if (message.type === "VOICE_STREAM_ANNOUNCEMENTS_CLEAR") {
            const requestedChannelId = String(message.payload?.channelId ?? "").trim();

            if (requestedChannelId) {
              const dmConversationId = getDmConversationIdFromChannelId(
                requestedChannelId
              );

              if (dmConversationId) {
                const isParticipant = await isConversationParticipant(
                  client.userId,
                  dmConversationId
                );

                if (!isParticipant) {
                  safeSend(client, {
                    type: "ERROR",
                    payload: "DM_CONVERSATION_FORBIDDEN",
                  });
                  return;
                }
              } else {
                const currentPresence = voicePresence.getAll().find((participant) => participant.userId === client.userId) ?? null;
                if (!currentPresence || currentPresence.channelId !== requestedChannelId) {
                  return;
                }
              }
            }

            const clearedStates = clearVoiceStreamAnnouncementStateForUser(
              client.userId,
              {
                source:
                  message.payload?.source === "camera" ||
                  message.payload?.source === "screen"
                    ? message.payload.source
                    : null,
                trackSid:
                  typeof message.payload?.trackSid === "string"
                    ? String(message.payload.trackSid)
                    : null,
              }
            );

            if (clearedStates) {
              const affectedChannelIds = Array.from(
                new Set(clearedStates.map((state) => state.channelId))
              );

              for (const clearedState of clearedStates) {
                const clearedChannelId = clearedState.channelId;
                const remainingStates = getVoiceStreamAnnouncementStatesForChannel(
                  clearedChannelId
                );

                const lastAnnouncement = clearedState.announcements[0] ?? null;
                await broadcastVoiceStreamAnnouncementsCleared(
                  fastify.wsClients,
                  clearedChannelId,
                  {
                    userId: client.userId,
                    trackSid: lastAnnouncement?.trackSid ?? null,
                    source: lastAnnouncement?.source ?? null,
                  }
                );

                if (remainingStates.length > 0) {
                  await broadcastVoiceStreamAnnouncementsUpdated(
                    fastify.wsClients,
                    clearedChannelId
                  );
                }
              }

              for (const affectedChannelId of affectedChannelIds) {
                if (
                  getVoiceStreamAnnouncementStatesForChannel(affectedChannelId)
                    .length > 0
                ) {
                  await broadcastVoiceStreamAnnouncementsUpdated(
                    fastify.wsClients,
                    affectedChannelId
                  );
                }
              }
            }
            return;
          }

          if (message.type === "DM_SEND") {
            const conversationId = String(
              message.payload?.conversationId ?? ""
            ).trim();
            const content = String(message.payload?.content ?? "");
            const tempId = String(message.payload?.tempId ?? "").trim() || null;
            const replyToMessageId = message.payload?.replyToMessageId
              ? String(message.payload.replyToMessageId).trim()
              : null;

            if (!conversationId) {
              safeSend(client, {
                type: "ERROR",
                payload: "DM_CONVERSATION_ID_REQUIRED",
              });
              return;
            }

            const conversation = await getConversationById(conversationId);

            if (!conversation) {
              safeSend(client, {
                type: "ERROR",
                payload: "DM_CONVERSATION_NOT_FOUND",
              });
              return;
            }

            const isParticipant = await isConversationParticipant(
              client.userId,
              conversationId
            );

            if (!isParticipant) {
              safeSend(client, {
                type: "ERROR",
                payload: "DM_CONVERSATION_FORBIDDEN",
              });
              return;
            }

            const recipientUserId =
              conversation.user_one_id === client.userId
                ? conversation.user_two_id
                : conversation.user_one_id;

            if (await areUsersBlocked(client.userId, recipientUserId)) {
              stopTyping(client.userId, conversationId);
              safeSend(client, { type: "ERROR", payload: "USER_BLOCKED" });
              return;
            }

            const savedMessage = await sendDirectMessage(
              client.userId,
              conversationId,
              content,
              replyToMessageId
            );

            await createGeneralAuditLog({
              eventType: "message_sent_dm",
              actorUserId: client.userId,
              conversationId,
              messageId: savedMessage.id,
              details: {
                hasText: Boolean(String(content ?? "").trim()),
                attachmentCount: 0,
                source: "ws",
              },
            });

            stopTyping(client.userId, conversationId);

            const outgoingEvent = {
              type: "DM_MESSAGE",
              payload: {
                conversationId,
                message: savedMessage,
              },
            };

            sendToUser(client.userId, outgoingEvent);

            if (recipientUserId !== client.userId) {
              sendToUser(recipientUserId, outgoingEvent);
            }

            safeSend(client, {
              type: "DM_MESSAGE_SENT",
              payload: {
                tempId,
                conversationId,
                message: savedMessage,
              },
            });

            if (recipientUserId !== client.userId) {
              sendToUser(recipientUserId, {
                type: "DM_TYPING",
                payload: {
                  conversationId,
                  userId: client.userId,
                  isTyping: false,
                },
              });
            }

            return;
          }

          if (message.type === "DM_EDIT") {
            const messageId = String(message.payload?.messageId ?? "").trim();
            const content = String(message.payload?.content ?? "");

            if (!messageId) {
              safeSend(client, { type: "ERROR", payload: "DM_MESSAGE_ID_REQUIRED" });
              return;
            }

            try {
              const updatedMessage = await updateDirectMessage(
                client.userId,
                messageId,
                content
              );

              await emitDmConversationEvent(updatedMessage.conversationId, {
                type: "DM_MESSAGE_UPDATED",
                payload: {
                  conversationId: updatedMessage.conversationId,
                  message: updatedMessage,
                },
              });
            } catch (error) {
              fastify.log.error(error, "dm ws edit error");
              sendDmMutationError(client, error);
            }
            return;
          }

          if (message.type === "DM_DELETE") {
            const messageId = String(message.payload?.messageId ?? "").trim();

            if (!messageId) {
              safeSend(client, { type: "ERROR", payload: "DM_MESSAGE_ID_REQUIRED" });
              return;
            }

            try {
              const deletedMessage = await deleteDirectMessage(
                client.userId,
                messageId
              );

              await createGeneralAuditLog({
                eventType: "message_deleted_dm",
                actorUserId: client.userId,
                conversationId: deletedMessage.conversationId,
                messageId,
                details: {
                  source: "ws",
                },
              });

              await emitDmConversationEvent(deletedMessage.conversationId, {
                type: "DM_MESSAGE_DELETED",
                payload: {
                  conversationId: deletedMessage.conversationId,
                  message: deletedMessage,
                },
              });
            } catch (error) {
              fastify.log.error(error, "dm ws delete error");
              sendDmMutationError(client, error);
            }
            return;
          }

          if (message.type === "DM_PIN") {
            const messageId = String(message.payload?.messageId ?? "").trim();
            const pin = typeof message.payload?.pin === "boolean" ? message.payload.pin : true;

            if (!messageId) {
              safeSend(client, { type: "ERROR", payload: "DM_MESSAGE_ID_REQUIRED" });
              return;
            }

            try {
              const pinnedMessage = await togglePinDirectMessage(
                client.userId,
                messageId,
                pin
              );

              await emitDmConversationEvent(pinnedMessage.conversationId, {
                type: pin ? "DM_MESSAGE_PINNED" : "DM_MESSAGE_UNPINNED",
                payload: {
                  conversationId: pinnedMessage.conversationId,
                  message: pinnedMessage,
                },
              });
            } catch (error) {
              fastify.log.error(error, "dm ws pin error");
              sendDmMutationError(client, error);
            }
            return;
          }

          if (message.type === "DM_TYPING_START") {
            const conversationId = String(
              message.payload?.conversationId ?? ""
            ).trim();

            if (!conversationId) {
              safeSend(client, {
                type: "ERROR",
                payload: "DM_CONVERSATION_ID_REQUIRED",
              });
              return;
            }

            const conversation = await getConversationById(conversationId);

            if (!conversation) {
              safeSend(client, {
                type: "ERROR",
                payload: "DM_CONVERSATION_NOT_FOUND",
              });
              return;
            }

            const isParticipant = await isConversationParticipant(
              client.userId,
              conversationId
            );

            if (!isParticipant) {
              safeSend(client, {
                type: "ERROR",
                payload: "DM_CONVERSATION_FORBIDDEN",
              });
              return;
            }

            const recipientUserId =
              conversation.user_one_id === client.userId
                ? conversation.user_two_id
                : conversation.user_one_id;

            if (await areUsersBlocked(client.userId, recipientUserId)) {
              safeSend(client, { type: "ERROR", payload: "USER_BLOCKED" });
              return;
            }

            startTyping(client.userId, conversationId, () => {
              sendToUser(recipientUserId, {
                type: "DM_TYPING",
                payload: {
                  conversationId,
                  userId: client.userId,
                  isTyping: false,
                },
              });
            });

            sendToUser(recipientUserId, {
              type: "DM_TYPING",
              payload: {
                conversationId,
                userId: client.userId,
                isTyping: true,
              },
            });

            return;
          }

          if (message.type === "DM_TYPING_STOP") {
            const conversationId = String(
              message.payload?.conversationId ?? ""
            ).trim();

            if (!conversationId) {
              safeSend(client, {
                type: "ERROR",
                payload: "DM_CONVERSATION_ID_REQUIRED",
              });
              return;
            }

            const conversation = await getConversationById(conversationId);

            if (!conversation) {
              safeSend(client, {
                type: "ERROR",
                payload: "DM_CONVERSATION_NOT_FOUND",
              });
              return;
            }

            const isParticipant = await isConversationParticipant(
              client.userId,
              conversationId
            );

            if (!isParticipant) {
              safeSend(client, {
                type: "ERROR",
                payload: "DM_CONVERSATION_FORBIDDEN",
              });
              return;
            }

            stopTyping(client.userId, conversationId);

            const recipientUserId =
              conversation.user_one_id === client.userId
                ? conversation.user_two_id
                : conversation.user_one_id;

            sendToUser(recipientUserId, {
              type: "DM_TYPING",
              payload: {
                conversationId,
                userId: client.userId,
                isTyping: false,
              },
            });

            return;
          }

          if (message.type === "DM_CALL_START") {
            const conversationId = String(
              message.payload?.conversationId ?? ""
            ).trim();

            if (!conversationId) {
              safeSend(client, {
                type: "ERROR",
                payload: "DM_CONVERSATION_ID_REQUIRED",
              });
              return;
            }

            const conversation = await getConversationById(conversationId);

            if (!conversation) {
              safeSend(client, {
                type: "ERROR",
                payload: "DM_CONVERSATION_NOT_FOUND",
              });
              return;
            }

            const isParticipant = await isConversationParticipant(
              client.userId,
              conversationId
            );

            if (!isParticipant) {
              safeSend(client, {
                type: "ERROR",
                payload: "DM_CONVERSATION_FORBIDDEN",
              });
              return;
            }

            const recipientUserId =
              conversation.user_one_id === client.userId
                ? conversation.user_two_id
                : conversation.user_one_id;

            if (await areUsersBlocked(client.userId, recipientUserId)) {
              safeSend(client, { type: "ERROR", payload: "USER_BLOCKED" });
              return;
            }

            const existingSession = getCallSession(conversationId);

            if (existingSession?.acceptedAt) {
              safeSend(client, {
                type: "ERROR",
                payload: "DM_CALL_ALREADY_ACTIVE",
              });
              return;
            }

            if (existingSession && !existingSession.acceptedAt) {
              sendToUser(recipientUserId, {
                type: "DM_CALL_RINGING",
                payload: {
                  conversationId,
                  callerUserId: existingSession.callerUserId,
                  callerDisplayName: existingSession.callerDisplayName,
                  roomName: existingSession.roomName,
                },
              });

              safeSend(client, {
                type: "DM_CALL_OUTGOING",
                payload: {
                  conversationId,
                  targetUserId: recipientUserId,
                  roomName: existingSession.roomName,
                },
              });

              return;
            }

            const actorDisplayName = await getUserDisplayName(client.userId);
            const roomName = `dm:${conversationId}`;

            dmCallSessions.set(conversationId, {
              conversationId,
              callerUserId: client.userId,
              callerDisplayName: actorDisplayName,
              recipientUserId,
              roomName,
              startedAt: Date.now(),
              acceptedAt: null,
              activeParticipantUserIds: new Set([client.userId]),
            });
            scheduleDmCallTimeout(fastify, conversationId, client.userId, recipientUserId);

            await emitConversationSystemMessage(client.userId, conversationId, {
              type: "call_started",
              actorUserId: client.userId,
              actorDisplayName: actorDisplayName,
              targetUserId: recipientUserId,
            });

            sendToUser(recipientUserId, {
              type: "DM_CALL_RINGING",
              payload: {
                conversationId,
                callerUserId: client.userId,
                callerDisplayName: actorDisplayName,
                roomName,
              },
            });

            safeSend(client, {
              type: "DM_CALL_OUTGOING",
              payload: {
                conversationId,
                targetUserId: recipientUserId,
                roomName,
              },
            });

            return;
          }

          if (message.type === "DM_CALL_ACCEPT") {
            const conversationId = String(
              message.payload?.conversationId ?? ""
            ).trim();

            if (!conversationId) {
              safeSend(client, {
                type: "ERROR",
                payload: "DM_CONVERSATION_ID_REQUIRED",
              });
              return;
            }

            const conversation = await getConversationById(conversationId);

            if (!conversation) {
              safeSend(client, {
                type: "ERROR",
                payload: "DM_CONVERSATION_NOT_FOUND",
              });
              return;
            }

            const isParticipant = await isConversationParticipant(
              client.userId,
              conversationId
            );

            if (!isParticipant) {
              safeSend(client, {
                type: "ERROR",
                payload: "DM_CONVERSATION_FORBIDDEN",
              });
              return;
            }

            const recipientUserId =
              conversation.user_one_id === client.userId
                ? conversation.user_two_id
                : conversation.user_one_id;

            if (await areUsersBlocked(client.userId, recipientUserId)) {
              safeSend(client, { type: "ERROR", payload: "USER_BLOCKED" });
              return;
            }

            const session = getCallSession(conversationId);

            if (!session) {
              safeSend(client, {
                type: "ERROR",
                payload: "DM_CALL_SESSION_NOT_FOUND",
              });
              return;
            }

            clearDmCallTimeout(conversationId);
            const leftPresence = voicePresence.leave(client.userId);

            if (leftPresence) {
              fastify.broadcastWs({
                type: "VOICE_LEFT",
                payload: {
                  channelId: leftPresence.channelId,
                  userId: client.userId,
                },
              });

              await clearVoiceMediaStateForUser(fastify.wsClients, client.userId, {
                channelId: leftPresence.channelId,
              });
            }

            session.acceptedAt = Date.now();
            session.activeParticipantUserIds.add(client.userId);
            session.activeParticipantUserIds.add(recipientUserId);

            const actorDisplayName = await getUserDisplayName(client.userId);

            await emitConversationSystemMessage(client.userId, conversationId, {
              type: "call_accepted",
              actorUserId: client.userId,
              actorDisplayName: actorDisplayName,
              targetUserId: recipientUserId,
            });

            const acceptPayload = {
              conversationId,
              acceptedByUserId: client.userId,
              roomName: session.roomName,
              isRejoin: false,
            };

            sendToUser(recipientUserId, {
              type: "DM_CALL_ACCEPTED",
              payload: acceptPayload,
            });

            sendToUser(client.userId, {
              type: "DM_CALL_ACCEPTED",
              payload: acceptPayload,
            });

            return;
          }

          if (message.type === "DM_CALL_REJECT") {
            const conversationId = String(
              message.payload?.conversationId ?? ""
            ).trim();

            if (!conversationId) {
              safeSend(client, {
                type: "ERROR",
                payload: "DM_CONVERSATION_ID_REQUIRED",
              });
              return;
            }

            const conversation = await getConversationById(conversationId);

            if (!conversation) {
              safeSend(client, {
                type: "ERROR",
                payload: "DM_CONVERSATION_NOT_FOUND",
              });
              return;
            }

            const isParticipant = await isConversationParticipant(
              client.userId,
              conversationId
            );

            if (!isParticipant) {
              safeSend(client, {
                type: "ERROR",
                payload: "DM_CONVERSATION_FORBIDDEN",
              });
              return;
            }

            const recipientUserId =
              conversation.user_one_id === client.userId
                ? conversation.user_two_id
                : conversation.user_one_id;

            const session = getCallSession(conversationId);
            if (session) {
              clearDmCallTimeout(conversationId);
              dmCallSessions.delete(conversationId);
            }

            const actorDisplayName = await getUserDisplayName(client.userId);

            await emitConversationSystemMessage(client.userId, conversationId, {
              type: "call_rejected",
              actorUserId: client.userId,
              actorDisplayName: actorDisplayName,
              targetUserId: recipientUserId,
            });

            const rejectPayload = {
              conversationId,
              rejectedByUserId: client.userId,
            };

            sendToUser(recipientUserId, {
              type: "DM_CALL_REJECTED",
              payload: rejectPayload,
            });

            safeSend(client, {
              type: "DM_CALL_REJECTED",
              payload: rejectPayload,
            });

            return;
          }

          if (message.type === "DM_CALL_END") {
            const conversationId = String(
              message.payload?.conversationId ?? ""
            ).trim();

            if (!conversationId) {
              safeSend(client, {
                type: "ERROR",
                payload: "DM_CONVERSATION_ID_REQUIRED",
              });
              return;
            }

            const conversation = await getConversationById(conversationId);

            if (!conversation) {
              safeSend(client, {
                type: "ERROR",
                payload: "DM_CONVERSATION_NOT_FOUND",
              });
              return;
            }

            const isParticipant = await isConversationParticipant(
              client.userId,
              conversationId
            );

            if (!isParticipant) {
              safeSend(client, {
                type: "ERROR",
                payload: "DM_CONVERSATION_FORBIDDEN",
              });
              return;
            }

            const session = getCallSession(conversationId);

            if (!session) {
              safeSend(client, {
                type: "DM_CALL_ENDED",
                payload: {
                  conversationId,
                  endedByUserId: client.userId,
                },
              });
              return;
            }

            if (!session.acceptedAt) {
              const actorDisplayName = await getUserDisplayName(client.userId);

              await emitConversationSystemMessage(client.userId, conversationId, {
                type: "call_missed",
                actorUserId: client.userId,
                actorDisplayName: actorDisplayName,
                targetUserId:
                  session.callerUserId === client.userId
                    ? session.recipientUserId
                    : session.callerUserId,
              });

              dmCallSessions.delete(conversationId);

              const endPayload = {
                conversationId,
                endedByUserId: client.userId,
              };

              sendToUser(session.callerUserId, {
                type: "DM_CALL_ENDED",
                payload: endPayload,
              });

              sendToUser(session.recipientUserId, {
                type: "DM_CALL_ENDED",
                payload: endPayload,
              });

              return;
            }

            const actorDisplayName = await getUserDisplayName(client.userId);

            await handleAcceptedCallDeparture(
              session,
              client.userId,
              actorDisplayName
            );

            return;
          }
        } catch (error) {
          fastify.log.error(error, "global ws message handling error");
          safeSend(client, {
            type: "ERROR",
            payload: "WS_MESSAGE_HANDLER_ERROR",
          });
        }
      });

      client.on("close", async () => {
        if (client.__viceClosed !== true) {
          client.__viceClosed = true;
        }

        fastify.wsClients.delete(client);

        if (client.userId) {
          const userId = client.userId;

          removeUserSocket(userId, client);
          cleanupDeadSocketsForUser(userId);

          const stoppedConversationIds = stopTypingEverywhereForUser(userId);

          for (const conversationId of stoppedConversationIds) {
            try {
              const conversation = await getConversationById(conversationId);
              if (!conversation) continue;

              const recipientUserId =
                conversation.user_one_id === userId
                  ? conversation.user_two_id
                  : conversation.user_one_id;

              sendToUser(recipientUserId, {
                type: "DM_TYPING",
                payload: {
                  conversationId,
                  userId,
                  isTyping: false,
                },
              });
            } catch (error) {
              fastify.log.error(error, "typing cleanup on close error");
            }
          }

          if (!hasAnyUserSocket(userId)) {
            const leftPresence = voicePresence.leave(userId);

            if (leftPresence) {
              fastify.broadcastWs({
                type: "VOICE_LEFT",
                payload: {
                  channelId: leftPresence.channelId,
                  userId,
                },
              });
            }

            await clearVoiceMediaStateForUser(fastify.wsClients, userId);

            for (const session of Array.from(dmCallSessions.values())) {
              if (!session.activeParticipantUserIds.has(userId)) continue;
              if (session.acceptedAt == null) continue;

              try {
                const actorDisplayName = await getUserDisplayName(userId);

                await handleAcceptedCallDeparture(
                  session,
                  userId,
                  actorDisplayName
                );
              } catch (error) {
                fastify.log.error(error, "dm call cleanup on close error");
              }
            }
          }

          try {
            await broadcastOnlineUsersSnapshot(fastify.wsClients);
          } catch (error) {
            fastify.log.error(error, "online users snapshot broadcast failed on close");
          }

          try {
            await broadcastVoiceSnapshot(fastify.wsClients);
          } catch (error) {
            fastify.log.error(error, "voice snapshot broadcast failed on close");
          }
        }
      });

      client.on("error", (error: unknown) => {
        fastify.log.error(error, "global ws client error");
        terminateSocket(client);
      });
    } catch (error) {
      fastify.log.error(error, "global ws connection error");
      safeSend(client, {
        type: "ERROR",
        payload: "WS_CONNECTION_ERROR",
      });
      try {
        client.close();
      } catch {}
    }
  });
};

export default fp(wsRoutes, { name: "vice-ws-routes" });