import { FastifyPluginAsync } from "fastify";
import { AccessToken } from "livekit-server-sdk";

export const livekitRoutes: FastifyPluginAsync = async (app) => {
  app.get("/token", { preHandler: [app.auth] }, async (req, reply) => {
    const u: any = req.user;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");
    const username =
      typeof u?.username === "string" && u.username.trim()
        ? u.username.trim()
        : undefined;
    const displayName =
      typeof u?.displayName === "string" && u.displayName.trim()
        ? u.displayName.trim()
        : username || userId;
    const avatarUrl =
      typeof u?.avatarUrl === "string" && u.avatarUrl.trim()
        ? u.avatarUrl.trim()
        : null;

    const room = (req.query as any)?.room as string | undefined;
    if (!room) return reply.code(400).send({ error: "ROOM_REQUIRED" });

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_SECRET;
    const url = process.env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !url) {
      return reply.code(500).send({ error: "LIVEKIT_ENV_MISSING" });
    }

    if (!userId) {
      return reply.code(401).send({ error: "USER_ID_MISSING" });
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity: userId,
      name: displayName,
      metadata: JSON.stringify({
        userId,
        username: username ?? null,
        displayName,
        avatarUrl,
      }),
    });

    at.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });

    return {
      token: await at.toJwt(),
      url,
      identity: userId,
      displayName,
      username: username ?? null,
      avatarUrl,
    };
  });
};
