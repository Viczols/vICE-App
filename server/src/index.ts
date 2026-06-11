import "dotenv/config";
import path from "path";
import fs from "fs/promises";
import { createReadStream } from "fs";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import cron from "node-cron";
import { config } from "./config";
import { authRoutes } from "./auth/routes";
import { channelRoutes } from "./channels/routes";
import { livekitRoutes } from "./livekit/routes";
import { serverRoutes } from "./servers/routes";
import wsHubPlugin from "./plugins/wsHub";
import wsRoutes from "./routes/ws";
import voicePresenceRoutes from "./routes/voicePresence";
import { friendsRoutes } from "./friends/routes";
import dmRoutes from "./routes/dmRoutes";
import profileRoutes from "./routes/profileRoutes";
import blockRoutes from "./routes/blockRoutes";
import serverUserInviteRoutes from "./routes/serverUserInviteRoutes";
import linkPreviewRoutes from "./servers/linkPreviewRoutes";
import { runPurgeJob } from "./jobs/purgeExpiredMedia";
import { cleanupGeneralAuditLogs } from "./jobs/cleanupGeneralAuditLogs";

const app = Fastify({
  logger: true,
  trustProxy: true,
});

const MEDIA_ROOT = path.join(process.cwd(), "uploads", "media");
const AVATAR_ROOT = path.join(process.cwd(), "uploads", "avatars");
const MEDIA_RANGE_CHUNK_SIZE = 1024 * 1024;

function getSafeUploadPath(rootDir: string, rawRelativePath: string) {
  const normalized = String(rawRelativePath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();

  if (!normalized || normalized.includes("..")) {
    return null;
  }

  const fullPath = path.join(rootDir, normalized);
  const relative = path.relative(rootDir, fullPath).replace(/\\/g, "/");

  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return fullPath;
}

function replyWithFileType(reply: any, filename: string) {
  const ext = path.extname(filename).toLowerCase();

  switch (ext) {
    case ".png":
      reply.type("image/png");
      break;
    case ".jpg":
    case ".jpeg":
      reply.type("image/jpeg");
      break;
    case ".webp":
      reply.type("image/webp");
      break;
    case ".gif":
      reply.type("image/gif");
      break;
    case ".mp4":
      reply.type("video/mp4");
      break;
    case ".webm":
      reply.type("video/webm");
      break;
    case ".mov":
      reply.type("video/quicktime");
      break;
    case ".pdf":
      reply.type("application/pdf");
      break;
    case ".txt":
      reply.type("text/plain; charset=utf-8");
      break;
    default:
      reply.type("application/octet-stream");
      break;
  }
}

function parseRangeHeader(rangeHeader: string, fileSize: number) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader || "").trim());
  if (!match) return null;

  const startRaw = match[1];
  const endRaw = match[2];

  let start: number;
  let end: number;

  if (startRaw === "" && endRaw === "") return null;

  if (startRaw === "") {
    const suffixLength = Number(endRaw);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  } else {
    start = Number(startRaw);
    if (!Number.isFinite(start) || start < 0) return null;

    if (endRaw === "") {
      end = Math.min(start + MEDIA_RANGE_CHUNK_SIZE - 1, fileSize - 1);
    } else {
      end = Number(endRaw);
      if (!Number.isFinite(end) || end < 0) return null;
      end = Math.min(end, fileSize - 1);
    }
  }

  if (start >= fileSize || end < start) return null;
  return { start, end };
}

async function registerPlugins() {
  await app.register(cors, {
    origin: ["http://localhost:5173"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  });

  await app.register(jwt, {
    secret: config.JWT_SECRET,
    sign: { expiresIn: config.JWT_EXPIRES_IN },
  });

  await app.register(multipart, {
    limits: {
      files: 10,
      fileSize: 80 * 1024 * 1024,
    },
  });

  app.decorate("auth", async (req: any, reply: any) => {
    await req.jwtVerify();
  });

  await fs.mkdir(AVATAR_ROOT, { recursive: true });
  await fs.mkdir(path.join(MEDIA_ROOT, "images"), { recursive: true });
  await fs.mkdir(path.join(MEDIA_ROOT, "videos"), { recursive: true });
  await fs.mkdir(path.join(MEDIA_ROOT, "files"), { recursive: true });

  await app.register(websocket);
  await app.register(wsHubPlugin);
}

function registerRoutes() {
  app.get("/health", async () => ({ ok: true }));

  app.get("/uploads/avatars/:filename", async (request, reply) => {
    const filename = String((request.params as any)?.filename ?? "");
    if (
      !filename ||
      filename.includes("/") ||
      filename.includes("\\") ||
      filename.includes("..")
    ) {
      return reply.code(400).send({ error: "INVALID_FILENAME" });
    }

    const filepath = path.join(AVATAR_ROOT, filename);

    try {
      const file = await fs.readFile(filepath);
      replyWithFileType(reply, filename);
      return reply.send(file);
    } catch {
      return reply.code(404).send({ error: "FILE_NOT_FOUND" });
    }
  });

  app.get("/uploads/media/*", async (request, reply) => {
    const relativePath = String((request.params as any)["*"] ?? "");
    const filepath = getSafeUploadPath(MEDIA_ROOT, relativePath);

    if (!filepath) {
      return reply.code(400).send({ error: "INVALID_FILENAME" });
    }

    try {
      const stat = await fs.stat(filepath);
      if (!stat.isFile()) {
        return reply.code(404).send({ error: "FILE_NOT_FOUND" });
      }

      const fileSize = stat.size;
      const filename = path.basename(filepath);
      const rangeHeader = String(request.headers.range ?? "").trim();

      replyWithFileType(reply, filename);
      reply.header("Accept-Ranges", "bytes");
      reply.header("Cache-Control", "public, max-age=31536000, immutable");

      if (!rangeHeader) {
        reply.header("Content-Length", String(fileSize));
        return reply.send(createReadStream(filepath));
      }

      const parsedRange = parseRangeHeader(rangeHeader, fileSize);
      if (!parsedRange) {
        reply.header("Content-Range", `bytes */${fileSize}`);
        return reply.code(416).send();
      }

      const { start, end } = parsedRange;
      const contentLength = end - start + 1;

      reply.code(206);
      reply.header("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      reply.header("Content-Length", String(contentLength));

      return reply.send(createReadStream(filepath, { start, end }));
    } catch {
      return reply.code(404).send({ error: "FILE_NOT_FOUND" });
    }
  });

  app.register(wsRoutes);

  app.register(authRoutes, { prefix: "/auth" });
  app.register(profileRoutes, { prefix: "/profile" });
  app.register(serverRoutes, { prefix: "/servers" });
  app.register(channelRoutes, { prefix: "/channels" });
  app.register(friendsRoutes, { prefix: "/friends" });
  app.register(dmRoutes);
  app.register(livekitRoutes, { prefix: "/livekit" });
  app.register(blockRoutes);
  app.register(serverUserInviteRoutes);
  app.register(voicePresenceRoutes, { prefix: "/voice" });
  app.register(linkPreviewRoutes);
}

function startGeneralAuditCleanupScheduler() {
  const cronExpression =
    process.env.GENERAL_AUDIT_CLEANUP_CRON?.trim() || "0 */6 * * *";
  const enabled = process.env.GENERAL_AUDIT_CLEANUP_ENABLED !== "false";

  if (!enabled) {
    app.log.info("general audit cleanup scheduler disabled");
    return;
  }

  cron.schedule(cronExpression, async () => {
    app.log.info({ cronExpression }, "general audit cleanup scheduler triggered");

    try {
      const result = await cleanupGeneralAuditLogs({
        logger: app.log,
      });

      app.log.info(
        { deleted: result.deleted },
        "general audit cleanup scheduler completed"
      );
    } catch (error) {
      app.log.error(error, "general audit cleanup scheduler failed");
    }
  });

  app.log.info({ cronExpression }, "general audit cleanup scheduler registered");
}

function startMediaPurgeScheduler() {
  const cronExpression = process.env.MEDIA_PURGE_CRON?.trim() || "0 * * * *";
  const batchSize = Number(process.env.MEDIA_PURGE_BATCH_SIZE ?? 100);
  const maxBatches = Number(process.env.MEDIA_PURGE_MAX_BATCHES ?? 10);
  const enabled = process.env.MEDIA_PURGE_ENABLED !== "false";

  if (!enabled) {
    app.log.info("media purge scheduler disabled");
    return;
  }

  cron.schedule(cronExpression, async () => {
    app.log.info(
      { cronExpression, batchSize, maxBatches },
      "media purge scheduler triggered"
    );

    try {
      const result = await runPurgeJob({
        dryRun: false,
        batchSize,
        maxBatches,
        logger: app.log,
      });

      app.log.info(
        {
          scanned: result.scanned,
          purged: result.purged,
          failed: result.failed,
          batches: result.batches,
        },
        "media purge scheduler completed"
      );
    } catch (error) {
      app.log.error(error, "media purge scheduler failed");
    }
  });

  app.log.info({ cronExpression }, "media purge scheduler registered");
}

async function bootstrap() {
  await registerPlugins();
  registerRoutes();
  startMediaPurgeScheduler();
  startGeneralAuditCleanupScheduler();
  await app.listen({ port: 3001, host: "0.0.0.0" });
}

await bootstrap();
