import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { db } from "../db";
import {
  createMediaEventLog,
  listExpiredMediaForPurge,
} from "../services/mediaAuditService";

type PurgeExpiredMediaOptions = {
  batchSize?: number;
  maxBatches?: number;
  dryRun?: boolean;
  actorUserId?: string | null;
  actorIp?: string | null;
  logger?: {
    info?: (...args: any[]) => void;
    warn?: (...args: any[]) => void;
    error?: (...args: any[]) => void;
  };
};

export type PurgeExpiredMediaResult = {
  scanned: number;
  purged: number;
  failed: number;
  batches: number;
  failures: Array<{
    mediaObjectId: string;
    storageKey: string;
    error: string;
  }>;
};

function getLogger(logger?: PurgeExpiredMediaOptions["logger"]) {
  return {
    info: logger?.info ?? console.log,
    warn: logger?.warn ?? console.warn,
    error: logger?.error ?? console.error,
  };
}

function getMediaRoot() {
  return path.join(process.cwd(), "uploads", "media");
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function markPurged(
  mediaObjectId: string,
  actorUserId?: string | null,
  actorIp?: string | null,
  client = db
) {
  await client.query(
    `UPDATE media_objects
     SET purged_at = now(),
         purge_error = null,
         updated_at = now()
     WHERE id = $1`,
    [mediaObjectId]
  );

  await createMediaEventLog(
    {
      mediaObjectId,
      eventType: "purged",
      actorUserId: actorUserId ?? null,
      actorIp: actorIp ?? null,
      details: {},
    },
    client
  );
}

async function markPurgeFailed(
  mediaObjectId: string,
  errorMessage: string,
  actorUserId?: string | null,
  actorIp?: string | null,
  client = db
) {
  await client.query(
    `UPDATE media_objects
     SET purge_error = $2,
         updated_at = now()
     WHERE id = $1`,
    [mediaObjectId, errorMessage.slice(0, 2000)]
  );

  await createMediaEventLog(
    {
      mediaObjectId,
      eventType: "purge_failed",
      actorUserId: actorUserId ?? null,
      actorIp: actorIp ?? null,
      details: { error: errorMessage.slice(0, 2000) },
    },
    client
  );
}

export async function purgeExpiredMedia(
  options: PurgeExpiredMediaOptions = {}
): Promise<PurgeExpiredMediaResult> {
  const log = getLogger(options.logger);
  const batchSize = Math.min(Math.max(Number(options.batchSize) || 100, 1), 1000);
  const maxBatches = Math.min(Math.max(Number(options.maxBatches) || 20, 1), 1000);
  const dryRun = options.dryRun === true;

  const result: PurgeExpiredMediaResult = {
    scanned: 0,
    purged: 0,
    failed: 0,
    batches: 0,
    failures: [],
  };

  const mediaRoot = getMediaRoot();

  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex++) {
    const items = await listExpiredMediaForPurge(batchSize);
    if (items.length === 0) break;

    result.batches += 1;
    result.scanned += items.length;

    for (const item of items) {
      const absolutePath = path.normalize(item.absolutePath);
      const relative = path.relative(mediaRoot, absolutePath);

      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        const message = "PURGE_PATH_OUTSIDE_MEDIA_ROOT";
        result.failed += 1;
        result.failures.push({
          mediaObjectId: item.id,
          storageKey: item.storageKey,
          error: message,
        });
        await markPurgeFailed(item.id, message, options.actorUserId, options.actorIp);
        continue;
      }

      await createMediaEventLog({
        mediaObjectId: item.id,
        eventType: "purge_started",
        actorUserId: options.actorUserId ?? null,
        actorIp: options.actorIp ?? null,
        details: { dryRun, storageKey: item.storageKey },
      });

      if (dryRun) {
        log.info?.(`[dry-run] purge scheduled for ${item.storageKey}`);
        continue;
      }

      try {
        if (await fileExists(absolutePath)) {
          await fs.unlink(absolutePath);
        }

        await markPurged(item.id, options.actorUserId, options.actorIp);
        result.purged += 1;
        log.info?.(`purged media: ${item.storageKey}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "UNKNOWN_PURGE_ERROR";
        result.failed += 1;
        result.failures.push({
          mediaObjectId: item.id,
          storageKey: item.storageKey,
          error: message,
        });
        await markPurgeFailed(item.id, message, options.actorUserId, options.actorIp);
        log.error?.(`failed to purge media ${item.storageKey}:`, error);
      }
    }

    if (items.length < batchSize) break;
  }

  return result;
}

export async function runPurgeJob(
  options: Omit<PurgeExpiredMediaOptions, "logger"> & {
    logger?: PurgeExpiredMediaOptions["logger"];
  } = {}
) {
  const summary = await purgeExpiredMedia(options);

  const log = getLogger(options.logger);
  log.info?.("media purge job completed", summary);

  return summary;
}

function parseFlag(name: string) {
  return process.argv.includes(name);
}

function parseNumberFlag(name: string, fallback: number) {
  const index = process.argv.findIndex((arg) => arg === name);
  if (index === -1) return fallback;
  const next = Number(process.argv[index + 1]);
  return Number.isFinite(next) ? next : fallback;
}

async function main() {
  const dryRun = parseFlag("--dry-run");
  const batchSize = parseNumberFlag("--batch-size", 100);
  const maxBatches = parseNumberFlag("--max-batches", 20);

  const summary = await runPurgeJob({
    dryRun,
    batchSize,
    maxBatches,
    actorUserId: null,
    actorIp: null,
  });

  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1]?.includes("purgeExpiredMedia")) {
  main().catch((err) => {
    console.error("purge job failed:", err);
  });
}
