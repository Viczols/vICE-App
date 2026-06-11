import { randomUUID } from "crypto";
import path from "path";
import { db } from "../db";

export type MediaSourceType = "dm" | "channel";
export type MediaKind = "image" | "video" | "file";

export type CreateMediaObjectInput = {
  storageKey: string;
  publicUrl: string;
  kind: MediaKind;
  mimeType?: string | null;
  originalName: string;
  sizeBytes?: number | null;
  uploadedByUserId: string;
  sourceType: MediaSourceType;
  sourceId?: string | null;
  uploadIp?: string | null;
  metadata?: Record<string, unknown>;
};

export type CreateMediaLogInput = {
  mediaObjectId: string;
  eventType:
    | "uploaded"
    | "attached_to_dm"
    | "attached_to_channel"
    | "message_soft_deleted"
    | "retention_scheduled"
    | "retention_extended"
    | "legal_hold_enabled"
    | "legal_hold_disabled"
    | "purge_started"
    | "purged"
    | "purge_failed";
  actorUserId?: string | null;
  actorIp?: string | null;
  sourceType?: MediaSourceType | null;
  sourceId?: string | null;
  messageId?: string | null;
  details?: Record<string, unknown>;
};

export function getStorageKeyFromPublicUrl(publicUrl: string) {
  const normalized = String(publicUrl ?? "").trim();
  const prefix = "/uploads/media/";
  if (!normalized.startsWith(prefix)) {
    throw new Error("INVALID_MEDIA_PUBLIC_URL");
  }
  return normalized.slice(prefix.length).replace(/\\/g, "/");
}

export async function createMediaObject(input: CreateMediaObjectInput, client = db) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO media_objects (
       id,
       storage_key,
       public_url,
       kind,
       mime_type,
       original_name,
       size_bytes,
       uploaded_by_user_id,
       source_type,
       source_id,
       upload_ip,
       uploaded_at,
       last_referenced_at,
       metadata
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now(), $12::jsonb
     )`,
    [
      id,
      input.storageKey,
      input.publicUrl,
      input.kind,
      input.mimeType ?? null,
      input.originalName,
      input.sizeBytes ?? null,
      input.uploadedByUserId,
      input.sourceType,
      input.sourceId ?? null,
      input.uploadIp ?? null,
      JSON.stringify(input.metadata ?? {}),
    ]
  );
  return id;
}

export async function createMediaEventLog(input: CreateMediaLogInput, client = db) {
  await client.query(
    `INSERT INTO media_event_logs (
       id,
       media_object_id,
       event_type,
       actor_user_id,
       actor_ip,
       source_type,
       source_id,
       message_id,
       details,
       created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())`,
    [
      randomUUID(),
      input.mediaObjectId,
      input.eventType,
      input.actorUserId ?? null,
      input.actorIp ?? null,
      input.sourceType ?? null,
      input.sourceId ?? null,
      input.messageId ?? null,
      JSON.stringify(input.details ?? {}),
    ]
  );
}

export async function scheduleMediaRetentionForMessage(params: {
  messageId: string;
  sourceType: MediaSourceType;
  actorUserId: string;
  actorIp?: string | null;
  retentionDays?: number;
}, client = db) {
  const retentionDays = Math.max(1, Math.floor(params.retentionDays ?? 30));
  const attachmentTable = params.sourceType === "dm"
    ? "direct_message_attachments"
    : "channel_message_attachments";

  const result = await client.query(
    `SELECT media_object_id
     FROM ${attachmentTable}
     WHERE message_id = $1
       AND media_object_id IS NOT NULL`,
    [params.messageId]
  );

  for (const row of result.rows) {
    const mediaObjectId = String(row.media_object_id);
    await client.query(
      `UPDATE media_objects
       SET deleted_by_user_id = $2,
           deleted_ip = COALESCE($3, deleted_ip),
           deleted_at = COALESCE(deleted_at, now()),
           retention_until = CASE
             WHEN legal_hold THEN retention_until
             WHEN retention_until IS NULL THEN now() + ($4::text || ' days')::interval
             ELSE GREATEST(retention_until, now() + ($4::text || ' days')::interval)
           END,
           last_referenced_at = now()
       WHERE id = $1`,
      [mediaObjectId, params.actorUserId, params.actorIp ?? null, retentionDays]
    );

    await createMediaEventLog({
      mediaObjectId,
      eventType: "message_soft_deleted",
      actorUserId: params.actorUserId,
      actorIp: params.actorIp ?? null,
      sourceType: params.sourceType,
      messageId: params.messageId,
      details: { retentionDays },
    }, client);

    await createMediaEventLog({
      mediaObjectId,
      eventType: "retention_scheduled",
      actorUserId: params.actorUserId,
      actorIp: params.actorIp ?? null,
      sourceType: params.sourceType,
      messageId: params.messageId,
      details: { retentionDays },
    }, client);
  }
}

export async function listExpiredMediaForPurge(limit = 100, client = db) {
  const result = await client.query(
    `SELECT id, storage_key, public_url
     FROM media_objects
     WHERE purged_at IS NULL
       AND legal_hold = false
       AND retention_until IS NOT NULL
       AND retention_until <= now()
     ORDER BY retention_until ASC
     LIMIT $1`,
    [limit]
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    storageKey: String(row.storage_key),
    publicUrl: String(row.public_url),
    absolutePath: path.join(process.cwd(), "uploads", "media", String(row.storage_key)),
  }));
}
