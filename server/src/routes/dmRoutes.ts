import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import {
  getDmSettings,
  getOrCreateConversation,
  getUserConversations,
  getConversationMessages,
  updateDmSettings,
  updateDirectMessage,
  deleteDirectMessage,
  togglePinDirectMessage,
  sendDirectMessage,
} from "../services/dmService";
import {
  getStorageKeyFromPublicUrl,
  createMediaObject,
  createMediaEventLog,
} from "../services/mediaAuditService";
import { createGeneralAuditLog } from "../services/auditLogService";

declare module "fastify" {
  interface FastifyInstance {
    emitDmConversationEvent?: (conversationId: string, payload: unknown) => Promise<void>;
  }
}

type AuthenticatedRequest = FastifyRequest & {
  user: {
    sub: string;
    username?: string;
    displayName?: string;
    role?: string;
  };
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "UNKNOWN_ERROR";
}

const DM_MEDIA_ROOT = path.join(process.cwd(), "uploads", "media");

function getAttachmentKindFromMimeOrName(
  mimeType: string,
  filename: string
): "image" | "video" | "file" {
  const mime = String(mimeType || "").toLowerCase();
  const name = String(filename || "").toLowerCase();

  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(name)) return "image";
  if (mime.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(name)) return "video";

  return "file";
}

function getAttachmentFolder(kind: "image" | "video" | "file") {
  if (kind === "image") return "images";
  if (kind === "video") return "videos";
  return "files";
}

function getSafeExtension(filename: string) {
  const ext = path.extname(String(filename || "")).toLowerCase();
  return ext && ext.length <= 10 ? ext : "";
}

async function emitDmEvent(
  app: FastifyInstance,
  conversationId: string,
  type: string,
  message: unknown
) {
  const emitter = app.emitDmConversationEvent || (app as any).emitDmConversationEvent;
  if (!emitter) {
    throw new Error("DM_EVENT_EMITTER_NOT_AVAILABLE");
  }

  await emitter.call(app, conversationId, {
    type,
    payload: { conversationId, message },
  });
}

async function emitRawDmEvent(
  app: FastifyInstance,
  conversationId: string,
  type: string,
  payload: Record<string, unknown>
) {
  const emitter = app.emitDmConversationEvent || (app as any).emitDmConversationEvent;
  if (!emitter) {
    throw new Error("DM_EVENT_EMITTER_NOT_AVAILABLE");
  }

  await emitter.call(app, conversationId, {
    type,
    payload,
  });
}

function emitDmEventInBackground(
  app: FastifyInstance,
  conversationId: string,
  type: string,
  message: unknown
) {
  void emitDmEvent(app, conversationId, type, message).catch((error) => {
    app.log?.error?.(error, `dm ${type} emit error`);
  });
}

function emitRawDmEventInBackground(
  app: FastifyInstance,
  conversationId: string,
  type: string,
  payload: Record<string, unknown>
) {
  void emitRawDmEvent(app, conversationId, type, payload).catch((error) => {
    app.log?.error?.(error, `dm ${type} raw emit error`);
  });
}

export default async function dmRoutes(app: FastifyInstance) {
  app.post(
    "/dm/conversations",
    async (request: FastifyRequest, reply: FastifyReply) => {
      await app.auth(request, reply);
      if (reply.sent) return;

      const authRequest = request as AuthenticatedRequest;
      const currentUserId = authRequest.user.sub;

      const body = (request.body ?? {}) as {
        targetUserId?: string;
      };

      const targetUserId = String(body.targetUserId ?? "").trim();

      if (!targetUserId) {
        return reply.status(400).send({
          error: "targetUserId gerekli.",
        });
      }

      try {
        const conversation = await getOrCreateConversation(
          currentUserId,
          targetUserId
        );

        return reply.send({
          conversation,
        });
      } catch (error) {
        const message = getErrorMessage(error);

        if (message === "CANNOT_DM_SELF") {
          return reply.status(400).send({
            error: "Kendine DM gönderemezsin.",
          });
        }

        if (message === "TARGET_USER_NOT_FOUND") {
          return reply.status(404).send({
            error: "Hedef kullanıcı bulunamadı.",
          });
        }

        if (message === "NO_SHARED_SERVER") {
          return reply.status(403).send({
            error:
              "Bu kullanıcıyla DM başlatamazsın. Arkadaş olmalı veya ortak sunucunuz olmalı.",
          });
        }

        if (message === "USER_BLOCKED") {
          return reply.status(403).send({
            error: "Bu kullanıcıyla DM başlatamazsın.",
          });
        }

        if (message === "TARGET_BLOCKS_SERVER_DMS") {
          return reply.status(403).send({
            error:
              "Bu kullanıcı ortak sunuculardan gelen DM'leri kapatmış.",
          });
        }

        request.log.error(error, "create/get dm conversation error");
        return reply.status(500).send({
          error: "DM konuşması oluşturulamadı.",
        });
      }
    }
  );

  app.get(
    "/dm/conversations",
    async (request: FastifyRequest, reply: FastifyReply) => {
      await app.auth(request, reply);
      if (reply.sent) return;

      const authRequest = request as AuthenticatedRequest;
      const currentUserId = authRequest.user.sub;

      try {
        const conversations = await getUserConversations(currentUserId);

        return reply.send(conversations);
      } catch (error) {
        request.log.error(error, "get dm conversations error");
        return reply.status(500).send({
          error: "DM konuşmaları alınamadı.",
        });
      }
    }
  );

  app.get(
    "/dm/conversations/:conversationId/messages",
    async (request: FastifyRequest, reply: FastifyReply) => {
      await app.auth(request, reply);
      if (reply.sent) return;

      const authRequest = request as AuthenticatedRequest;
      const currentUserId = authRequest.user.sub;

      const params = request.params as {
        conversationId?: string;
      };

      const query = request.query as {
        limit?: string | number;
        before?: string;
      };

      const conversationId = String(params.conversationId ?? "").trim();
      const limit = Number(query.limit ?? 50);
      const before = String(query.before ?? "").trim() || null;

      if (!conversationId) {
        return reply.status(400).send({
          error: "conversationId gerekli.",
        });
      }

      try {
        const messages = await getConversationMessages(
          currentUserId,
          conversationId,
          limit,
          before
        );

        return reply.send(messages);
      } catch (error) {
        const message = getErrorMessage(error);

        if (message === "CONVERSATION_FORBIDDEN") {
          return reply.status(403).send({
            error: "Bu konuşmaya erişim iznin yok.",
          });
        }

        request.log.error(error, "get dm messages error");
        return reply.status(500).send({
          error: "DM mesajları alınamadı.",
        });
      }
    }
  );

  app.post(
    "/dm/conversations/:conversationId/messages",
    async (request: FastifyRequest, reply: FastifyReply) => {
      await app.auth(request, reply);
      if (reply.sent) return;

      const authRequest = request as AuthenticatedRequest;
      const currentUserId = authRequest.user.sub;
      const params = request.params as { conversationId?: string };
      const conversationId = String(params.conversationId ?? "").trim();

      if (!conversationId) {
        return reply.status(400).send({ error: "conversationId gerekli." });
      }

      try {
        const attachments: Array<{
          kind: "image" | "video" | "file";
          url: string;
          originalName: string;
          mimeType?: string | null;
          sizeBytes?: number | null;
          mediaObjectId?: string | null;
        }> = [];
        let content = "";
        let replyToMessageId: string | null = null;

        const isMultipart =
          typeof (request as any).isMultipart === "function"
            ? (request as any).isMultipart()
            : false;

        if (isMultipart) {
          const parts = (request as any).parts();

          for await (const part of parts) {
            if (part.type === "file") {
              const filename = String(part.filename || "dosya");
              const mimeType = String(part.mimetype || "application/octet-stream");
              const kind = getAttachmentKindFromMimeOrName(mimeType, filename);
              const folder = getAttachmentFolder(kind);
              const ext = getSafeExtension(filename);
              const relativePath = `${folder}/${randomUUID()}${ext}`;
              const fullPath = path.join(DM_MEDIA_ROOT, relativePath);

              await fs.mkdir(path.dirname(fullPath), { recursive: true });

              const buffer = await part.toBuffer();
              await fs.writeFile(fullPath, buffer);

              const publicUrl = `/uploads/media/${relativePath.replace(/\\/g, "/")}`;
              const storageKey = getStorageKeyFromPublicUrl(publicUrl);

              const mediaObjectId = await createMediaObject({
                storageKey,
                publicUrl,
                kind,
                mimeType,
                originalName: filename,
                sizeBytes: buffer.length,
                uploadedByUserId: currentUserId,
                sourceType: "dm",
                sourceId: conversationId,
                uploadIp: (request as any).ip ?? null,
                metadata: {
                  conversationId,
                  attachmentKind: kind,
                },
              });

              await createMediaEventLog({
                mediaObjectId,
                eventType: "uploaded",
                actorUserId: currentUserId,
                actorIp: (request as any).ip ?? null,
                sourceType: "dm",
                sourceId: conversationId,
                details: {
                  conversationId,
                  attachmentKind: kind,
                },
              });

              attachments.push({
                kind,
                url: publicUrl,
                originalName: filename,
                mimeType,
                sizeBytes: buffer.length,
                mediaObjectId,
              });
            } else {
              const fieldName = String(part.fieldname || "");
              const value = String(part.value ?? "");

              if (fieldName === "content") content = value;
              if (fieldName === "replyToMessageId") replyToMessageId = value.trim() || null;
            }
          }
        } else {
          const body = (request.body ?? {}) as {
            content?: string;
            replyToMessageId?: string | null;
          };
          content = String(body.content ?? "");
          replyToMessageId = String(body.replyToMessageId ?? "").trim() || null;
        }

        const message = await sendDirectMessage(
          currentUserId,
          conversationId,
          content,
          replyToMessageId,
          attachments.map((item) => ({
            kind: item.kind,
            url: item.url,
            originalName: item.originalName,
            mimeType: item.mimeType ?? null,
            sizeBytes: item.sizeBytes ?? null,
            mediaObjectId: item.mediaObjectId ?? null,
          }))
        );

        for (const attachment of attachments) {
          if (!attachment.mediaObjectId) continue;

          await createMediaEventLog({
            mediaObjectId: attachment.mediaObjectId,
            eventType: "attached_to_dm",
            actorUserId: currentUserId,
            actorIp: (request as any).ip ?? null,
            sourceType: "dm",
            sourceId: conversationId,
            messageId: message.id,
            details: {
              conversationId,
              attachmentKind: attachment.kind,
            },
          });
        }

        await createGeneralAuditLog({
          eventType: "message_sent_dm",
          actorUserId: currentUserId,
          actorIp: (request as any).ip ?? null,
          conversationId,
          messageId: message.id,
          details: {
            hasText: Boolean(String(content ?? "").trim()),
            attachmentCount: attachments.length,
          },
        });

        emitRawDmEventInBackground(app, message.conversationId, "DM_SEND", {
          conversationId: message.conversationId,
          content: message.content,
          tempId: null,
          replyToMessageId: message.replyToMessageId ?? undefined,
          hasAttachments: attachments.length > 0,
          attachmentCount: attachments.length,
        });

        emitDmEventInBackground(app, message.conversationId, "DM_MESSAGE", message);
        return reply.send(message);
      } catch (error) {
        const message = getErrorMessage(error);

        if (message === "CONVERSATION_FORBIDDEN") {
          return reply.status(403).send({ error: "Bu konuşmaya erişim iznin yok." });
        }
        if (message === "USER_BLOCKED") {
          return reply.status(403).send({ error: "Bu kullanıcıya mesaj gönderemezsin." });
        }
        if (message === "MESSAGE_CONTENT_REQUIRED") {
          return reply.status(400).send({ error: "Mesaj veya dosya gerekli." });
        }
        if (message === "MESSAGE_TOO_LONG") {
          return reply.status(400).send({ error: "Mesaj çok uzun." });
        }
        if (message === "REPLY_MESSAGE_NOT_FOUND") {
          return reply.status(400).send({ error: "Yanıtlanan mesaj bulunamadı." });
        }

        request.log.error(error, "send dm message error");
        return reply.status(500).send({ error: "DM mesajı gönderilemedi." });
      }
    }
  );

  app.patch(
    "/dm/messages/:messageId",
    async (request: FastifyRequest, reply: FastifyReply) => {
      await app.auth(request, reply);
      if (reply.sent) return;

      const authRequest = request as AuthenticatedRequest;
      const currentUserId = authRequest.user.sub;
      const params = request.params as { messageId?: string };
      const body = (request.body ?? {}) as { content?: string };

      const messageId = String(params.messageId ?? "").trim();
      const content = String(body.content ?? "");

      if (!messageId) {
        return reply.status(400).send({ error: "messageId gerekli." });
      }

      try {
        const message = await updateDirectMessage(currentUserId, messageId, content);
        emitDmEventInBackground(app, message.conversationId, "DM_MESSAGE_UPDATED", message);
        return reply.send(message);
      } catch (error) {
        const message = getErrorMessage(error);

        if (message === "MESSAGE_NOT_FOUND_OR_FORBIDDEN") {
          return reply.status(403).send({ error: "Mesaj düzenlenemedi." });
        }
        if (message === "MESSAGE_CONTENT_REQUIRED") {
          return reply.status(400).send({ error: "Mesaj içeriği gerekli." });
        }
        if (message === "MESSAGE_TOO_LONG") {
          return reply.status(400).send({ error: "Mesaj çok uzun." });
        }

        request.log.error(error, "update dm message error");
        return reply.status(500).send({ error: "DM mesajı düzenlenemedi." });
      }
    }
  );

  app.delete(
    "/dm/messages/:messageId",
    async (request: FastifyRequest, reply: FastifyReply) => {
      await app.auth(request, reply);
      if (reply.sent) return;

      const authRequest = request as AuthenticatedRequest;
      const currentUserId = authRequest.user.sub;
      const params = request.params as { messageId?: string };
      const messageId = String(params.messageId ?? "").trim();

      if (!messageId) {
        return reply.status(400).send({ error: "messageId gerekli." });
      }

      try {
        const message = await deleteDirectMessage(
          currentUserId,
          messageId,
          (request as any).ip ?? null
        );

        await createGeneralAuditLog({
          eventType: "message_deleted_dm",
          actorUserId: currentUserId,
          actorIp: (request as any).ip ?? null,
          conversationId: message.conversationId,
          messageId,
          details: {},
        });

        emitDmEventInBackground(app, message.conversationId, "DM_MESSAGE_DELETED", message);
        return reply.send(message);
      } catch (error) {
        const message = getErrorMessage(error);

        if (message === "MESSAGE_NOT_FOUND_OR_FORBIDDEN") {
          return reply.status(403).send({ error: "Mesaj silinemedi." });
        }

        request.log.error(error, "delete dm message error");
        return reply.status(500).send({ error: "DM mesajı silinemedi." });
      }
    }
  );

  app.post(
    "/dm/messages/:messageId/pin",
    async (request: FastifyRequest, reply: FastifyReply) => {
      await app.auth(request, reply);
      if (reply.sent) return;

      const authRequest = request as AuthenticatedRequest;
      const currentUserId = authRequest.user.sub;
      const params = request.params as { messageId?: string };
      const body = (request.body ?? {}) as {
        pin?: boolean;
        isPinned?: boolean;
        pinned?: boolean;
      };

      const messageId = String(params.messageId ?? "").trim();
      const pin =
        typeof body.pin === "boolean"
          ? body.pin
          : typeof body.isPinned === "boolean"
            ? body.isPinned
            : typeof body.pinned === "boolean"
              ? body.pinned
              : true;

      if (!messageId) {
        return reply.status(400).send({ error: "messageId gerekli." });
      }

      try {
        const message = await togglePinDirectMessage(currentUserId, messageId, pin);
        emitDmEventInBackground(
          app,
          message.conversationId,
          pin ? "DM_MESSAGE_PINNED" : "DM_MESSAGE_UNPINNED",
          message
        );
        return reply.send(message);
      } catch (error) {
        const message = getErrorMessage(error);

        if (message === "MESSAGE_NOT_FOUND_OR_FORBIDDEN") {
          return reply.status(403).send({ error: "Pin işlemi yapılamadı." });
        }

        request.log.error(error, "toggle dm pin error");
        return reply.status(500).send({ error: "DM mesaj pin işlemi başarısız." });
      }
    }
  );

  app.get(
    "/dm/settings",
    async (request: FastifyRequest, reply: FastifyReply) => {
      await app.auth(request, reply);
      if (reply.sent) return;

      const authRequest = request as AuthenticatedRequest;
      const currentUserId = authRequest.user.sub;

      try {
        const settings = await getDmSettings(currentUserId);
        return reply.send(settings);
      } catch (error) {
        const message = getErrorMessage(error);

        if (message === "USER_NOT_FOUND") {
          return reply.status(404).send({
            error: "Kullanıcı bulunamadı.",
          });
        }

        request.log.error(error, "get dm settings error");
        return reply.status(500).send({
          error: "DM ayarları alınamadı.",
        });
      }
    }
  );

  app.patch(
    "/dm/settings",
    async (request: FastifyRequest, reply: FastifyReply) => {
      await app.auth(request, reply);
      if (reply.sent) return;

      const authRequest = request as AuthenticatedRequest;
      const currentUserId = authRequest.user.sub;

      const body = (request.body ?? {}) as {
        allowServerDms?: boolean;
      };

      if (typeof body.allowServerDms !== "boolean") {
        return reply.status(400).send({
          error: "allowServerDms boolean olmalı.",
        });
      }

      try {
        const settings = await updateDmSettings(currentUserId, body.allowServerDms);
        return reply.send(settings);
      } catch (error) {
        const message = getErrorMessage(error);

        if (message === "USER_NOT_FOUND") {
          return reply.status(404).send({
            error: "Kullanıcı bulunamadı.",
          });
        }

        request.log.error(error, "update dm settings error");
        return reply.status(500).send({
          error: "DM ayarları güncellenemedi.",
        });
      }
    }
  );
}
