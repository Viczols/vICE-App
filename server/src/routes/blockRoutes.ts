import { FastifyPluginAsync } from "fastify";
import { db } from "../db";

function getAuthUserId(req: any) {
  const u = req.user as any;
  return String(u?.id ?? u?.userId ?? u?.sub ?? "");
}

const blockRoutes: FastifyPluginAsync = async (app) => {
  app.post("/blocks/:targetUserId", { preHandler: [app.auth] }, async (req: any, reply) => {
    const userId = getAuthUserId(req);
    const targetUserId = String(req.params?.targetUserId ?? "");

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    if (!targetUserId) return reply.code(400).send({ error: "TARGET_REQUIRED" });

    await db.query("BEGIN");
    try {
      await db.query(
        `INSERT INTO user_blocks (user_id, blocked_user_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [userId, targetUserId]
      );

      await db.query(
        `DELETE FROM friendships
         WHERE (user_id = $1 AND friend_user_id = $2)
            OR (user_id = $2 AND friend_user_id = $1)`,
        [userId, targetUserId]
      );

      await db.query("COMMIT");

      app.broadcastWs?.({
        type: "BLOCKS_UPDATED",
        payload: { userIds: [userId, targetUserId] },
      });
      app.broadcastWs?.({
        type: "FRIENDS_UPDATED",
        payload: { userIds: [userId, targetUserId] },
      });
      app.broadcastWs?.({
        type: "FRIEND_REQUESTS_UPDATED",
        payload: { userIds: [userId, targetUserId] },
      });

      return { success: true };
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }
  });

  app.delete("/blocks/:targetUserId", { preHandler: [app.auth] }, async (req: any, reply) => {
    const userId = getAuthUserId(req);
    const targetUserId = String(req.params?.targetUserId ?? "");

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
    if (!targetUserId) return reply.code(400).send({ error: "TARGET_REQUIRED" });

    await db.query(
      `DELETE FROM user_blocks
       WHERE user_id = $1 AND blocked_user_id = $2`,
      [userId, targetUserId]
    );

    app.broadcastWs?.({
      type: "BLOCKS_UPDATED",
      payload: { userIds: [userId, targetUserId] },
    });

    return { success: true };
  });

  app.get("/blocks", { preHandler: [app.auth] }, async (req: any, reply) => {
    const userId = getAuthUserId(req);
    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });

    const r = await db.query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url
       FROM user_blocks b
       JOIN users u ON u.id = b.blocked_user_id
       WHERE b.user_id = $1`,
      [userId]
    );

    return r.rows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url ?? null,
    }));
  });
};

export default blockRoutes;
