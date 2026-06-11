import { randomUUID } from "crypto";
import { db } from "../db";

export type GeneralAuditEventType =
  | "user_signup"
  | "user_login"
  | "server_join"
  | "server_leave"
  | "message_sent_dm"
  | "message_deleted_dm"
  | "message_sent_channel"
  | "message_deleted_channel"
  | "voice_join"
  | "voice_leave"
  | "voice_disconnect"
  | "voice_move"
  | "voice_mute_user"
  | "voice_deafen_user";

export type CreateGeneralAuditLogInput = {
  eventType: GeneralAuditEventType;
  actorUserId?: string | null;
  actorIp?: string | null;
  targetUserId?: string | null;
  serverId?: string | null;
  channelId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  details?: Record<string, unknown>;
};

export async function createGeneralAuditLog(
  input: CreateGeneralAuditLogInput,
  client = db
) {
  await client.query(
    `INSERT INTO general_audit_logs (
       id,
       event_type,
       actor_user_id,
       actor_ip,
       target_user_id,
       server_id,
       channel_id,
       conversation_id,
       message_id,
       details,
       created_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now()
     )`,
    [
      randomUUID(),
      input.eventType,
      input.actorUserId ?? null,
      input.actorIp ?? null,
      input.targetUserId ?? null,
      input.serverId ?? null,
      input.channelId ?? null,
      input.conversationId ?? null,
      input.messageId ?? null,
      JSON.stringify(input.details ?? {}),
    ]
  );
}
