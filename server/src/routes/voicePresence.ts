import type { FastifyPluginAsync } from "fastify";
import { db } from "../db";
import { voicePresence } from "../services/voicePresence";
import {
  requireServerPermission,
} from "../services/serverPermissions";

type JoinBody = {
  channelId: string;
};

type StateBody = {
  muted: boolean;
  deafened: boolean;
};

type TargetVoiceStateBody = {
  targetUserId: string;
  muted?: boolean;
  deafened?: boolean;
};

type DisconnectBody = {
  targetUserId: string;
};

type MoveBody = {
  targetUserId: string;
  targetChannelId: string;
};

async function getDisplayName(userId: string) {
  const r = await db.query(
    `SELECT display_name FROM users WHERE id = $1`,
    [userId]
  );

  return r.rows[0]?.display_name ?? "User";
}

async function getChannelServerId(channelId: string) {
  const result = await db.query(
    `SELECT server_id, type
       FROM channels
      WHERE id = $1
      LIMIT 1`,
    [channelId]
  );

  if ((result.rowCount ?? 0) === 0) return null;

  return {
    serverId: String(result.rows[0].server_id),
    type: String(result.rows[0].type),
  };
}

async function getTargetPresenceOrReply(reply: any, targetUserId: string) {
  const targetPresence = voicePresence.getByUserId(targetUserId);
  if (!targetPresence) {
    reply.code(404).send({ error: "TARGET_USER_NOT_IN_VOICE" });
    return null;
  }
  return targetPresence;
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

  const displayNameMap = new Map<string, string>();
  if (userIds.length > 0) {
    const r = await db.query(
      `SELECT id, display_name FROM users WHERE id = ANY($1::uuid[])`,
      [userIds]
    );

    for (const row of r.rows) {
      displayNameMap.set(String(row.id), String(row.display_name ?? "User"));
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
      displayName: displayNameMap.get(p.userId) ?? "User",
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

declare module "fastify" {
  interface FastifyInstance {
    clearVoiceMediaStateForUser?: (
      userId: string,
      options?: {
        channelId?: string | null;
      }
    ) => Promise<void>;
  }
}

const voicePresenceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/snapshot",
    { preHandler: [fastify.auth] },
    async () => {
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
  );

  fastify.post<{ Body: JoinBody }>(
    "/join",
    { preHandler: [fastify.auth] },
    async (request, reply) => {
      const u: any = request.user;
      const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
      const { channelId } = request.body;

      if (!userId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      if (!channelId) {
        return reply.code(400).send({ error: "CHANNEL_ID_REQUIRED" });
      }

      const participant = voicePresence.join(userId, channelId);
      fastify.broadcastWs({
        type: "VOICE_JOINED",
        payload: {
          channelId,
          user: (await buildVoicePresenceUsers([participant]))[0],
        },
      });

      if ((fastify as any).broadcastVoiceSnapshot) {
        await (fastify as any).broadcastVoiceSnapshot();
      }

      return {
        ok: true,
        participant: {
          userId: participant.userId,
          channelId: participant.channelId,
          joinedAt: participant.joinedAt,
          selfMuted: participant.muted,
          selfDeafened: participant.deafened,
          serverMuted: false,
          serverDeafened: false,
          muted: participant.muted,
          deafened: participant.deafened,
        },
      };
    }
  );

  fastify.post(
    "/leave",
    { preHandler: [fastify.auth] },
    async (request, reply) => {
      const u: any = request.user;
      const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");

      if (!userId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      const existing = voicePresence.leave(userId);

      if (!existing) {
        if ((fastify as any).broadcastVoiceSnapshot) {
          await (fastify as any).broadcastVoiceSnapshot();
        }
        return { ok: true };
      }

      fastify.broadcastWs({
        type: "VOICE_LEFT",
        payload: {
          channelId: existing.channelId,
          userId,
        },
      });

      if ((fastify as any).clearVoiceMediaStateForUser) {
        await (fastify as any).clearVoiceMediaStateForUser(userId, {
          channelId: existing.channelId,
        });
      }

      if ((fastify as any).broadcastVoiceSnapshot) {
        await (fastify as any).broadcastVoiceSnapshot();
      }

      return { ok: true };
    }
  );

  fastify.post<{ Body: StateBody }>(
    "/state",
    { preHandler: [fastify.auth] },
    async (request, reply) => {
      const u: any = request.user;
      const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
      const { muted, deafened } = request.body;

      if (!userId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      let participant = voicePresence.setMuted(userId, Boolean(muted));
      if (!participant) {
        return reply.code(404).send({ error: "USER_NOT_IN_VOICE" });
      }

      participant = voicePresence.setDeafened(userId, Boolean(deafened));
      if (!participant) {
        return reply.code(404).send({ error: "USER_NOT_IN_VOICE" });
      }

      fastify.broadcastWs({
        type: "VOICE_UPDATED",
        payload: {
          channelId: participant.channelId,
          user: (await buildVoicePresenceUsers([participant]))[0],
        },
      });

      if ((fastify as any).broadcastVoiceSnapshot) {
        await (fastify as any).broadcastVoiceSnapshot();
      }

      return {
        ok: true,
        participant: {
          userId: participant.userId,
          channelId: participant.channelId,
          joinedAt: participant.joinedAt,
          selfMuted: participant.muted,
          selfDeafened: participant.deafened,
          serverMuted: false,
          serverDeafened: false,
          muted: participant.muted,
          deafened: participant.deafened,
        },
      };
    }
  );

  fastify.post<{ Body: TargetVoiceStateBody }>(
    "/mute-user",
    { preHandler: [fastify.auth] },
    async (request, reply) => {
      const u: any = request.user;
      const actorUserId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
      const targetUserId = String(request.body?.targetUserId ?? "").trim();
      const muted = Boolean(request.body?.muted);

      if (!actorUserId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      if (!targetUserId) {
        return reply.code(400).send({ error: "TARGET_USER_ID_REQUIRED" });
      }

      const targetPresence = await getTargetPresenceOrReply(reply, targetUserId);
      if (!targetPresence) return;

      const channelInfo = await getChannelServerId(targetPresence.channelId);
      if (!channelInfo?.serverId) {
        return reply.code(404).send({ error: "VOICE_CHANNEL_NOT_FOUND" });
      }

      const permissionState = await requireServerPermission(
        channelInfo.serverId,
        actorUserId,
        "mute_members"
      );

      if (!permissionState) {
        return reply.code(403).send({ error: "MUTE_MEMBERS_FORBIDDEN" });
      }

      await db.query(
        `UPDATE server_members
            SET server_muted = $3
          WHERE server_id = $1 AND user_id = $2`,
        [channelInfo.serverId, targetUserId, muted]
      );

      const participant = voicePresence.getByUserId(targetUserId);
      if (!participant) {
        return reply.code(404).send({ error: "USER_NOT_IN_VOICE" });
      }

      fastify.broadcastWs({
        type: "VOICE_UPDATED",
        payload: {
          channelId: participant.channelId,
          user: (await buildVoicePresenceUsers([participant]))[0],
        },
      });

      return { ok: true, targetUserId, muted };
    }
  );

  fastify.post<{ Body: TargetVoiceStateBody }>(
    "/deafen-user",
    { preHandler: [fastify.auth] },
    async (request, reply) => {
      const u: any = request.user;
      const actorUserId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
      const targetUserId = String(request.body?.targetUserId ?? "").trim();
      const deafened = Boolean(request.body?.deafened);

      if (!actorUserId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      if (!targetUserId) {
        return reply.code(400).send({ error: "TARGET_USER_ID_REQUIRED" });
      }

      const targetPresence = await getTargetPresenceOrReply(reply, targetUserId);
      if (!targetPresence) return;

      const channelInfo = await getChannelServerId(targetPresence.channelId);
      if (!channelInfo?.serverId) {
        return reply.code(404).send({ error: "VOICE_CHANNEL_NOT_FOUND" });
      }

      const permissionState = await requireServerPermission(
        channelInfo.serverId,
        actorUserId,
        "deafen_members"
      );

      if (!permissionState) {
        return reply.code(403).send({ error: "DEAFEN_MEMBERS_FORBIDDEN" });
      }

      await db.query(
        `UPDATE server_members
            SET server_deafened = $3
          WHERE server_id = $1 AND user_id = $2`,
        [channelInfo.serverId, targetUserId, deafened]
      );

      const participant = voicePresence.getByUserId(targetUserId);
      if (!participant) {
        return reply.code(404).send({ error: "USER_NOT_IN_VOICE" });
      }

      fastify.broadcastWs({
        type: "VOICE_UPDATED",
        payload: {
          channelId: participant.channelId,
          user: (await buildVoicePresenceUsers([participant]))[0],
        },
      });

      return { ok: true, targetUserId, deafened };
    }
  );

  fastify.post<{ Body: DisconnectBody }>(
    "/disconnect-user",
    { preHandler: [fastify.auth] },
    async (request, reply) => {
      const u: any = request.user;
      const actorUserId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
      const targetUserId = String(request.body?.targetUserId ?? "").trim();

      if (!actorUserId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      if (!targetUserId) {
        return reply.code(400).send({ error: "TARGET_USER_ID_REQUIRED" });
      }

      const targetPresence = await getTargetPresenceOrReply(reply, targetUserId);
      if (!targetPresence) return;

      const channelInfo = await getChannelServerId(targetPresence.channelId);
      if (!channelInfo?.serverId) {
        return reply.code(404).send({ error: "VOICE_CHANNEL_NOT_FOUND" });
      }

      const permissionState = await requireServerPermission(
        channelInfo.serverId,
        actorUserId,
        "disconnect_members"
      );

      if (!permissionState) {
        return reply.code(403).send({ error: "DISCONNECT_MEMBERS_FORBIDDEN" });
      }

      const existing = voicePresence.leave(targetUserId);
      if (!existing) {
        return reply.code(404).send({ error: "USER_NOT_IN_VOICE" });
      }

      fastify.broadcastWs({
        type: "VOICE_LEFT",
        payload: {
          channelId: existing.channelId,
          userId: targetUserId,
        },
      });

      if ((fastify as any).clearVoiceMediaStateForUser) {
        await (fastify as any).clearVoiceMediaStateForUser(targetUserId, {
          channelId: existing.channelId,
        });
      }

      if ((fastify as any).broadcastVoiceSnapshot) {
        await (fastify as any).broadcastVoiceSnapshot();
      }

      return { ok: true, targetUserId };
    }
  );

  fastify.post<{ Body: MoveBody }>(
    "/move-user",
    { preHandler: [fastify.auth] },
    async (request, reply) => {
      const u: any = request.user;
      const actorUserId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
      const targetUserId = String(request.body?.targetUserId ?? "").trim();
      const targetChannelId = String(request.body?.targetChannelId ?? "").trim();

      if (!actorUserId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      if (!targetUserId) {
        return reply.code(400).send({ error: "TARGET_USER_ID_REQUIRED" });
      }

      if (!targetChannelId) {
        return reply.code(400).send({ error: "TARGET_CHANNEL_ID_REQUIRED" });
      }

      const targetPresence = await getTargetPresenceOrReply(reply, targetUserId);
      if (!targetPresence) return;

      const currentChannelInfo = await getChannelServerId(targetPresence.channelId);
      const nextChannelInfo = await getChannelServerId(targetChannelId);

      if (!currentChannelInfo?.serverId || !nextChannelInfo?.serverId) {
        return reply.code(404).send({ error: "VOICE_CHANNEL_NOT_FOUND" });
      }

      if (currentChannelInfo.serverId !== nextChannelInfo.serverId) {
        return reply.code(400).send({ error: "VOICE_MOVE_CROSS_SERVER_FORBIDDEN" });
      }

      if (nextChannelInfo.type !== "voice") {
        return reply.code(400).send({ error: "TARGET_CHANNEL_NOT_VOICE" });
      }

      const permissionState = await requireServerPermission(
        currentChannelInfo.serverId,
        actorUserId,
        "move_members"
      );

      if (!permissionState) {
        return reply.code(403).send({ error: "MOVE_MEMBERS_FORBIDDEN" });
      }

      const moved = voicePresence.move(targetUserId, targetChannelId);
      if (!moved) {
        return reply.code(404).send({ error: "USER_NOT_IN_VOICE" });
      }

      const displayName = await getDisplayName(targetUserId);

      fastify.broadcastWs({
        type: "VOICE_LEFT",
        payload: {
          channelId: moved.previous.channelId,
          userId: targetUserId,
        },
      });

      if ((fastify as any).clearVoiceMediaStateForUser) {
        await (fastify as any).clearVoiceMediaStateForUser(targetUserId, {
          channelId: moved.previous.channelId,
        });
      }

      fastify.broadcastWs({
        type: "VOICE_JOINED",
        payload: {
          channelId: moved.current.channelId,
          user: {
            userId: moved.current.userId,
            displayName,
            joinedAt: moved.current.joinedAt,
            muted: moved.current.muted,
            deafened: moved.current.deafened,
          },
        },
      });

      if ((fastify as any).broadcastVoiceSnapshot) {
        await (fastify as any).broadcastVoiceSnapshot();
      }

      return {
        ok: true,
        targetUserId,
        fromChannelId: moved.previous.channelId,
        toChannelId: moved.current.channelId,
      };
    }
  );
};

export default voicePresenceRoutes;
