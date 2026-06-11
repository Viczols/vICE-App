import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import path from "path";
import fs from "fs/promises";
import {
  getProfileByUserId,
  updateProfile,
  updateUserStatus,
  type UserStatus,
} from "../services/profileService";

const PROFILE_UPLOAD_DIR = path.join(process.cwd(), "uploads", "avatars");

const updateProfileSchema = z.object({
  displayName: z.string().min(2).max(24).optional(),
  username: z.string().min(3).max(20).optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(["online", "idle", "dnd", "invisible", "offline"]),
});

function getExtFromMime(mimeType: string) {
  switch (mimeType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    default:
      return "";
  }
}

const profileRoutes: FastifyPluginAsync = async (app) => {
  app.get("/me", { preHandler: [app.auth] }, async (request, reply) => {
    const u: any = request.user;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });

    const profile = await getProfileByUserId(userId);
    if (!profile) return reply.code(404).send({ error: "USER_NOT_FOUND" });

    return { user: profile };
  });

  app.patch("/me", { preHandler: [app.auth] }, async (request, reply) => {
    const u: any = request.user;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });

    const body = updateProfileSchema.parse(request.body ?? {});

    if (body.username !== undefined) {
      return reply.code(400).send({ error: "USERNAME_IMMUTABLE" });
    }

    const profile = await updateProfile(userId, {
      displayName: body.displayName,
    });

    app.broadcastWs?.({
      type: "USER_PROFILE_UPDATED",
      payload: {
        userId: profile.id,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        status: profile.status,
      },
    });

    return { user: profile };
  });

  app.patch("/status", { preHandler: [app.auth] }, async (request, reply) => {
    const u: any = request.user;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });

    const body = updateStatusSchema.parse(request.body);
    const profile = await updateUserStatus(userId, body.status as UserStatus);

    app.broadcastWs?.({
      type: "USER_STATUS_UPDATED",
      payload: {
        userId: profile.id,
        status: profile.status,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
      },
    });

    return { user: profile };
  });

  app.post("/avatar", { preHandler: [app.auth] }, async (request: any, reply) => {
    const u: any = request.user;
    const userId = String(u?.id ?? u?.userId ?? u?.sub ?? "");

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });

    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "AVATAR_FILE_REQUIRED" });

    const allowed = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
    if (!allowed.has(file.mimetype)) {
      return reply.code(400).send({ error: "INVALID_AVATAR_FILE_TYPE" });
    }

    await fs.mkdir(PROFILE_UPLOAD_DIR, { recursive: true });

    const ext = getExtFromMime(file.mimetype);
    if (!ext) return reply.code(400).send({ error: "INVALID_AVATAR_FILE_TYPE" });

    const filename = `${userId}-${Date.now()}${ext}`;
    const filepath = path.join(PROFILE_UPLOAD_DIR, filename);

    const chunks: Buffer[] = [];
    for await (const chunk of file.file) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const buffer = Buffer.concat(chunks);
    const maxBytes = 4 * 1024 * 1024;
    if (buffer.length > maxBytes) {
      return reply.code(400).send({ error: "AVATAR_FILE_TOO_LARGE" });
    }

    await fs.writeFile(filepath, buffer);

    const avatarUrl = `http://localhost:3001/uploads/avatars/${filename}`;
    const profile = await updateProfile(userId, { avatarUrl });

    app.broadcastWs?.({
      type: "USER_PROFILE_UPDATED",
      payload: {
        userId: profile.id,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        status: profile.status,
      },
    });

    return {
      ok: true,
      avatarUrl: profile.avatarUrl,
      user: profile,
    };
  });
};

export default profileRoutes;