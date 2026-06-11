import { FastifyInstance } from "fastify";
import { db } from "../db";

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
    [userId, targetUserId]
  );

  return (result.rowCount ?? 0) > 0;
}

function emit(app: any, type: string, userIds: string[]) {
  app.broadcastWs?.({
    type,
    payload: { userIds },
  });
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function isValidUsername(value: string) {
  return /^[a-zA-Z0-9_.]{3,20}$/.test(value);
}

export async function friendsRoutes(app: FastifyInstance) {
  app.post("/request", { preHandler: [app.auth] }, async (req: any, reply) => {
    const userId = getAuthUserId(req);
    const username = normalizeUsername(String(req.body?.username ?? ""));

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    if (!username) return reply.code(400).send({ error: "USERNAME_REQUIRED" });
    if (!isValidUsername(username)) {
      return reply.code(400).send({ error: "INVALID_USERNAME" });
    }

    const targetRes = await db.query(
      `SELECT id, display_name, username
       FROM users
       WHERE lower(username) = lower($1)
       LIMIT 1`,
      [username]
    );

    if ((targetRes.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: "USER_NOT_FOUND" });
    }

    const target = targetRes.rows[0];

    if (String(target.id) === userId) {
      return reply.code(400).send({ error: "CANNOT_ADD_SELF" });
    }

    if (await areUsersBlocked(userId, String(target.id))) {
      return reply.code(403).send({ error: "USER_BLOCKED" });
    }

    const existing = await db.query(
      `SELECT 1
       FROM friendships
       WHERE (user_id = $1 AND friend_user_id = $2)
          OR (user_id = $2 AND friend_user_id = $1)
       LIMIT 1`,
      [userId, target.id]
    );

    if ((existing.rowCount ?? 0) > 0) {
      return reply.code(409).send({ error: "REQUEST_ALREADY_EXISTS" });
    }

    await db.query(
      `INSERT INTO friendships (user_id, friend_user_id, status, created_at)
       VALUES ($1, $2, 'pending', now())`,
      [userId, target.id]
    );

    emit(app, "FRIEND_REQUESTS_UPDATED", [userId, String(target.id)]);

    return {
      ok: true,
      target: {
        id: target.id,
        username: target.username,
        displayName: target.display_name,
      },
    };
  });

  app.post("/accept", { preHandler: [app.auth] }, async (req: any, reply) => {
    const currentUserId = getAuthUserId(req);
    const requesterId = String(req.body?.requesterUserId ?? "");

    if (!currentUserId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    if (!requesterId) return reply.code(400).send({ error: "REQUESTER_REQUIRED" });

    if (await areUsersBlocked(currentUserId, requesterId)) {
      return reply.code(403).send({ error: "USER_BLOCKED" });
    }

    const incoming = await db.query(
      `SELECT *
       FROM friendships
       WHERE user_id = $1
         AND friend_user_id = $2
         AND status = 'pending'`,
      [requesterId, currentUserId]
    );

    if ((incoming.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: "FRIEND_REQUEST_NOT_FOUND" });
    }

    await db.query(
      `UPDATE friendships
       SET status = 'accepted'
       WHERE user_id = $1
         AND friend_user_id = $2`,
      [requesterId, currentUserId]
    );

    await db.query(
      `INSERT INTO friendships (user_id, friend_user_id, status, created_at)
       VALUES ($1, $2, 'accepted', now())
       ON CONFLICT (user_id, friend_user_id)
       DO UPDATE SET status = 'accepted'`,
      [currentUserId, requesterId]
    );

    emit(app, "FRIEND_REQUESTS_UPDATED", [currentUserId, requesterId]);
    emit(app, "FRIENDS_UPDATED", [currentUserId, requesterId]);

    return { ok: true };
  });

  app.post("/reject", { preHandler: [app.auth] }, async (req: any, reply) => {
    const currentUserId = getAuthUserId(req);
    const requesterId = String(req.body?.requesterUserId ?? "");

    if (!currentUserId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    if (!requesterId) return reply.code(400).send({ error: "REQUESTER_REQUIRED" });

    const deleted = await db.query(
      `DELETE FROM friendships
       WHERE user_id = $1
         AND friend_user_id = $2
         AND status = 'pending'
       RETURNING user_id`,
      [requesterId, currentUserId]
    );

    if ((deleted.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: "FRIEND_REQUEST_NOT_FOUND" });
    }

    emit(app, "FRIEND_REQUESTS_UPDATED", [currentUserId, requesterId]);

    return { ok: true };
  });

  app.delete("/:targetUserId", { preHandler: [app.auth] }, async (req: any, reply) => {
    const userId = getAuthUserId(req);
    const targetUserId = String(req.params?.targetUserId ?? "");

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    if (!targetUserId) return reply.code(400).send({ error: "TARGET_REQUIRED" });

    const deleted = await db.query(
      `DELETE FROM friendships
       WHERE (user_id = $1 AND friend_user_id = $2)
          OR (user_id = $2 AND friend_user_id = $1)
       RETURNING user_id`,
      [userId, targetUserId]
    );

    if ((deleted.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: "FRIENDSHIP_NOT_FOUND" });
    }

    emit(app, "FRIEND_REQUESTS_UPDATED", [userId, targetUserId]);
    emit(app, "FRIENDS_UPDATED", [userId, targetUserId]);

    return { ok: true };
  });

  app.get("/", { preHandler: [app.auth] }, async (req: any, reply) => {
    const userId = getAuthUserId(req);
    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });

    const { rows } = await db.query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.status
       FROM friendships f
       JOIN users u ON u.id = f.friend_user_id
       WHERE f.user_id = $1 AND f.status = 'accepted'
       ORDER BY u.display_name ASC`,
      [userId]
    );

    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url ?? null,
      status: row.status ?? "offline",
    }));
  });

  app.get("/incoming", { preHandler: [app.auth] }, async (req: any, reply) => {
    const userId = getAuthUserId(req);
    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });

    const { rows } = await db.query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, f.created_at
       FROM friendships f
       JOIN users u ON u.id = f.user_id
       WHERE f.friend_user_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at ASC`,
      [userId]
    );

    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url ?? null,
      createdAt: row.created_at,
    }));
  });
}