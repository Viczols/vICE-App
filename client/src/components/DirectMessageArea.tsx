
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, KeyboardEvent } from "react";
import {
  Check,
  ExternalLink,
  FileText,
  Paperclip,
  ChevronDown,
  ChevronUp,
  Mic,
  MicOff,
  MonitorUp,
  Phone,
  PhoneOff,
  Search,
  Video,
  VideoOff,
  X,
  GripVertical,
  LogIn,
  LogOut,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  Pin,
  Smile,
  Reply,
  Pencil,
  Trash2,
  Copy,
  SendHorizontal,
} from "lucide-react";
import EmojiPicker, { Theme, type EmojiClickData } from "emoji-picker-react";
import type { DmCallState } from "../layout/MainLayout";

type DmConversation = {
  id: string;
  userOneId: string;
  userTwoId: string;
  createdAt: string;
  updatedAt: string;
  otherUser: {
    id: string;
    username?: string | null;
    displayName: string;
  } | null;
  lastMessage: {
    id: string;
    content: string;
    createdAt: string;
    senderUserId: string;
    editedAt?: string | null;
  } | null;
};

type DmSystemMessageType =
  | "call_started"
  | "call_accepted"
  | "call_rejected"
  | "call_missed"
  | "call_ended";

type DmSystemMessageMeta = {
  type: DmSystemMessageType;
  actorUserId?: string | null;
  actorDisplayName?: string | null;
  targetUserId?: string | null;
  targetDisplayName?: string | null;
  durationSeconds?: number | null;
};

type ReplyPreview = {
  id: string;
  userId: string;
  displayName: string;
  username?: string;
  content: string;
};

type DmAttachment = {
  id: string;
  messageId: string;
  kind: "image" | "video" | "file";
  url: string;
  originalName: string;
  mimeType?: string | null;
  sizeBytes?: number;
  createdAt?: string;
};

type PendingAttachment = {
  id: string;
  file: File;
  kind: "image" | "video" | "file";
  previewUrl?: string | null;
};

type MediaLightboxState = {
  src: string;
  title?: string;
};

type DmMessage = {
  id: string;
  conversationId: string;
  senderUserId: string;
  content: string;
  createdAt: string;
  editedAt?: string | null;
  deletedAt?: string | null;
  replyToMessageId?: string | null;
  replyTo?: ReplyPreview | null;
  isPinned?: boolean;
  pinnedAt?: string | null;
  pinnedBy?: string | null;
  attachments?: DmAttachment[];
  messageType?: "user" | "system";
  systemMeta?: DmSystemMessageMeta | null;
  optimistic?: boolean;
  failed?: boolean;
  clientTempId?: string | null;
};

type DraftActionState = {
  editingMessageId: string | null;
  editText: string;
  replyToMessageId: string | null;
};

type VoicePresenceLike = {
  userId: string;
  displayName: string;
  username?: string;
  avatarUrl?: string | null;
  joinedAt?: number;
  muted?: boolean;
  deafened?: boolean;
};

type DmVisualEntry = {
  participantId: string;
  participantName: string;
  trackSid: string;
  mediaStream: MediaStream;
  source: "camera" | "screen";
};

type DmAnnouncementEntry = {
  trackSid: string;
  participantId: string;
  participantName: string;
  source: "camera" | "screen";
  previewDataUrl?: string | null;
  previewUpdatedAt?: number | null;
};

type IdentityMap = Record<
  string,
  {
    displayName?: string;
    username?: string;
    avatarUrl?: string | null;
  }
>;

export type DmRealtimeMutationEvent = {
  eventId: number;
  type:
    | "DM_MESSAGE"
    | "DM_MESSAGE_UPDATED"
    | "DM_MESSAGE_DELETED"
    | "DM_MESSAGE_PINNED"
    | "DM_MESSAGE_UNPINNED";
  conversationId: string;
  message: DmMessage;
};

type DirectMessageAreaProps = {
  conversation: DmConversation | null;
  currentUserId: string;
  typingUserIds: string[];
  sendDmWsEvent: (payload: unknown) => boolean;
  isWsReady: boolean;
  onStartCall: (conversationId: string) => void | Promise<void>;
  onEndCall: (conversationId: string) => void | Promise<void>;
  onAcceptCall: (conversationId: string) => void | Promise<void>;
  onRejectCall: (conversationId: string) => void | Promise<void>;
  onIgnoreCall: (conversationId: string) => void | Promise<void>;
  onRejoinCall: (conversationId: string) => void | Promise<void>;
  dmCallState: DmCallState;
  voicePresenceMap: Record<string, VoicePresenceLike[]>;
  realtimeMutationEvent: DmRealtimeMutationEvent | null;
};

const SYSTEM_MESSAGE_PREFIX = "__SYSTEM__:";
const STREAM_EVENT_NAME = "vice-voice-visuals-updated";
const STREAM_SNAPSHOT_KEY = "__vice_voice_visuals_snapshot__";
const STREAM_ANNOUNCEMENT_EVENT_NAME = "vice-voice-stream-announcements-updated";
const STREAM_ANNOUNCEMENT_CLEAR_EVENT_NAME = "vice-voice-stream-announcements-cleared";
const STREAM_ANNOUNCEMENT_SNAPSHOT_KEY = "__vice_voice_stream_announcements__";
const REQUEST_VISUAL_RECONCILE_EVENT_NAME = "vice-request-voice-visual-reconcile";
const USER_IDENTITY_EVENT_NAME = "vice-user-identity-map-updated";
const USER_IDENTITY_SNAPSHOT_KEY = "__vice_user_identity_map__";
const DM_MEDIA_CONTROL_EVENT_NAME = "vice-dm-media-control";
const DM_MEDIA_STATE_EVENT_NAME = "vice-dm-media-state";

function tryDecodeSystemMessage(content: string): DmSystemMessageMeta | null {
  if (!content || !content.startsWith(SYSTEM_MESSAGE_PREFIX)) return null;
  try {
    return JSON.parse(content.slice(SYSTEM_MESSAGE_PREFIX.length));
  } catch {
    return null;
  }
}

function normalizeMessage(message: DmMessage): DmMessage {
  const systemMeta = tryDecodeSystemMessage(message.content);
  return {
    ...message,
    messageType: systemMeta ? "system" : "user",
    systemMeta,
  };
}

function areMessagesEquivalent(a: DmMessage, b: DmMessage) {
  if (a.id === b.id) return true;
  if (a.senderUserId !== b.senderUserId) return false;
  if ((a.replyToMessageId || null) !== (b.replyToMessageId || null)) return false;
  if (String(a.content || "").trim() !== String(b.content || "").trim()) return false;
  const aTime = new Date(a.createdAt).getTime();
  const bTime = new Date(b.createdAt).getTime();
  if (Number.isNaN(aTime) || Number.isNaN(bTime)) return false;
  return Math.abs(aTime - bTime) <= 15000;
}

function mergeMessages(prev: DmMessage[], next: DmMessage[]) {
  const normalizedPrev = prev.map(normalizeMessage);
  const normalizedNext = next.map(normalizeMessage);
  const map = new Map<string, DmMessage>();

  for (const message of normalizedPrev) {
    map.set(message.id, message);
  }

  for (const incoming of normalizedNext) {
    for (const [existingId, existing] of Array.from(map.entries())) {
      if (existing.optimistic && areMessagesEquivalent(existing, incoming)) {
        map.delete(existingId);
      }
    }
    map.set(incoming.id, incoming);
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(seconds?: number | null) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function getSystemMessageText(
  meta: DmSystemMessageMeta,
  currentUserId: string,
  fallbackOtherName: string
) {
  const actorName =
    meta.actorUserId === currentUserId
      ? "Sen"
      : meta.actorDisplayName || fallbackOtherName;

  switch (meta.type) {
    case "call_started":
      return `📞 ${actorName} aramayı başlattı`;
    case "call_accepted":
      return "📞 Sesli görüşme başladı";
    case "call_rejected":
      return `❌ ${actorName} aramayı reddetti`;
    case "call_missed":
      return "📞 Cevapsız arama";
    case "call_ended":
      return `📞 Görüşme sona erdi • ${formatDuration(meta.durationSeconds)}`;
    default:
      return "Sistem mesajı";
  }
}

function highlightText(text: string, query: string) {
  if (!query.trim()) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);
  if (index === -1) return text;

  return (
    <>
      {text.slice(0, index)}
      <mark
        style={{
          background: "rgba(255, 214, 10, 0.28)",
          color: "white",
          borderRadius: 6,
          padding: "0 3px",
        }}
      >
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  );
}

function getCallStatusText(
  dmCallState: DmCallState,
  conversationId: string | null,
  otherDisplayName: string
) {
  if (!conversationId) return "";
  if (dmCallState.conversationId !== conversationId) return "";

  if (dmCallState.status === "incoming") {
    return `${dmCallState.callerDisplayName || otherDisplayName} seni arıyor`;
  }
  if (dmCallState.status === "outgoing") {
    return `${otherDisplayName} aranıyor`;
  }
  if (dmCallState.status === "active") {
    return "Sesli görüşme aktif";
  }
  return "";
}

function formatMessageTime(value?: string | null) {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

function resolveAssetUrl(value?: string | null) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  if (/^(https?:\/\/|blob:|data:)/i.test(normalized)) return normalized;
  if (normalized.startsWith("/")) return `http://localhost:3001${normalized}`;
  return `http://localhost:3001/${normalized.replace(/^\/+/, "")}`;
}

function formatFileSize(value?: number | null) {
  const size = Number(value ?? 0);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size >= 1024 * 1024 * 1024) return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${size} B`;
}

function getAttachmentKindFromFile(file: File): "image" | "video" | "file" {
  const mime = String(file.type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(name)) return "image";
  if (mime.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(name)) return "video";
  return "file";
}

function extractUrls(text: string) {
  const matches = text.match(/https?:\/\/[^\s<]+/gi) || [];
  return Array.from(new Set(matches.map((item) => item.replace(/[),.;!?]+$/, ""))));
}

type LinkPreviewData = {
  url: string;
  siteName?: string | null;
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  embedUrl?: string | null;
  embedKind?: "iframe" | "video" | "tweet" | null;
  canInlinePlay?: boolean;
  theme?: "youtube" | "kick" | "twitter" | "x" | "twitch" | "vimeo" | "generic";
};

function buildFallbackLinkPreview(urlValue: string): LinkPreviewData {
  try {
    const url = new URL(urlValue);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    return {
      url: urlValue,
      siteName: host,
      title: `${host} bağlantısı`,
      description:
        url.pathname && url.pathname !== "/"
          ? decodeURIComponent(url.pathname.slice(1).replace(/[-_]+/g, " "))
          : "Bağlantıyı aç",
      imageUrl: null,
      embedUrl: null,
      embedKind: null,
      canInlinePlay: false,
      theme: "generic",
    };
  } catch {
    return {
      url: urlValue,
      siteName: "Bağlantı",
      title: urlValue,
      description: "Bağlantıyı aç",
      imageUrl: null,
      embedUrl: null,
      embedKind: null,
      canInlinePlay: false,
      theme: "generic",
    };
  }
}

function getPreviewAccent(theme?: LinkPreviewData["theme"]) {
  if (theme === "youtube") return "linear-gradient(135deg, rgba(255,0,51,0.22), rgba(255,255,255,0.04))";
  if (theme === "kick" || theme === "twitch" || theme === "vimeo") return "linear-gradient(135deg, rgba(88,101,242,0.22), rgba(255,255,255,0.04))";
  if (theme === "twitter" || theme === "x") return "linear-gradient(135deg, rgba(29,155,240,0.22), rgba(255,255,255,0.04))";
  return "linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))";
}

function ensureTwitterWidgetsScript() {
  const existingTwttr = (window as any).twttr;
  if (existingTwttr?.widgets?.createTweet) return Promise.resolve(existingTwttr);
  return new Promise<any>((resolve, reject) => {
    const existingScript = document.querySelector('script[data-vice-twitter-widgets="true"]') as HTMLScriptElement | null;
    const waitForWidgets = (attempt = 0) => {
      const twttr = (window as any).twttr;
      if (twttr?.widgets?.createTweet) return resolve(twttr);
      if (attempt >= 80) return reject(new Error("TWITTER_WIDGETS_LOAD_FAILED"));
      window.setTimeout(() => waitForWidgets(attempt + 1), 100);
    };
    if (existingScript) return waitForWidgets();
    const script = document.createElement("script");
    script.src = "https://platform.twitter.com/widgets.js";
    script.async = true;
    script.charset = "utf-8";
    script.setAttribute("data-vice-twitter-widgets", "true");
    script.onload = () => waitForWidgets();
    script.onerror = () => reject(new Error("TWITTER_WIDGETS_LOAD_FAILED"));
    document.body.appendChild(script);
  });
}

function extractTweetId(urlValue: string) {
  try {
    const url = new URL(urlValue);
    const parts = url.pathname.split("/").filter(Boolean);
    const statusIndex = parts.findIndex((part) => part === "status");
    return statusIndex >= 0 && parts[statusIndex + 1] ? parts[statusIndex + 1] : null;
  } catch {
    return null;
  }
}

function TweetEmbed({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    const tweetId = extractTweetId(url);
    if (!container || !tweetId) {
      setLoadFailed(true);
      return;
    }
    container.innerHTML = "";
    setLoadFailed(false);
    ensureTwitterWidgetsScript()
      .then((twttr) => {
        if (cancelled) return;
        if (!twttr?.widgets?.createTweet) {
          setLoadFailed(true);
          return;
        }
        return twttr.widgets.createTweet(tweetId, container, { theme: "dark", dnt: true, align: "center", conversation: "none" });
      })
      .then((result: unknown) => {
        if (cancelled) return;
        if (!result) setLoadFailed(true);
      })
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; if (container) container.innerHTML = ""; };
  }, [url]);
  if (loadFailed) {
    return <div style={{ width: "100%", minHeight: 220, display: "flex", alignItems: "center", justifyContent: "center", background: "#0c1016", color: "#dbe3ee", padding: 18, textAlign: "center", lineHeight: 1.5 }}>X gönderisi uygulama içinde yüklenemedi.</div>;
  }
  return <div style={{ width: "100%", minHeight: 220, background: "#0c1016", display: "flex", alignItems: "flex-start", justifyContent: "center", overflow: "auto", padding: "10px 0" }}><div ref={containerRef} style={{ width: "100%", maxWidth: 520 }} /></div>;
}

function LinkPreviewCard({ url }: { url: string }) {
  const [preview, setPreview] = useState<LinkPreviewData>(() => buildFallbackLinkPreview(url));
  const [loading, setLoading] = useState(true);
  const [isInlinePlaying, setIsInlinePlaying] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setIsInlinePlaying(false);
    setPreview(buildFallbackLinkPreview(url));
    const token = localStorage.getItem("token");
    fetch(`http://localhost:3001/link-preview?url=${encodeURIComponent(url)}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined, signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok || !data) throw new Error(data?.error || "LINK_PREVIEW_FAILED");
        if (!cancelled) setPreview({ ...buildFallbackLinkPreview(url), ...data, url });
      })
      .catch(() => { if (!cancelled) setPreview(buildFallbackLinkPreview(url)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [url]);
  const accent = getPreviewAccent(preview.theme);
  const isTweetPreview = preview.embedKind === "tweet" && preview.embedUrl;
  const canInlinePlay = Boolean(preview.canInlinePlay && preview.embedUrl && preview.embedKind && preview.embedKind !== "tweet");
  return (
    <div style={{ display: "block", marginTop: 8, borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", background: accent, boxShadow: "0 10px 26px rgba(0,0,0,0.16)", maxWidth: 520 }}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ color: "#aeb8c8", fontSize: 11, fontWeight: 800 }}>{preview.siteName || "Bağlantı"}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {canInlinePlay ? <button type="button" onClick={() => setIsInlinePlaying((prev) => !prev)} style={{ height: 26, padding: "0 10px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.1)", background: isInlinePlaying ? "rgba(255,255,255,0.12)" : "rgba(88,101,242,0.18)", color: "#fff", fontSize: 11, fontWeight: 800, cursor: "pointer" }}>{isInlinePlaying ? "Kapat" : "Oynat"}</button> : null}
          <a href={url} target="_blank" rel="noreferrer" style={{ width: 28, height: 28, borderRadius: 999, border: "1px solid rgba(255,255,255,0.1)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#aeb8c8", background: "rgba(255,255,255,0.04)" }} title="Bağlantıyı aç"><ExternalLink size={14} color="#aeb8c8" /></a>
        </div>
      </div>
      {isTweetPreview ? (
        <TweetEmbed url={preview.embedUrl!} />
      ) : isInlinePlaying && preview.embedUrl && preview.embedKind ? (
        <div style={{ width: "100%", aspectRatio: "16 / 9", background: "#000" }}>{preview.embedKind === "video" ? <video src={preview.embedUrl} controls autoPlay playsInline preload="metadata" style={{ width: "100%", height: "100%", border: 0, display: "block", background: "#000" }} /> : <iframe src={preview.embedUrl} title={preview.title || "Video"} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen style={{ width: "100%", height: "100%", border: 0, display: "block" }} />}</div>
      ) : preview.imageUrl ? (
        <button type="button" onClick={() => { if (canInlinePlay) { setIsInlinePlaying(true); return; } window.open(url, "_blank", "noopener,noreferrer"); }} style={{ width: "100%", padding: 0, border: 0, display: "block", background: "#0c1016", cursor: canInlinePlay ? "pointer" : "alias", position: "relative" }}>
          <img src={preview.imageUrl} alt={preview.title || url} style={{ width: "100%", display: "block", maxHeight: 240, objectFit: "cover", background: "#0c1016" }} />
          {canInlinePlay ? <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.34) 100%)" }}><div style={{ height: 54, padding: "0 18px", borderRadius: 999, display: "inline-flex", alignItems: "center", gap: 10, background: "rgba(11,14,18,0.84)", border: "1px solid rgba(255,255,255,0.14)", color: "#fff", fontSize: 14, fontWeight: 900, boxShadow: "0 14px 30px rgba(0,0,0,0.3)" }}><div style={{ width: 28, height: 28, borderRadius: 999, background: "#5865f2", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><div style={{ width: 0, height: 0, borderTop: "7px solid transparent", borderBottom: "7px solid transparent", borderLeft: "11px solid white", marginLeft: 3 }} /></div>Uygulama içinde oynat</div></div> : null}
        </button>
      ) : (
        <div style={{ width: "100%", minHeight: isTweetPreview ? 220 : 140, background: "linear-gradient(135deg, rgba(15,18,23,0.9), rgba(35,40,51,0.85))", display: "flex", alignItems: "center", justifyContent: "center", color: "#ffffff", fontWeight: 900, fontSize: 18 }}>{loading ? "Yükleniyor..." : canInlinePlay || isTweetPreview ? "Uygulama içinde açılabilir" : (preview.siteName || "Bağlantı")}</div>
      )}
      <div style={{ padding: 12 }}>
        <div style={{ color: "#ffffff", fontSize: 15, fontWeight: 900, marginBottom: 5, lineHeight: 1.35 }}>{preview.title || url}</div>
        <div style={{ color: "#aeb8c8", fontSize: 12, lineHeight: 1.45, marginBottom: 8 }}>{isTweetPreview ? "Gönderi önizlemesi" : canInlinePlay ? (isInlinePlaying ? "Video uygulama içinde oynatılıyor" : "Videoyu burada oynatabilirsin") : (preview.description || "Bağlantıyı aç")}</div>
        <div style={{ color: "#7f8794", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{url}</div>
      </div>
    </div>
  );
}

function PendingAttachmentCard({ item, onRemove }: { item: PendingAttachment; onRemove: (id: string) => void; }) {
  return (
    <div style={{ borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", overflow: "hidden", position: "relative", minWidth: 0 }}>
      <button onClick={() => onRemove(item.id)} style={{ position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: 999, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(11,14,18,0.82)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 2 }} title="Kaldır"><X size={12} /></button>
      {item.kind === "image" && item.previewUrl ? <img src={item.previewUrl} alt={item.file.name} style={{ width: "100%", height: 68, objectFit: "cover", display: "block", background: "#0f1217" }} /> : item.kind === "video" && item.previewUrl ? <video src={item.previewUrl} muted playsInline style={{ width: "100%", height: 68, objectFit: "cover", display: "block", background: "#0f1217" }} /> : <div style={{ width: "100%", height: 68, display: "flex", alignItems: "center", justifyContent: "center", background: "#0f1217", color: "#dbe3ee" }}>{item.kind === "video" ? <Video size={18} /> : <FileText size={18} />}</div>}
      <div style={{ padding: "7px 8px" }}><div style={{ color: "#e6ebf2", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.file.name}</div><div style={{ color: "#8f98a6", fontSize: 9, marginTop: 2 }}>{formatFileSize(item.file.size)}</div></div>
    </div>
  );
}

function MessageAttachments({
  attachments,
  onOpenImage,
  isOwnMessage = false,
}: {
  attachments: DmAttachment[];
  onOpenImage: (src: string, title?: string) => void;
  isOwnMessage?: boolean;
}) {
  if (!attachments.length) return null;
  const images = attachments.filter((item) => item.kind === "image");
  const videos = attachments.filter((item) => item.kind === "video");
  const files = attachments.filter((item) => item.kind === "file");

  const fileCardBackground = isOwnMessage
    ? "linear-gradient(180deg, rgba(14,18,28,0.92) 0%, rgba(18,24,36,0.96) 100%)"
    : "rgba(255,255,255,0.03)";
  const fileCardBorder = isOwnMessage
    ? "0.5px solid rgba(255,255,255,0.12)"
    : "0.5px solid rgba(255,255,255,0.06)";
  const fileNameColor = isOwnMessage ? "#ffffff" : "#ffffff";
  const fileMetaColor = isOwnMessage ? "rgba(235,240,255,0.82)" : "#8f98a6";
  const fileIconBackground = isOwnMessage
    ? "rgba(123,138,255,0.24)"
    : "rgba(88,101,242,0.16)";
  const fileIconColor = isOwnMessage ? "#ffffff" : "#dce7ff";
  const fileActionColor = isOwnMessage ? "#eef2ff" : "#aeb8c8";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8, width: "100%" }}>
      {images.length > 0 ? <div style={{ display: "grid", gridTemplateColumns: images.length === 1 ? "minmax(0, 340px)" : "repeat(auto-fit, minmax(132px, 1fr))", gap: 8, maxWidth: 460 }}>
        {images.map((item) => { const resolvedUrl = resolveAssetUrl(item.url); return <button key={item.id} type="button" onClick={() => onOpenImage(resolvedUrl, item.originalName)} style={{ borderRadius: 14, overflow: "hidden", border: "0.5px solid rgba(255,255,255,0.06)", display: "block", background: "#0f1217", padding: 0, cursor: "zoom-in" }} title={item.originalName}><img src={resolvedUrl} alt={item.originalName} style={{ width: "100%", display: "block", objectFit: "cover", maxHeight: images.length === 1 ? 260 : 180 }} /></button>; })}
      </div> : null}
      {videos.map((item) => <div key={item.id} style={{ maxWidth: 520, borderRadius: 14, overflow: "hidden", border: "0.5px solid rgba(255,255,255,0.06)", background: "#0f1217" }}><video controls preload="metadata" src={resolveAssetUrl(item.url)} style={{ width: "100%", maxHeight: 320, display: "block", background: "#000" }} /><div style={{ padding: "8px 10px", color: "#dbe3ee", fontSize: 10, fontWeight: 700 }}>{item.originalName}{item.sizeBytes ? ` • ${formatFileSize(item.sizeBytes)}` : ""}</div></div>)}
      {files.map((item) => <a key={item.id} href={resolveAssetUrl(item.url)} target="_blank" rel="noreferrer" style={{ textDecoration: "none", maxWidth: 440, borderRadius: 14, border: fileCardBorder, background: fileCardBackground, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, boxShadow: "none" }}><div style={{ width: 38, height: 38, borderRadius: 11, background: fileIconBackground, display: "flex", alignItems: "center", justifyContent: "center", color: fileIconColor, flexShrink: 0 }}><FileText size={16} /></div><div style={{ minWidth: 0, flex: 1 }}><div style={{ color: fileNameColor, fontSize: 12, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.originalName}</div><div style={{ color: fileMetaColor, fontSize: 11, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{[item.mimeType || "Dosya", item.sizeBytes ? formatFileSize(item.sizeBytes) : ""].filter(Boolean).join(" • ")}</div></div><ExternalLink size={15} color={fileActionColor} /></a>)}
    </div>
  );
}

function MediaLightbox({ state, onClose }: { state: MediaLightboxState | null; onClose: () => void; }) {
  useEffect(() => {
    if (!state) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown as any);
    return () => window.removeEventListener("keydown", onKeyDown as any);
  }, [state, onClose]);
  if (!state) return null;
  return <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(5, 7, 11, 0.86)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, boxSizing: "border-box" }}><button type="button" onClick={onClose} style={{ position: "absolute", top: 18, right: 18, width: 42, height: 42, borderRadius: 999, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(15,18,24,0.82)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} title="Kapat"><X size={18} /></button><div onClick={(event) => event.stopPropagation()} style={{ maxWidth: "min(92vw, 1200px)", maxHeight: "88vh", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}><img src={state.src} alt={state.title || "Görsel"} style={{ maxWidth: "100%", maxHeight: "calc(88vh - 44px)", borderRadius: 18, display: "block", objectFit: "contain", boxShadow: "0 22px 60px rgba(0,0,0,0.42)" }} />{state.title ? <div style={{ color: "#dbe3ee", fontSize: 13, fontWeight: 700, textAlign: "center", maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{state.title}</div> : null}</div></div>;
}


function getMessageDayKey(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatMessageDayLabel(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function isEmojiOnlyMessage(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const cleaned = trimmed
    .replace(/[\u{FE0E}\u{FE0F}]/gu, "")
    .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "")
    .replace(/[\u200D\s]/gu, "");
  if (!cleaned) return false;
  return /^[\p{Extended_Pictographic}]+$/gu.test(cleaned);
}

function getMessageTextStyle(content: string): CSSProperties {
  const emojiOnly = isEmojiOnlyMessage(content);
  return {
    color: "#d7deea",
    fontSize: emojiOnly ? 34 : 15,
    lineHeight: emojiOnly ? 1.25 : 1.6,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    width: "100%",
  };
}

function getAnnouncementKey(item: { participantId: string; source: "camera" | "screen" }) {
  return `${item.participantId}:${item.source}`;
}

function hasUsableLiveVideoStream(stream?: MediaStream | null) {
  if (!stream) return false;
  return stream.getVideoTracks().some((track) => track.readyState === "live" && track.enabled !== false);
}

function getInitials(name: string) {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function UserAvatar({
  name,
  avatarUrl,
  size = 44,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        style={{
          width: size,
          height: size,
          borderRadius: 999,
          objectFit: "cover",
          border: "1px solid rgba(255,255,255,0.08)",
          background: "#1b2028",
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #5865f2, #7b8aff)",
        color: "#fff",
        fontWeight: 900,
        fontSize: Math.max(14, Math.floor(size * 0.34)),
        boxShadow: "0 12px 28px rgba(88,101,242,0.28)",
      }}
    >
      {getInitials(name)}
    </div>
  );
}

function StreamTile({
  mediaStream,
  label,
  posterDataUrl = null,
  fit = "cover",
  isLarge = false,
  muted = true,
  volume = 1,
  onVolumeChange,
  showVolumeControls = false,
}: {
  mediaStream: MediaStream;
  label: string;
  posterDataUrl?: string | null;
  fit?: "cover" | "contain";
  isLarge?: boolean;
  muted?: boolean;
  volume?: number;
  onVolumeChange?: (value: number) => void;
  showVolumeControls?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isVolumeHovered, setIsVolumeHovered] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== mediaStream) {
      video.srcObject = mediaStream;
    }

    const onLoaded = () => setIsVideoReady(true);
    const onPlaying = () => setIsVideoReady(true);
    video.addEventListener("loadeddata", onLoaded);
    video.addEventListener("playing", onPlaying);
    video.play().catch(() => {});

    return () => {
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("playing", onPlaying);
      try {
        video.pause();
      } catch {}
      try {
        video.srcObject = null;
      } catch {}
    };
  }, [mediaStream]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = muted;
    video.volume = muted ? 0 : Math.max(0, Math.min(1, volume));

    if (!muted) {
      video.play().catch(() => {});
    }
  }, [muted, volume]);

  const hasAudioTracks = mediaStream.getAudioTracks().length > 0;
  const shouldShowVolumeUi = showVolumeControls && hasAudioTracks;
  const safeVolume = muted ? 0 : Math.max(0, Math.min(1, volume));

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        background: "#090c12",
        borderRadius: isLarge ? 0 : 18,
        overflow: "hidden",
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        style={{
          width: "100%",
          height: "100%",
          objectFit: fit,
          display: "block",
          opacity: isVideoReady ? 1 : 0,
          transition: "opacity 140ms ease",
          background: "#090c12",
        }}
      />
      {!isVideoReady && posterDataUrl ? (
        <img
          src={posterDataUrl}
          alt={`${label} preview`}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: fit,
            background: "#090c12",
          }}
        />
      ) : null}

      {shouldShowVolumeUi ? (
        <div
          onClick={(event) => event.stopPropagation()}
          onMouseEnter={() => setIsVolumeHovered(true)}
          onMouseLeave={() => setIsVolumeHovered(false)}
          style={{
            position: "absolute",
            right: 10,
            bottom: 10,
            width: 52,
            height: 190,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            zIndex: 8,
          }}
        >
          <div
            style={{
              position: "absolute",
              right: 4,
              bottom: 48,
              width: 44,
              height: 134,
              borderRadius: 16,
              background: "rgba(13,16,22,0.9)",
              border: "1px solid rgba(255,255,255,0.12)",
              backdropFilter: "blur(12px)",
              boxShadow: "0 16px 34px rgba(0,0,0,0.28)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "12px 0",
              opacity: isVolumeHovered ? 1 : 0,
              pointerEvents: isVolumeHovered ? "auto" : "none",
              transform: `translateY(${isVolumeHovered ? "0" : "6px"})`,
              transition: "opacity 160ms ease, transform 160ms ease",
            }}
          >
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(safeVolume * 100)}
              onChange={(event) => onVolumeChange?.(Number(event.target.value) / 100)}
              style={{
                height: 100,
                width: 18,
                cursor: "pointer",
                writingMode: "vertical-lr" as any,
                direction: "rtl",
                accentColor: "#7b8aff",
              }}
            />
          </div>

          <button
            type="button"
            onClick={() => onVolumeChange?.(muted || volume <= 0 ? Math.max(volume, 0.8) : 0)}
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.12)",
              background:
                muted || volume <= 0
                  ? "rgba(237,66,69,0.22)"
                  : "rgba(13,16,22,0.82)",
              color: "#fff",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              backdropFilter: "blur(12px)",
              boxShadow: "0 10px 24px rgba(0,0,0,0.22)",
            }}
            title={muted || volume <= 0 ? "Sesi aç" : "Sesi kapat"}
          >
            {muted || volume <= 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function DirectMessageArea({
  conversation,
  currentUserId,
  typingUserIds,
  sendDmWsEvent,
  isWsReady,
  onStartCall,
  onEndCall,
  onAcceptCall,
  onRejectCall,
  onIgnoreCall,
  onRejoinCall,
  dmCallState,
  voicePresenceMap,
  realtimeMutationEvent,
}: DirectMessageAreaProps) {
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
  const [dmVisuals, setDmVisuals] = useState<DmVisualEntry[]>([]);
  const [dmAnnouncements, setDmAnnouncements] = useState<DmAnnouncementEntry[]>([]);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [joinedScreenKey, setJoinedScreenKey] = useState<string | null>(null);
  const [fullscreenCardKey, setFullscreenCardKey] = useState<string | null>(null);
  const [stageHeight, setStageHeight] = useState(372);
  const [isStageHovered, setIsStageHovered] = useState(false);
  const [streamVolumes, setStreamVolumes] = useState<Record<string, number>>({});
  const [identityMap, setIdentityMap] = useState<IdentityMap>({});
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showPinnedPanel, setShowPinnedPanel] = useState(false);
  const [draftState, setDraftState] = useState<DraftActionState>({ editingMessageId: null, editText: "", replyToMessageId: null });
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isDraggingComposerFiles, setIsDraggingComposerFiles] = useState(false);
  const [mediaLightbox, setMediaLightbox] = useState<MediaLightboxState | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerDragDepthRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const typingHeartbeatRef = useRef<number | null>(null);
  const isTypingRef = useRef(false);
  const firstLoadDoneRef = useRef(false);
  const lastConversationIdRef = useRef<string | null>(null);
  const stageResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);
  const pinnedPanelRef = useRef<HTMLDivElement | null>(null);
  const optimisticSyncTimeoutRef = useRef<number | null>(null);
  const historyLoadInFlightRef = useRef(false);
  const historyRestoreScrollRef = useRef<{ previousHeight: number; previousTop: number } | null>(null);
  const initialBottomSettlerRafRef = useRef<number | null>(null);
  const initialBottomSettlerUntilRef = useRef<number>(0);
  const initialBottomSettlerTimersRef = useRef<number[]>([]);

  const screenOrderRef = useRef<Record<string, number>>({});
  const screenOrderCounterRef = useRef(0);

  const token = localStorage.getItem("token");
  const conversationId = conversation?.id ?? null;
  const dmChannelId = conversationId ? `dm:${conversationId}` : null;
  const otherDisplayName = conversation?.otherUser?.displayName ?? "Kullanıcı";
  const otherUsername = conversation?.otherUser?.username ?? null;
  const DM_MESSAGES_PAGE_SIZE = 50;

  const getStreamVolumeKey = (item: { trackSid?: string | null; participantId: string; source: "camera" | "screen" }) => {
    const trackSid = String(item.trackSid ?? "").trim();
    return trackSid || `${item.participantId}:${item.source}`;
  };

  const getStreamVolume = (item: { trackSid?: string | null; participantId: string; source: "camera" | "screen" }) => {
    const key = getStreamVolumeKey(item);
    return streamVolumes[key] ?? 1;
  };

  const setStreamVolume = (
    item: { trackSid?: string | null; participantId: string; source: "camera" | "screen" },
    value: number
  ) => {
    const key = getStreamVolumeKey(item);
    const safeValue = Math.max(0, Math.min(1, value));
    setStreamVolumes((prev) => ({
      ...prev,
      [key]: safeValue,
    }));
  };

  const currentUserAvatar = useMemo(() => {
    try {
      const raw = localStorage.getItem("auth_user");
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed?.avatarUrl ?? null;
    } catch {
      return null;
    }
  }, []);
  const otherUserAvatar = identityMap[conversation?.otherUser?.id || ""]?.avatarUrl ?? null;

  useEffect(() => {
    return () => {
      setPendingAttachments((prev) => {
        prev.forEach((item) => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); });
        return prev;
      });
    };
  }, []);

  useEffect(() => {
    setMediaLightbox(null);
    composerDragDepthRef.current = 0;
    setIsDraggingComposerFiles(false);
  }, [conversationId]);

  const filteredMessages = useMemo(() => {
    const visibleMessages = messages.filter((message) => !message.deletedAt);
    const q = searchText.trim().toLowerCase();
    if (!q) return visibleMessages;
    return visibleMessages.filter((message) => {
      const text =
        message.messageType === "system"
          ? getSystemMessageText(
              message.systemMeta || { type: "call_started" },
              currentUserId,
              otherDisplayName
            ).toLowerCase()
          : message.content.toLowerCase();
      return text.includes(q);
    });
  }, [messages, searchText, currentUserId, otherDisplayName]);

  const groupedTypingText = useMemo(() => {
    if (!conversation || typingUserIds.length === 0) return "";
    return `${otherDisplayName} yazıyor...`;
  }, [conversation, typingUserIds, otherDisplayName]);

  const activeCallStatusText = useMemo(
    () => getCallStatusText(dmCallState, conversationId, otherDisplayName),
    [dmCallState, conversationId, otherDisplayName]
  );

  const isThisConversationInCall =
    !!conversationId && dmCallState.conversationId === conversationId;

  const showIncomingAcceptButtons =
    !!conversationId &&
    isThisConversationInCall &&
    dmCallState.status === "incoming";

  const showStartCallButton =
    !!conversationId &&
    (!isThisConversationInCall || dmCallState.status === "idle");

  const showLeaveCallButton =
    !!conversationId &&
    isThisConversationInCall &&
    (dmCallState.status === "outgoing" || dmCallState.status === "active");

  const dmPresenceMembers = useMemo(
    () => (dmChannelId && Array.isArray(voicePresenceMap[dmChannelId]) ? voicePresenceMap[dmChannelId] : []),
    [dmChannelId, voicePresenceMap]
  );

  const presenceLocalMuted = Boolean(
    dmPresenceMembers.find((x) => x.userId === currentUserId)?.muted
  );

  const presenceLocalDeafened = Boolean(
    dmPresenceMembers.find((x) => x.userId === currentUserId)?.deafened
  );

  const [dmMediaState, setDmMediaState] = useState<{
    muted: boolean;
    deafened: boolean;
    camera: boolean;
    screen: boolean;
  } | null>(null);

  const localMuted = dmMediaState?.muted ?? presenceLocalMuted;
  const localDeafened = dmMediaState?.deafened ?? presenceLocalDeafened;

  const localCameraAnnouncement = useMemo(
    () =>
      dmAnnouncements.find(
        (item) => item.participantId === currentUserId && item.source === "camera"
      ) || null,
    [dmAnnouncements, currentUserId]
  );

  const localScreenAnnouncement = useMemo(
    () =>
      dmAnnouncements.find(
        (item) => item.participantId === currentUserId && item.source === "screen"
      ) || null,
    [dmAnnouncements, currentUserId]
  );

  const localCameraActive = dmMediaState?.camera ?? Boolean(localCameraAnnouncement);
  const localScreenActive = dmMediaState?.screen ?? Boolean(localScreenAnnouncement);

  const mediaCards = useMemo(() => {
    const map = new Map<string, {
      key: string;
      participantId: string;
      participantName: string;
      source: "camera" | "screen";
      visual: DmVisualEntry | null;
      announcement: DmAnnouncementEntry | null;
    }>();

    for (const announcement of dmAnnouncements) {
      const key = getAnnouncementKey(announcement);
      map.set(key, {
        key,
        participantId: announcement.participantId,
        participantName: announcement.participantName,
        source: announcement.source,
        visual: null,
        announcement,
      });
    }

    for (const visual of dmVisuals) {
      const hasLiveTrack = hasUsableLiveVideoStream(visual.mediaStream);
      if (!hasLiveTrack) continue;

      const key = getAnnouncementKey(visual);
      const existing = map.get(key);
      map.set(key, {
        key,
        participantId: visual.participantId,
        participantName: existing?.participantName || visual.participantName,
        source: visual.source,
        visual,
        announcement: existing?.announcement || null,
      });
    }

    return Array.from(map.values()).filter((item) => {
      if (item.source === "screen") {
        return Boolean(item.announcement?.previewDataUrl) || hasUsableLiveVideoStream(item.visual?.mediaStream);
      }

      return hasUsableLiveVideoStream(item.visual?.mediaStream);
    });
  }, [dmAnnouncements, dmVisuals]);

  const screenCards = useMemo(
    () => mediaCards.filter((item) => item.source === "screen"),
    [mediaCards]
  );
  const cameraCards = useMemo(
    () => mediaCards.filter((item) => item.source === "camera"),
    [mediaCards]
  );
  const joinedScreenCard = useMemo(
    () => mediaCards.find((item) => item.key === joinedScreenKey) || null,
    [mediaCards, joinedScreenKey]
  );
  const focusedCard = useMemo(
    () => mediaCards.find((item) => item.key === focusedKey) || null,
    [mediaCards, focusedKey]
  );
  const fullscreenCard = useMemo(
    () => mediaCards.find((item) => item.key === fullscreenCardKey) || null,
    [mediaCards, fullscreenCardKey]
  );
  const selectedParticipantCameraCard = useMemo(
    () =>
      selectedParticipantId
        ? cameraCards.find((item) => item.participantId === selectedParticipantId) || null
        : null,
    [cameraCards, selectedParticipantId]
  );
  const activeStageCard = focusedCard || joinedScreenCard || selectedParticipantCameraCard || null;
  const activeStagePreview = activeStageCard?.announcement?.previewDataUrl || undefined;
  const previewMediaCards = useMemo(
    () => mediaCards.filter((item) => item.key !== activeStageCard?.key),
    [mediaCards, activeStageCard]
  );
  const showMediaStage = isThisConversationInCall || mediaCards.length > 0 || dmPresenceMembers.length > 0;
  const showPreviewGallery = false;

  useEffect(() => {
    const activeScreenKeys = new Set(screenCards.map((item) => item.key));

    for (const screenCard of screenCards) {
      if (screenOrderRef.current[screenCard.key] == null) {
        screenOrderCounterRef.current += 1;
        screenOrderRef.current[screenCard.key] = screenOrderCounterRef.current;
      }
    }

    Object.keys(screenOrderRef.current).forEach((key) => {
      if (!activeScreenKeys.has(key)) {
        delete screenOrderRef.current[key];
      }
    });
  }, [screenCards]);

  const fallbackParticipants = useMemo(() => {
    const map = new Map<string, { id: string; name: string; avatarUrl?: string | null }>();
    map.set(currentUserId, { id: currentUserId, name: "Sen", avatarUrl: currentUserAvatar });
    if (conversation?.otherUser?.id) {
      map.set(conversation.otherUser.id, {
        id: conversation.otherUser.id,
        name: otherDisplayName,
        avatarUrl:
          otherUserAvatar ??
          dmPresenceMembers.find((x) => x.userId === conversation.otherUser?.id)?.avatarUrl ??
          null,
      });
    }
    for (const member of dmPresenceMembers) {
      map.set(member.userId, {
        id: member.userId,
        name: member.userId === currentUserId ? "Sen" : member.displayName || "Kullanıcı",
        avatarUrl:
          member.avatarUrl ??
          identityMap[member.userId]?.avatarUrl ??
          (member.userId === currentUserId ? currentUserAvatar : null),
      });
    }
    return Array.from(map.values());
  }, [
    currentUserId,
    currentUserAvatar,
    conversation?.otherUser?.id,
    dmPresenceMembers,
    identityMap,
    otherDisplayName,
    otherUserAvatar,
  ]);

  const participantCards = useMemo(
    () =>
      fallbackParticipants.map((participant) => ({
        ...participant,
        isSelf: participant.id === currentUserId,
      })),
    [fallbackParticipants, currentUserId]
  );

  const dockCards = useMemo(() => {
    type DockCard = {
      key: string;
      type: "user" | "screen";
      participantId: string;
      participantName: string;
      avatarUrl?: string | null;
      isSelf: boolean;
      visual: DmVisualEntry | null;
      announcement: DmAnnouncementEntry | null;
      cameraVisual: DmVisualEntry | null;
      cameraAnnouncement: DmAnnouncementEntry | null;
    };

    const selfParticipant =
      participantCards.find((participant) => participant.isSelf) || null;

    const otherParticipants = participantCards
      .filter((participant) => !participant.isSelf)
      .sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), "tr", {
          sensitivity: "base",
        })
      );

    const usersFirst = [
      ...(selfParticipant ? [selfParticipant] : []),
      ...otherParticipants,
    ];

    const userCards: DockCard[] = usersFirst.map((participant) => {
      const participantMedia = mediaCards.filter((item) => item.participantId === participant.id);
      const cameraCard =
        participantMedia.find((item) => item.source === "camera") || null;

      return {
        key: `user:${participant.id}`,
        type: "user",
        participantId: participant.id,
        participantName: participant.name,
        avatarUrl: participant.avatarUrl ?? null,
        isSelf: participant.isSelf,
        visual: null,
        announcement: null,
        cameraVisual: cameraCard?.visual || null,
        cameraAnnouncement: cameraCard?.announcement || null,
      };
    });

    const screenCardsOrdered: DockCard[] = mediaCards
      .filter((item) => item.source === "screen")
      .map((screenCard) => {
        const existingOrder = screenOrderRef.current[screenCard.key];
        const order =
          existingOrder ??
          Number.MAX_SAFE_INTEGER;

        const participant =
          usersFirst.find((item) => item.id === screenCard.participantId) ||
          participantCards.find((item) => item.id === screenCard.participantId) ||
          null;

        return {
          key: screenCard.key,
          type: "screen" as const,
          participantId: screenCard.participantId,
          participantName: participant?.name || screenCard.participantName,
          avatarUrl: participant?.avatarUrl ?? null,
          isSelf: Boolean(participant?.isSelf),
          visual: screenCard.visual,
          announcement: screenCard.announcement,
          cameraVisual: null,
          cameraAnnouncement: null,
          __order: order,
        };
      })
      .sort((a, b) => {
        if (a.__order !== b.__order) return a.__order - b.__order;
        return String(a.participantName || "").localeCompare(
          String(b.participantName || ""),
          "tr",
          { sensitivity: "base" }
        );
      })
      .map(({ __order, ...card }) => card);

    return [...userCards, ...screenCardsOrdered];
  }, [participantCards, mediaCards]);
  const activeStageParticipant = useMemo(() => {
    if (activeStageCard) {
      return (
        participantCards.find((participant) => participant.id === activeStageCard.participantId) ||
        null
      );
    }

    return (
      (selectedParticipantId
        ? participantCards.find((participant) => participant.id === selectedParticipantId) || null
        : null) || participantCards[0] || null
    );
  }, [activeStageCard, participantCards, selectedParticipantId]);

  const updateJumpToLatestVisibility = () => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) {
      setShowJumpToLatest(false);
      return;
    }

    const distanceFromBottom = Math.max(
      0,
      scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight
    );

    setShowJumpToLatest(distanceFromBottom >= 10000);
  };

  const clearInitialBottomSettler = () => {
    if (initialBottomSettlerRafRef.current != null) {
      window.cancelAnimationFrame(initialBottomSettlerRafRef.current);
      initialBottomSettlerRafRef.current = null;
    }
    if (initialBottomSettlerTimersRef.current.length > 0) {
      initialBottomSettlerTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      initialBottomSettlerTimersRef.current = [];
    }
  };

  const startInitialBottomSettler = (durationMs = 520) => {
    shouldStickToBottomRef.current = true;
    clearInitialBottomSettler();
    initialBottomSettlerUntilRef.current = Date.now() + durationMs;

    const snap = () => {
      const scrollEl = scrollRef.current;
      if (!scrollEl) return;
      scrollEl.scrollTop = scrollEl.scrollHeight;
      updateJumpToLatestVisibility();
    };

    const tick = () => {
      const scrollEl = scrollRef.current;
      if (!scrollEl) {
        initialBottomSettlerRafRef.current = null;
        return;
      }

      scrollEl.scrollTop = scrollEl.scrollHeight;
      updateJumpToLatestVisibility();

      if (Date.now() < initialBottomSettlerUntilRef.current && shouldStickToBottomRef.current) {
        initialBottomSettlerRafRef.current = window.requestAnimationFrame(tick);
        return;
      }

      scrollEl.scrollTop = scrollEl.scrollHeight;
      updateJumpToLatestVisibility();
      initialBottomSettlerRafRef.current = null;
    };

    initialBottomSettlerRafRef.current = window.requestAnimationFrame(tick);
    initialBottomSettlerTimersRef.current = [0, 40, 120, 260, 420].map((delay) =>
      window.setTimeout(snap, delay)
    );
  };

  const scrollToBottom = (smooth = false) => {
    shouldStickToBottomRef.current = true;
    requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
      window.setTimeout(() => updateJumpToLatestVisibility(), smooth ? 220 : 0);
    });
  };

  const resizeTextarea = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
  };


  const appendPendingFiles = (files: FileList | File[]) => {
    const incoming = Array.from(files || []).slice(0, 10);
    if (incoming.length === 0) return;
    setPendingAttachments((prev) => {
      const availableSlots = Math.max(0, 10 - prev.length);
      const nextItems = incoming.slice(0, availableSlots).map((file) => {
        const kind = getAttachmentKindFromFile(file);
        return {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          file,
          kind,
          previewUrl: URL.createObjectURL(file),
        } satisfies PendingAttachment;
      });
      if (nextItems.length < incoming.length) setError("En fazla 10 dosya ekleyebilirsin.");
      return [...prev, ...nextItems];
    });
  };

  const removePendingAttachment = (id: string) => {
    setPendingAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  };

  const handlePickFiles = (event: any) => {
    if (event.target.files?.length) appendPendingFiles(event.target.files);
    event.target.value = "";
  };

  const openFilePicker = () => fileInputRef.current?.click();

  const handleComposerDragEnter = (event: DragEvent<HTMLDivElement>) => {
    const hasFiles = Array.from(event.dataTransfer?.items ?? []).some((item: DataTransferItem) => item.kind === "file") || (event.dataTransfer?.files?.length ?? 0) > 0;
    if (!hasFiles) return;
    event.preventDefault();
    event.stopPropagation();
    composerDragDepthRef.current += 1;
    setIsDraggingComposerFiles(true);
  };

  const handleComposerDragOver = (event: DragEvent<HTMLDivElement>) => {
    const hasFiles = Array.from(event.dataTransfer?.items ?? []).some((item: DataTransferItem) => item.kind === "file") || (event.dataTransfer?.files?.length ?? 0) > 0;
    if (!hasFiles) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    if (!isDraggingComposerFiles) setIsDraggingComposerFiles(true);
  };

  const handleComposerDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    composerDragDepthRef.current = Math.max(0, composerDragDepthRef.current - 1);
    if (composerDragDepthRef.current === 0) setIsDraggingComposerFiles(false);
  };

  const handleComposerDrop = (event: DragEvent<HTMLDivElement>) => {
    const files = event.dataTransfer?.files;
    event.preventDefault();
    event.stopPropagation();
    composerDragDepthRef.current = 0;
    setIsDraggingComposerFiles(false);
    if (files?.length) {
      appendPendingFiles(files);
      setError("");
    }
  };

  const queueSilentSync = (delay = 700) => {
    if (optimisticSyncTimeoutRef.current) {
      window.clearTimeout(optimisticSyncTimeoutRef.current);
    }
    optimisticSyncTimeoutRef.current = window.setTimeout(() => {
      optimisticSyncTimeoutRef.current = null;
      void fetchMessages({ silent: true });
    }, delay);
  };

  const emitTypingStart = () => {
    if (!conversationId || !isWsReady) return;
    sendDmWsEvent({ type: "DM_TYPING_START", payload: { conversationId } });
    isTypingRef.current = true;
  };

  const stopTypingNow = () => {
    if (!conversationId || !isTypingRef.current) return;
    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    if (typingHeartbeatRef.current) window.clearInterval(typingHeartbeatRef.current);
    typingTimeoutRef.current = null;
    typingHeartbeatRef.current = null;
    isTypingRef.current = false;
    sendDmWsEvent({ type: "DM_TYPING_STOP", payload: { conversationId } });
  };

  const scheduleTypingStop = () => {
    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = window.setTimeout(stopTypingNow, 1800);
  };

  const ensureTypingHeartbeat = () => {
    if (typingHeartbeatRef.current) return;
    typingHeartbeatRef.current = window.setInterval(() => {
      if (!isTypingRef.current || !conversationId || !isWsReady) return;
      sendDmWsEvent({ type: "DM_TYPING_START", payload: { conversationId } });
    }, 1200);
  };

  const fetchMessages = async (opts?: { silent?: boolean }) => {
    if (!conversationId || !token) {
      setMessages([]);
      setHasMoreHistory(true);
      return;
    }
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const res = await fetch(
        `http://localhost:3001/dm/conversations/${conversationId}/messages?limit=${DM_MESSAGES_PAGE_SIZE}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "DM mesajları alınamadı");
      const nextMessages = Array.isArray(data) ? data.map(normalizeMessage) : [];
      setHasMoreHistory(nextMessages.length >= DM_MESSAGES_PAGE_SIZE);
      setMessages((prev) => {
        const merged = mergeMessages(prev, nextMessages);
        const hadMoreMessages = merged.length > prev.length;
        if (!firstLoadDoneRef.current) {
          requestAnimationFrame(() => {
            scrollToBottom(false);
            startInitialBottomSettler(700);
          });
        } else if (hadMoreMessages && shouldStickToBottomRef.current) {
          requestAnimationFrame(() => scrollToBottom(false));
        }
        return merged;
      });
      firstLoadDoneRef.current = true;
    } catch (err: any) {
      console.error("dm messages fetch error:", err);
      if (!silent) {
        setMessages([]);
        setError(err?.message || "DM mesajları yüklenemedi.");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadOlderMessages = async () => {
    if (
      historyLoadInFlightRef.current ||
      loading ||
      loadingMoreHistory ||
      !hasMoreHistory ||
      !conversationId ||
      !token ||
      messages.length === 0
    ) {
      return;
    }

    const oldestMessage = messages[0];
    if (!oldestMessage?.id) {
      setHasMoreHistory(false);
      return;
    }

    const scrollEl = scrollRef.current;
    historyLoadInFlightRef.current = true;
    setLoadingMoreHistory(true);
    setError("");

    if (scrollEl) {
      historyRestoreScrollRef.current = {
        previousHeight: scrollEl.scrollHeight,
        previousTop: scrollEl.scrollTop,
      };
    }

    try {
      const res = await fetch(
        `http://localhost:3001/dm/conversations/${conversationId}/messages?limit=${DM_MESSAGES_PAGE_SIZE}&before=${encodeURIComponent(oldestMessage.id)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Eski DM mesajları alınamadı");

      const olderMessages = Array.isArray(data) ? data.map(normalizeMessage) : [];
      setHasMoreHistory(olderMessages.length >= DM_MESSAGES_PAGE_SIZE);

      if (olderMessages.length === 0) {
        historyRestoreScrollRef.current = null;
        return;
      }

      setMessages((prev) => mergeMessages(olderMessages, prev));
    } catch (err: any) {
      console.error("older dm messages fetch error:", err);
      setError(err?.message || "Eski mesajlar yüklenemedi.");
      historyRestoreScrollRef.current = null;
    } finally {
      historyLoadInFlightRef.current = false;
      setLoadingMoreHistory(false);
    }
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    if (!conversationId || !isWsReady) return;
    if (!value.trim()) {
      stopTypingNow();
      return;
    }
    if (!isTypingRef.current) {
      emitTypingStart();
      ensureTypingHeartbeat();
    } else {
      ensureTypingHeartbeat();
    }
    scheduleTypingStop();
  };

  const handleSend = async () => {
    if (draftState.editingMessageId) {
      await saveEditMessage(draftState.editingMessageId);
      return;
    }

    const content = input.trim();
    if ((!content && pendingAttachments.length === 0) || !conversationId || sending || !token) return;

    const hasFiles = pendingAttachments.length > 0;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const replyToMessage = draftState.replyToMessageId
      ? messages.find((msg) => msg.id === draftState.replyToMessageId) || null
      : null;

    if (!hasFiles && isWsReady) {
      const optimisticMessage = normalizeMessage({
        id: tempId,
        conversationId,
        senderUserId: currentUserId,
        content,
        createdAt: new Date().toISOString(),
        editedAt: null,
        deletedAt: null,
        replyToMessageId: replyToMessage?.id || null,
        replyTo: replyToMessage
          ? {
              id: replyToMessage.id,
              userId: replyToMessage.senderUserId,
              displayName:
                replyToMessage.senderUserId === currentUserId ? "Sen" : otherDisplayName,
              username:
                replyToMessage.senderUserId === currentUserId
                  ? undefined
                  : otherUsername || undefined,
              content: replyToMessage.content,
            }
          : null,
        isPinned: false,
        pinnedAt: null,
        pinnedBy: null,
        attachments: [],
        optimistic: true,
        failed: false,
        clientTempId: tempId,
      });

      setSending(true);
      setError("");
      setMessages((prev) => mergeMessages(prev, [optimisticMessage]));
      setInput("");
      setDraftState((prev) => ({ ...prev, replyToMessageId: null, editingMessageId: null, editText: "" }));
      setShowEmojiPicker(false);
      stopTypingNow();
      requestAnimationFrame(() => {
        resizeTextarea();
        scrollToBottom(true);
        textareaRef.current?.focus();
      });

      try {
        const sent = sendDmWsEvent({
          type: "DM_SEND",
          payload: {
            conversationId,
            content,
            tempId,
            replyToMessageId: optimisticMessage.replyToMessageId || undefined,
          },
        });

        if (!sent) {
          setMessages((prev) => prev.filter((msg) => msg.id !== tempId));
          setError("DM websocket bağlantısı hazır değil.");
          return;
        }
      } finally {
        setSending(false);
      }

      return;
    }

    const pendingSnapshot = pendingAttachments.slice();
    const optimisticMessage = normalizeMessage({
      id: tempId,
      conversationId,
      senderUserId: currentUserId,
      content,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deletedAt: null,
      replyToMessageId: replyToMessage?.id || null,
      replyTo: replyToMessage
        ? {
            id: replyToMessage.id,
            userId: replyToMessage.senderUserId,
            displayName:
              replyToMessage.senderUserId === currentUserId ? "Sen" : otherDisplayName,
            username:
              replyToMessage.senderUserId === currentUserId
                ? undefined
                : otherUsername || undefined,
            content: replyToMessage.content,
          }
        : null,
      isPinned: false,
      pinnedAt: null,
      pinnedBy: null,
      attachments: pendingSnapshot.map((item, index) => ({
        id: `${tempId}-attachment-${index}`,
        messageId: tempId,
        kind: item.kind,
        url: item.previewUrl || "",
        originalName: item.file.name,
        mimeType: item.file.type || undefined,
        sizeBytes: item.file.size,
        createdAt: new Date().toISOString(),
      })),
      optimistic: true,
      failed: false,
      clientTempId: tempId,
    });

    setSending(true);
    setError("");
    setMessages((prev) => mergeMessages(prev, [optimisticMessage]));
    setInput("");
    setDraftState((prev) => ({ ...prev, replyToMessageId: null, editingMessageId: null, editText: "" }));
    setShowEmojiPicker(false);
    stopTypingNow();
    composerDragDepthRef.current = 0;
    setIsDraggingComposerFiles(false);
    setPendingAttachments([]);
    requestAnimationFrame(() => {
      resizeTextarea();
      scrollToBottom(true);
      textareaRef.current?.focus();
    });

    try {
      const res = await fetch(`http://localhost:3001/dm/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: hasFiles
          ? { Authorization: `Bearer ${token}` }
          : { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: hasFiles
          ? (() => {
              const form = new FormData();
              if (content) form.append("content", content);
              if (draftState.replyToMessageId) form.append("replyToMessageId", draftState.replyToMessageId);
              pendingSnapshot.forEach((item) => form.append("files", item.file));
              return form;
            })()
          : JSON.stringify({ content, replyToMessageId: draftState.replyToMessageId || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data?.error || "DM mesajı gönderilemedi.");

      pendingSnapshot.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      setMessages((prev) => mergeMessages(prev, [normalizeMessage(data)]));
      requestAnimationFrame(() => {
        resizeTextarea();
        scrollToBottom(true);
        textareaRef.current?.focus();
      });
    } catch (err: any) {
      setMessages((prev) => prev.filter((msg) => msg.id !== tempId));
      setInput(content);
      setDraftState((prev) => ({
        ...prev,
        replyToMessageId: replyToMessage?.id || null,
        editingMessageId: null,
        editText: "",
      }));
      setPendingAttachments(pendingSnapshot);
      setError(err?.message || "DM mesajı gönderilemedi.");
      requestAnimationFrame(() => {
        resizeTextarea();
        textareaRef.current?.focus();
      });
    } finally {
      setSending(false);
    }
  };

  const copyMessage = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {}
  };

  const startEditMessage = (message: DmMessage) => {
    if (message.deletedAt || message.senderUserId !== currentUserId) return;
    setDraftState((prev) => ({ ...prev, editingMessageId: message.id, editText: message.content }));
    setInput(message.content);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const cancelEditMessage = () => {
    setDraftState((prev) => ({ ...prev, editingMessageId: null, editText: "" }));
    setInput("");
  };

  const saveEditMessage = async (messageId: string) => {
    const nextContent = input.trim();
    if (!nextContent) return;

    const previousMessage = messages.find((msg) => msg.id === messageId) || null;
    if (!previousMessage) return;

    const optimisticMessage = normalizeMessage({
      ...previousMessage,
      content: nextContent,
      editedAt: new Date().toISOString(),
      optimistic: true,
      failed: false,
    });

    setError("");
    setMessages((prev) => mergeMessages(prev, [optimisticMessage]));
    setDraftState((prev) => ({ ...prev, editingMessageId: null, editText: "" }));
    setInput("");
    requestAnimationFrame(() => resizeTextarea());

    const sent = sendDmWsEvent({
      type: "DM_EDIT",
      payload: {
        messageId,
        content: nextContent,
      },
    });

    if (!sent) {
      setMessages((prev) => mergeMessages(prev, [previousMessage]));
      setDraftState((prev) => ({ ...prev, editingMessageId: messageId, editText: nextContent }));
      setInput(nextContent);
      setError("DM websocket bağlantısı hazır değil.");
    }
  };

  const deleteMessage = async (messageId: string) => {
    const previousMessages = messages;

    setError("");
    setMessages((prev) => prev.filter((msg) => msg.id !== messageId));
    setDraftState((prev) => ({
      ...prev,
      editingMessageId: prev.editingMessageId === messageId ? null : prev.editingMessageId,
      editText: prev.editingMessageId === messageId ? "" : prev.editText,
      replyToMessageId: prev.replyToMessageId === messageId ? null : prev.replyToMessageId,
    }));

    const sent = sendDmWsEvent({
      type: "DM_DELETE",
      payload: { messageId },
    });

    if (!sent) {
      setMessages(previousMessages);
      setError("DM websocket bağlantısı hazır değil.");
    }
  };

  const togglePinMessage = async (message: DmMessage) => {
    if (message.deletedAt) return;

    const nextPinned = !message.isPinned;
    const nowIso = new Date().toISOString();
    const previousMessage = message;
    const optimisticMessage = normalizeMessage({
      ...message,
      isPinned: nextPinned,
      pinnedAt: nextPinned ? nowIso : null,
      pinnedBy: nextPinned ? currentUserId : null,
      optimistic: true,
      failed: false,
    });

    setError("");
    setMessages((prev) => mergeMessages(prev, [optimisticMessage]));

    if (isWsReady) {
      const sent = sendDmWsEvent({
        type: "DM_PIN",
        payload: {
          messageId: message.id,
          pin: nextPinned,
          isPinned: nextPinned,
          pinned: nextPinned,
        },
      });

      if (!sent) {
        setMessages((prev) => mergeMessages(prev, [previousMessage]));
        setError(nextPinned ? "Mesaj pinlenemedi." : "Pin kaldırılamadı.");
        return;
      }

      return;
    }

    if (!token) {
      setMessages((prev) => mergeMessages(prev, [previousMessage]));
      return;
    }

    try {
      const res = await fetch(`http://localhost:3001/dm/messages/${message.id}/pin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pin: nextPinned, isPinned: nextPinned, pinned: nextPinned }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMessages((prev) => mergeMessages(prev, [previousMessage]));
        setError(data?.error || (message.isPinned ? "Pin kaldırılamadı." : "Mesaj pinlenemedi."));
        return;
      }
      setMessages((prev) => mergeMessages(prev, [normalizeMessage(data)]));
      queueSilentSync(450);
    } catch (err) {
      console.error("dm pin failed", err);
      setMessages((prev) => mergeMessages(prev, [previousMessage]));
      setError("Pin işlemi sırasında bağlantı hatası oluştu.");
    }
  };

  const startReplyToMessage = (messageId: string) => {
    setDraftState((prev) => ({ ...prev, replyToMessageId: messageId }));
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const cancelReply = () => {
    setDraftState((prev) => ({ ...prev, replyToMessageId: null }));
  };

  const insertEmoji = (emoji: string) => {
    setInput((prev) => `${prev}${emoji}`);
    setShowEmojiPicker(false);
    requestAnimationFrame(() => resizeTextarea());
    textareaRef.current?.focus();
  };

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    insertEmoji(emojiData.emoji);
  };

  const goToNextMatch = () => {
    if (filteredMessages.length === 0) return;
    setCurrentSearchIndex((prev) => (prev + 1 >= filteredMessages.length ? 0 : prev + 1));
  };

  const goToPrevMatch = () => {
    if (filteredMessages.length === 0) return;
    setCurrentSearchIndex((prev) => (prev - 1 < 0 ? filteredMessages.length - 1 : prev - 1));
  };

  const sendDmMediaControl = (
    action: "toggleMute" | "toggleDeafen" | "toggleCamera" | "toggleScreenShare" | "leave"
  ) => {
    window.dispatchEvent(
      new CustomEvent(DM_MEDIA_CONTROL_EVENT_NAME, {
        detail: { action, conversationId, channelId: dmChannelId },
      })
    );
  };

  const focusMediaCard = (item: { key: string; participantId: string; participantName?: string; source: "camera" | "screen"; announcement?: DmAnnouncementEntry | null; visual?: DmVisualEntry | null; }) => {
    setFocusedKey(item.key);
    const trackSid = item.visual?.trackSid || item.announcement?.trackSid || null;
    window.dispatchEvent(
      new CustomEvent(REQUEST_VISUAL_RECONCILE_EVENT_NAME, {
        detail: { channelId: dmChannelId, trackSid },
      })
    );
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent(REQUEST_VISUAL_RECONCILE_EVENT_NAME, {
          detail: { channelId: dmChannelId, trackSid },
        })
      );
    }, 220);
  };

  const joinScreenShare = (item: {
    key: string;
    participantId: string;
    participantName: string;
    source: "camera" | "screen";
    announcement?: DmAnnouncementEntry | null;
    visual?: DmVisualEntry | null;
  }) => {
    setJoinedScreenKey(item.key);
    setFocusedKey(item.key);
    const trackSid = item.visual?.trackSid || item.announcement?.trackSid || null;
    window.dispatchEvent(
      new CustomEvent(REQUEST_VISUAL_RECONCILE_EVENT_NAME, {
        detail: { channelId: dmChannelId, trackSid },
      })
    );
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent(REQUEST_VISUAL_RECONCILE_EVENT_NAME, {
          detail: { channelId: dmChannelId, trackSid },
        })
      );
    }, 220);
  };

  const leaveJoinedScreenShare = () => {
    const leavingCard = joinedScreenCard;
    setJoinedScreenKey(null);
    if (leavingCard) {
      setFocusedKey((prev) => (prev === leavingCard.key ? null : prev));
      setFullscreenCardKey((prev) => (prev === leavingCard.key ? null : prev));
    }
  };

  const leaveCameraStage = () => {
    const leavingCard = activeStageCard;
    if (!leavingCard || leavingCard.source !== "camera") return;
    setSelectedParticipantId((prev) =>
      prev === leavingCard.participantId ? null : prev
    );
    setFocusedKey((prev) => (prev === leavingCard.key ? null : prev));
    setFullscreenCardKey((prev) => (prev === leavingCard.key ? null : prev));
  };

  const toggleFullscreenCard = (key: string) => {
    setFullscreenCardKey((prev) => (prev === key ? null : key));
  };

  const startStageResize = (event: any) => {
    event.preventDefault();
    stageResizeRef.current = {
      startY: event.clientY,
      startHeight: stageHeight,
    };
  };

  useEffect(() => {
    resizeTextarea();
  }, [input]);

  useEffect(() => {
    if (showSearch) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    } else {
      setSearchText("");
      setCurrentSearchIndex(0);
    }
  }, [showSearch]);

  useEffect(() => setCurrentSearchIndex(0), [searchText]);

  useEffect(() => {
    try {
      setIdentityMap(((window as any)[USER_IDENTITY_SNAPSHOT_KEY] || {}) as IdentityMap);
    } catch {}
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{ map?: IdentityMap }>;
      setIdentityMap(customEvent.detail?.map || {});
    };
    window.addEventListener(USER_IDENTITY_EVENT_NAME, handler as EventListener);
    return () => window.removeEventListener(USER_IDENTITY_EVENT_NAME, handler as EventListener);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{
        channelId?: string | null;
        muted?: boolean;
        deafened?: boolean;
        camera?: boolean;
        screen?: boolean;
      }>;
      const detail = customEvent.detail || {};
      if (!dmChannelId || detail.channelId !== dmChannelId) return;
      setDmMediaState({
        muted: Boolean(detail.muted),
        deafened: Boolean(detail.deafened),
        camera: Boolean(detail.camera),
        screen: Boolean(detail.screen),
      });
    };

    window.addEventListener(DM_MEDIA_STATE_EVENT_NAME, handler as EventListener);
    return () => {
      window.removeEventListener(DM_MEDIA_STATE_EVENT_NAME, handler as EventListener);
    };
  }, [dmChannelId]);


  useEffect(() => {
    if (!dmChannelId) {
      setDmVisuals([]);
      setDmAnnouncements([]);
      setFocusedKey(null);
      setDmMediaState(null);
      return;
    }
    try {
      const vSnap = (((window as any)[STREAM_SNAPSHOT_KEY] || {}) as Record<string, any>)[dmChannelId];
      setDmVisuals(Array.isArray(vSnap?.visuals) ? vSnap.visuals : []);
    } catch {
      setDmVisuals([]);
    }
    try {
      const aSnap = (((window as any)[STREAM_ANNOUNCEMENT_SNAPSHOT_KEY] || {}) as Record<string, any>)[dmChannelId];
      setDmAnnouncements(Array.isArray(aSnap?.announcements) ? aSnap.announcements : []);
    } catch {
      setDmAnnouncements([]);
    }
  }, [dmChannelId]);

  useEffect(() => {
    if (!dmChannelId || dmAnnouncements.length === 0) return;

    const missingAnnouncements = dmAnnouncements.filter(
      (announcement) =>
        !dmVisuals.some(
          (visual) =>
            visual.trackSid === announcement.trackSid ||
            (visual.participantId === announcement.participantId &&
              visual.source === announcement.source)
        )
    );

    if (missingAnnouncements.length === 0) return;

    const timers = missingAnnouncements.map((announcement, index) =>
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent(REQUEST_VISUAL_RECONCILE_EVENT_NAME, {
            detail: {
              channelId: dmChannelId,
              trackSid: announcement.trackSid,
            },
          })
        );
      }, 80 + index * 60)
    );

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [dmChannelId, dmAnnouncements, dmVisuals]);

  useEffect(() => {
    const visualHandler = (event: Event) => {
      const customEvent = event as CustomEvent<{ channelId?: string | null; visuals?: DmVisualEntry[] }>;
      if (!dmChannelId || String(customEvent.detail?.channelId ?? "") !== dmChannelId) return;
      setDmVisuals(Array.isArray(customEvent.detail?.visuals) ? customEvent.detail.visuals : []);
    };
    const annHandler = (event: Event) => {
      const customEvent = event as CustomEvent<{ channelId?: string | null; announcements?: DmAnnouncementEntry[] }>;
      if (!dmChannelId || String(customEvent.detail?.channelId ?? "") !== dmChannelId) return;
      setDmAnnouncements(Array.isArray(customEvent.detail?.announcements) ? customEvent.detail.announcements : []);
    };
    const clearHandler = (event: Event) => {
      const customEvent = event as CustomEvent<{
        channelId?: string | null;
        userId?: string | null;
        participantId?: string | null;
        trackSid?: string | null;
        source?: "camera" | "screen" | null;
      }>;
      if (!dmChannelId || String(customEvent.detail?.channelId ?? "") !== dmChannelId) return;
      const clearedTrackSid = customEvent.detail?.trackSid ? String(customEvent.detail.trackSid) : null;
      const clearedParticipantId = customEvent.detail?.participantId
        ? String(customEvent.detail.participantId)
        : customEvent.detail?.userId
          ? String(customEvent.detail.userId)
          : null;
      const clearedSource =
        customEvent.detail?.source === "camera" || customEvent.detail?.source === "screen"
          ? customEvent.detail.source
          : null;

      const matchesClearedMedia = (item: {
        trackSid?: string | null;
        participantId?: string | null;
        source?: "camera" | "screen" | null;
      }) => {
        if (clearedTrackSid && item.trackSid === clearedTrackSid) return true;
        if (clearedParticipantId && clearedSource) {
          return item.participantId === clearedParticipantId && item.source === clearedSource;
        }
        return false;
      };

      setDmAnnouncements((prev) =>
        prev.filter((item) => !matchesClearedMedia(item))
      );
      setDmVisuals((prev) =>
        prev.filter((item) => !matchesClearedMedia(item))
      );

      if (
        joinedScreenCard &&
        matchesClearedMedia({
          trackSid: joinedScreenCard.visual?.trackSid || joinedScreenCard.announcement?.trackSid || null,
          participantId: joinedScreenCard.participantId,
          source: joinedScreenCard.source,
        })
      ) {
        setJoinedScreenKey(null);
        setFocusedKey((prev) => (prev === joinedScreenCard.key ? null : prev));
        setFullscreenCardKey((prev) => (prev === joinedScreenCard.key ? null : prev));
      }

      if (
        activeStageCard?.source === "camera" &&
        matchesClearedMedia({
          trackSid: activeStageCard.visual?.trackSid || activeStageCard.announcement?.trackSid || null,
          participantId: activeStageCard.participantId,
          source: activeStageCard.source,
        })
      ) {
        setFocusedKey((prev) => (prev === activeStageCard.key ? null : prev));
        setFullscreenCardKey((prev) => (prev === activeStageCard.key ? null : prev));
      }
    };

    window.addEventListener(STREAM_EVENT_NAME, visualHandler as EventListener);
    window.addEventListener(STREAM_ANNOUNCEMENT_EVENT_NAME, annHandler as EventListener);
    window.addEventListener(STREAM_ANNOUNCEMENT_CLEAR_EVENT_NAME, clearHandler as EventListener);
    return () => {
      window.removeEventListener(STREAM_EVENT_NAME, visualHandler as EventListener);
      window.removeEventListener(STREAM_ANNOUNCEMENT_EVENT_NAME, annHandler as EventListener);
      window.removeEventListener(STREAM_ANNOUNCEMENT_CLEAR_EVENT_NAME, clearHandler as EventListener);
    };
  }, [dmChannelId]);

  useEffect(() => {
    const now = Date.now();
    setDmAnnouncements((prev) =>
      prev.filter((item) => {
        const hasMatchingVisual = dmVisuals.some(
          (visual) =>
            getAnnouncementKey(visual) === getAnnouncementKey(item) &&
            hasUsableLiveVideoStream(visual.mediaStream)
        );

        if (item.source === "screen") {
          return hasMatchingVisual || now - Number(item.previewUpdatedAt ?? now) < 180000;
        }

        return hasMatchingVisual;
      })
    );
  }, [dmVisuals]);

  useEffect(() => {
    if (!conversationId || !token) {
      setMessages([]);
      setInput("");
      setSearchText("");
      setShowSearch(false);
      setError("");
      setDmMediaState(null);
      setLoadingMoreHistory(false);
      setHasMoreHistory(true);
      historyLoadInFlightRef.current = false;
      historyRestoreScrollRef.current = null;
      firstLoadDoneRef.current = false;
      lastConversationIdRef.current = null;
      stopTypingNow();
      return;
    }
    const conversationChanged = lastConversationIdRef.current !== conversationId;
    lastConversationIdRef.current = conversationId;
    if (conversationChanged) {
      stopTypingNow();
      clearInitialBottomSettler();
      shouldStickToBottomRef.current = true;
      firstLoadDoneRef.current = false;
      setMessages([]);
      setInput("");
      setSearchText("");
      setShowSearch(false);
      setError("");
      setLoadingMoreHistory(false);
      setHasMoreHistory(true);
      historyLoadInFlightRef.current = false;
      historyRestoreScrollRef.current = null;
      fetchMessages({ silent: false });
    }
    return () => {
      clearInitialBottomSettler();
      stopTypingNow();
    };
  }, [conversationId, token]);

  useEffect(() => {
    if (!conversation || !conversationId) return;
    const lastMessage = conversation.lastMessage;
    if (!lastMessage?.id) return;
    setMessages((prev) => {
      if (prev.some((msg) => msg.id === lastMessage.id)) return prev;
      const inferredMessage: DmMessage = normalizeMessage({
        id: lastMessage.id,
        conversationId,
        senderUserId: lastMessage.senderUserId,
        content: lastMessage.content,
        createdAt: lastMessage.createdAt,
        editedAt: lastMessage.editedAt,
      });
      const merged = mergeMessages(prev, [inferredMessage]);
      requestAnimationFrame(() => scrollToBottom(true));
      return merged;
    });
  }, [
    conversation?.lastMessage?.id,
    conversation?.lastMessage?.content,
    conversation?.lastMessage?.createdAt,
    conversation?.lastMessage?.senderUserId,
    conversation?.lastMessage?.editedAt,
    conversationId,
    conversation,
  ]);
  useEffect(() => {
    if (!realtimeMutationEvent || !conversationId) return;
    if (realtimeMutationEvent.conversationId !== conversationId) return;

    const incoming = normalizeMessage(realtimeMutationEvent.message);

    setMessages((prev) => {
      if (realtimeMutationEvent.type === "DM_MESSAGE_DELETED") {
        return prev.filter((msg) => msg.id !== incoming.id);
      }

      const merged = mergeMessages(prev, [incoming]);
      return merged;
    });

    if (realtimeMutationEvent.type === "DM_MESSAGE") {
      requestAnimationFrame(() => scrollToBottom(true));
    }
  }, [realtimeMutationEvent, conversationId]);


  const pinnedMessages = useMemo(() => {
    return [...messages]
      .filter((m) => m.isPinned && !m.deletedAt)
      .sort((a, b) => new Date(b.pinnedAt || b.createdAt).getTime() - new Date(a.pinnedAt || a.createdAt).getTime());
  }, [messages]);

  const replyTargetMessage = useMemo(() => (
    draftState.replyToMessageId ? messages.find((m) => m.id === draftState.replyToMessageId) || null : null
  ), [draftState.replyToMessageId, messages]);

  useEffect(() => {
    const onWindowClick = (event: MouseEvent) => {
      if (!showEmojiPicker) return;
      if (emojiPickerRef.current && event.target instanceof Node && !emojiPickerRef.current.contains(event.target)) {
        setShowEmojiPicker(false);
      }
    };
    window.addEventListener("mousedown", onWindowClick);
    return () => window.removeEventListener("mousedown", onWindowClick);
  }, [showEmojiPicker]);

  useEffect(() => {
    const onWindowClick = (event: MouseEvent) => {
      if (!showPinnedPanel) return;
      if (pinnedPanelRef.current && event.target instanceof Node && !pinnedPanelRef.current.contains(event.target)) {
        setShowPinnedPanel(false);
      }
    };
    window.addEventListener("mousedown", onWindowClick);
    return () => window.removeEventListener("mousedown", onWindowClick);
  }, [showPinnedPanel]);

  useEffect(() => {
    if (!loadingMoreHistory) return;
    const scrollEl = scrollRef.current;
    const restore = historyRestoreScrollRef.current;
    if (!scrollEl || !restore) return;

    requestAnimationFrame(() => {
      const nextHeight = scrollEl.scrollHeight;
      const heightDelta = nextHeight - restore.previousHeight;
      scrollEl.scrollTop = restore.previousTop + Math.max(0, heightDelta);
      historyRestoreScrollRef.current = null;
    });
  }, [messages, loadingMoreHistory]);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || !conversationId || !token) return;

    const handleScroll = () => {
      const distanceFromBottom =
        scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      shouldStickToBottomRef.current = distanceFromBottom <= 96;
      updateJumpToLatestVisibility();

      if (scrollEl.scrollTop > 80) return;
      void loadOlderMessages();
    };

    const syncJumpButtonOnly = () => {
      updateJumpToLatestVisibility();
    };

    requestAnimationFrame(syncJumpButtonOnly);
    const mountTimer = window.setTimeout(syncJumpButtonOnly, 60);

    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.clearTimeout(mountTimer);
      scrollEl.removeEventListener("scroll", handleScroll);
    };
  }, [conversationId, token, hasMoreHistory, loadingMoreHistory, messages.length, loading]);

  useEffect(() => {
    if (!conversationId || !token) return;
    const timer = window.setInterval(() => {
      void fetchMessages({ silent: true });
    }, 1800);
    return () => window.clearInterval(timer);
  }, [conversationId, token]);


  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      updateJumpToLatestVisibility();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [filteredMessages, conversationId]);

  useEffect(() => {
    return () => {
      clearInitialBottomSettler();
      if (optimisticSyncTimeoutRef.current) {
        window.clearTimeout(optimisticSyncTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const state = stageResizeRef.current;
      if (!state) return;
      const delta = event.clientY - state.startY;
      const maxHeight = Math.max(340, Math.min(560, Math.floor(window.innerHeight * 0.52)));
      const nextHeight = Math.max(240, Math.min(maxHeight, state.startHeight + delta));
      setStageHeight(nextHeight);
    };

    const onUp = () => {
      stageResizeRef.current = null;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [stageHeight]);

  useEffect(() => {
    if (joinedScreenKey && !screenCards.some((item) => item.key === joinedScreenKey)) {
      setJoinedScreenKey(null);
    }
    if (focusedKey && !mediaCards.some((item) => item.key === focusedKey)) {
      setFocusedKey(null);
    }
    if (fullscreenCardKey && !mediaCards.some((item) => item.key === fullscreenCardKey)) {
      setFullscreenCardKey(null);
    }
  }, [screenCards, mediaCards, joinedScreenKey, focusedKey, fullscreenCardKey]);

  useEffect(() => {
    if (screenCards.length === 0 && joinedScreenKey !== null) {
      setJoinedScreenKey(null);
    }
  }, [screenCards, joinedScreenKey]);

  useEffect(() => {
    if (!joinedScreenKey) return;
    const joinedCard = mediaCards.find((item) => item.key === joinedScreenKey) || null;
    if (!joinedCard) return;

    const joinedVisual =
      dmVisuals.find(
        (item) =>
          item.trackSid === (joinedCard.visual?.trackSid || joinedCard.announcement?.trackSid || "") ||
          (item.participantId === joinedCard.participantId && item.source === "screen")
      ) || null;

    if (!joinedVisual) {
      setFocusedKey((prev) => (prev === joinedScreenKey ? null : prev));
    }
  }, [joinedScreenKey, mediaCards, dmVisuals]);


  if (!conversation) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#9aa3af",
          fontSize: 14,
          padding: 24,
          textAlign: "center",
          background: "linear-gradient(180deg, #11141a 0%, #0f1217 100%)",
        }}
      >
        Soldan bir DM konuşması seç.
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        background: "linear-gradient(180deg, #11141a 0%, #0f1217 100%)",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #232833",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          background: "linear-gradient(180deg, #151922 0%, #12161d 100%)",
          position: "relative",
          overflow: "visible",
          zIndex: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 12 }}>
            <UserAvatar name={otherDisplayName} avatarUrl={otherUserAvatar} size={40} />
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "white", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {otherDisplayName}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "#8f98a6", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {otherUsername ? `@${otherUsername}` : "Direkt mesaj"}
                </span>
                {activeCallStatusText && isThisConversationInCall ? (
                  <span
                    style={{
                      ...pillNeutralStyle,
                      height: 20,
                      padding: "0 8px",
                      fontSize: 10,
                      background: "rgba(88,101,242,0.18)",
                      border: "1px solid rgba(123,138,255,0.18)",
                    }}
                  >
                    {activeCallStatusText}
                  </span>
                ) : null}
                {groupedTypingText ? (
                  <span style={{ fontSize: 12, color: "#9fb0ff", whiteSpace: "nowrap" }}>
                    {groupedTypingText}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0,
            }}
          >
            {showIncomingAcceptButtons && conversationId ? (
              <>
                <button onClick={() => void onIgnoreCall(conversationId)} style={dangerHeaderButtonStyle} title="Çağrıyı yoksay">
                  <X size={17} />
                </button>
                <button
                  onClick={async () => {
                    try {
                      await onRejectCall(conversationId);
                    } catch (err: any) {
                      setError(err?.message || "Çağrı reddedilemedi.");
                    }
                  }}
                  style={{ ...dangerHeaderButtonStyle, background: "linear-gradient(135deg,#ed4245,#c73c3f)" }}
                  title="Çağrıyı reddet"
                >
                  <PhoneOff size={17} />
                </button>
                <button
                  onClick={async () => {
                    try {
                      await onAcceptCall(conversationId);
                    } catch (err: any) {
                      setError(err?.message || "Çağrı kabul edilemedi.");
                    }
                  }}
                  style={{ ...headerIconButtonStyle, background: "linear-gradient(135deg,#3ba55d,#48c774)", border: "none" }}
                  title="Çağrıyı kabul et"
                >
                  <Check size={17} />
                </button>
              </>
            ) : null}

            {showStartCallButton && !showIncomingAcceptButtons ? (
              <button
                onClick={async () => {
                  try {
                    await onStartCall(conversationId!);
                  } catch (err: any) {
                    setError(err?.message || "Çağrı başlatılamadı.");
                  }
                }}
                style={headerIconButtonStyle}
                title="Sesli arama başlat"
              >
                <Phone size={17} />
              </button>
            ) : null}

            {showLeaveCallButton ? (
              <button
                onClick={async () => {
                  try {
                    await onEndCall(conversationId!);
                  } catch (err: any) {
                    setError(err?.message || "Çağrı sonlandırılamadı.");
                  }
                }}
                style={dangerHeaderButtonStyle}
                title="Çağrıdan ayrıl"
              >
                <PhoneOff size={17} />
              </button>
            ) : null}

            <button onClick={() => setShowSearch((prev) => !prev)} style={headerIconButtonStyle} title={showSearch ? "Aramayı kapat" : "Konuşmada ara"}>
              <Search size={16} />
            </button>
            <button onClick={() => setShowPinnedPanel((prev) => !prev)} style={headerIconButtonStyle} title="Pinlenmiş mesajlar">
              <Pin size={16} />
            </button>
          </div>
        </div>

        {showPinnedPanel ? (
          <div
            ref={pinnedPanelRef}
            style={{
              position: "absolute",
              top: 62,
              right: 16,
              width: 320,
              maxWidth: "calc(100% - 32px)",
              borderRadius: 18,
              padding: 12,
              background: "linear-gradient(180deg, rgba(20,24,33,0.98), rgba(14,18,26,0.98))",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "0 20px 50px rgba(0,0,0,0.45)",
              zIndex: 30,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "2px 2px 6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#fff", fontWeight: 900, fontSize: 13 }}>
                <Pin size={14} /> Pinlenmiş Mesajlar
              </div>
              <button onClick={() => setShowPinnedPanel(false)} style={miniActionButtonStyle} title="Kapat">
                <X size={14} />
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 280, overflowY: "auto", paddingRight: 2 }}>
              {pinnedMessages.length === 0 ? (
                <div style={{ borderRadius: 14, padding: "12px 13px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", color: "#9aa3af", fontSize: 13 }}>
                  Bu konuşmada henüz pinlenmiş mesaj yok.
                </div>
              ) : (
                pinnedMessages.map((message) => (
                  <button
                    key={`pin-${message.id}`}
                    onClick={() => {
                      const el = document.getElementById(`dm-message-${message.id}`);
                      el?.scrollIntoView({ behavior: "smooth", block: "center" });
                      setShowPinnedPanel(false);
                    }}
                    style={{
                      textAlign: "left",
                      borderRadius: 14,
                      border: "1px solid rgba(255,255,255,0.06)",
                      background: "rgba(255,255,255,0.03)",
                      color: "#d7deea",
                      padding: "10px 12px",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {message.senderUserId === currentUserId ? "Sen" : otherDisplayName}
                      </div>
                      <div style={{ fontSize: 11, color: "#8f98a6", flexShrink: 0 }}>{formatMessageTime(message.pinnedAt || message.createdAt)}</div>
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.45, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {message.content}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : null}

        {showSearch ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              ref={searchInputRef}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Bu konuşmada ara..."
              style={searchInputStyle}
            />
            <button onClick={goToPrevMatch} style={headerIconButtonStyle} title="Önceki sonuç" disabled={filteredMessages.length === 0}>
              <ChevronUp size={16} />
            </button>
            <button onClick={goToNextMatch} style={headerIconButtonStyle} title="Sonraki sonuç" disabled={filteredMessages.length === 0}>
              <ChevronDown size={16} />
            </button>
            <div style={{ fontSize: 12, color: "#9aa3af", minWidth: 76, textAlign: "right" }}>
              {searchText.trim() ? `${filteredMessages.length} sonuç` : "hazır"}
            </div>
          </div>
        ) : null}
      </div>

      {showMediaStage ? (
        <div
          onMouseEnter={() => setIsStageHovered(true)}
          onMouseLeave={() => setIsStageHovered(false)}
          style={{
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            padding: 14,
            background: "linear-gradient(180deg, #0b0f14 0%, #090c12 100%)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div
            style={{
              minHeight: 0,
              minWidth: 0,
              borderRadius: 24,
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.08)",
              background: "#0b0f14",
              position: "relative",
              boxShadow: "0 22px 44px rgba(0,0,0,0.28)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: 12,
                boxSizing: "border-box",
              }}
            >
              {activeStageCard ? (
                <div
                  onDoubleClick={() => toggleFullscreenCard(activeStageCard.key)}
                  style={{
                    flex: "0 0 auto",
                    minHeight: 0,
                    borderRadius: 16,
                    overflow: "hidden",
                    position: "relative",
                    background: "#090c12",
                    border: "1px solid rgba(255,255,255,0.08)",
                    height: stageHeight,
                    cursor: "pointer",
                  }}
                >
                  {activeStageCard.visual ? (
                    <StreamTile
                      mediaStream={activeStageCard.visual.mediaStream}
                      label={activeStageCard.participantName}
                      posterDataUrl={activeStagePreview}
                      fit="contain"
                      isLarge
                      muted={activeStageCard.source !== "screen" || getStreamVolume({
                        trackSid: activeStageCard.visual?.trackSid || activeStageCard.announcement?.trackSid || null,
                        participantId: activeStageCard.participantId,
                        source: activeStageCard.source,
                      }) <= 0}
                      volume={getStreamVolume({
                        trackSid: activeStageCard.visual?.trackSid || activeStageCard.announcement?.trackSid || null,
                        participantId: activeStageCard.participantId,
                        source: activeStageCard.source,
                      })}
                      onVolumeChange={(value) =>
                        setStreamVolume(
                          {
                            trackSid: activeStageCard.visual?.trackSid || activeStageCard.announcement?.trackSid || null,
                            participantId: activeStageCard.participantId,
                            source: activeStageCard.source,
                          },
                          value
                        )
                      }
                      showVolumeControls={activeStageCard.source === "screen"}
                    />
                  ) : activeStagePreview ? (
                    <img
                      src={activeStagePreview}
                      alt={activeStageCard.participantName}
                      style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }}
                    />
                  ) : (
                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg,#141922,#0e1219)" }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                        <UserAvatar
                          name={activeStageCard.participantName}
                          avatarUrl={
                            identityMap[activeStageCard.participantId]?.avatarUrl ??
                            (activeStageCard.participantId === currentUserId ? currentUserAvatar : otherUserAvatar)
                          }
                          size={86}
                        />
                        <div style={{ color: "#fff", fontSize: 18, fontWeight: 900 }}>{activeStageCard.participantName}</div>
                      </div>
                    </div>
                  )}

                  <div style={{ position: "absolute", top: 14, left: 14, display: "flex", gap: 8, flexWrap: "wrap", zIndex: 5 }}>
                    <span style={activeStageCard.source === "camera" ? pillBlueStyle : pillRedStyle}>
                      {activeStageCard.source === "camera" ? "KAMERA" : "YAYINDA"}
                    </span>
                  </div>

                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleFullscreenCard(activeStageCard.key);
                    }}
                    style={overlayActionButtonStyle}
                    title="Yayını tam ekran aç"
                  >
                    <Maximize2 size={16} />
                  </button>

                  {(activeStageCard.source === "screen" || activeStageCard.source === "camera") ? (
                    <div
                      style={{
                        position: "absolute",
                        left: "50%",
                        bottom: 16,
                        transform: `translateX(-50%) translateY(${isStageHovered ? "0" : "10px"})`,
                        opacity: isStageHovered ? 1 : 0,
                        pointerEvents: isStageHovered ? "auto" : "none",
                        transition: "opacity 180ms ease, transform 180ms ease",
                        zIndex: 6,
                      }}
                    >
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          if (activeStageCard.source === "screen") {
                            leaveJoinedScreenShare();
                            return;
                          }
                          leaveCameraStage();
                        }}
                        style={stageOverlayLeaveButtonStyle}
                        title={activeStageCard.source === "screen" ? "Yayından çık" : "Kamera görünümünden çık"}
                      >
                        Yayından Çık
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {showPreviewGallery ? (
                <div
                  style={{
                    flex: activeStageCard ? "0 0 auto" : "1 1 auto",
                    minHeight: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: activeStageCard ? 0 : 6,
                    boxSizing: "border-box",
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      maxWidth: 1120,
                      display: "grid",
                      gridTemplateColumns: `repeat(${Math.min(Math.max(previewMediaCards.length, 1), 3)}, minmax(250px, 340px))`,
                      justifyContent: "center",
                      gap: 18,
                      alignContent: "center",
                    }}
                  >
                    {previewMediaCards.map((item) => (
                      <div
                        key={item.key}
                        onClick={() => {
                          if (item.source === "camera") {
                            focusMediaCard(item);
                          } else {
                            joinScreenShare(item);
                          }
                        }}
                        onDoubleClick={() => toggleFullscreenCard(item.key)}
                        style={{
                          borderRadius: 22,
                          overflow: "hidden",
                          border: item.key === activeStageCard?.key ? "1px solid rgba(123,138,255,0.38)" : "1px solid rgba(255,255,255,0.08)",
                          background: "rgba(255,255,255,0.03)",
                          boxShadow: item.key === activeStageCard?.key ? "0 0 0 1px rgba(123,138,255,0.18), 0 14px 34px rgba(0,0,0,0.22)" : "0 14px 34px rgba(0,0,0,0.22)",
                          display: "flex",
                          flexDirection: "column",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ position: "relative", aspectRatio: "16 / 8.4", background: "#090c12" }}>
                          {item.announcement?.previewDataUrl ? (
                            <img
                              src={item.announcement.previewDataUrl}
                              alt={`${item.participantName} preview`}
                              style={{
                                width: "100%",
                                height: "100%",
                                display: "block",
                                objectFit: "contain",
                                background: "#090c12",
                              }}
                            />
                          ) : item.visual ? (
                            <StreamTile
                              mediaStream={item.visual.mediaStream}
                              label={item.participantName}
                              posterDataUrl={item.announcement?.previewDataUrl ?? null}
                              fit="contain"
                            />
                          ) : (
                            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <UserAvatar
                                name={item.participantName}
                                avatarUrl={identityMap[item.participantId]?.avatarUrl ?? (item.participantId === currentUserId ? currentUserAvatar : otherUserAvatar)}
                                size={62}
                              />
                            </div>
                          )}
                          <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 8 }}>
                            <span style={item.source === "camera" ? pillBlueStyle : pillRedStyle}>{item.source === "camera" ? "KAMERA ÖNİZLEME" : "YAYIN ÖNİZLEME"}</span>
                          </div>
                        </div>
                        <div
                          style={{
                            padding: 14,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ color: "#fff", fontSize: 13, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {item.participantName}
                            </div>
                            <div style={{ color: "rgba(255,255,255,0.68)", fontSize: 12, fontWeight: 700 }}>
                              {item.source === "camera" ? "Kamera • Canlı izlenebilir" : "Ekran paylaşımı • İzlemek için seç"}
                            </div>
                          </div>
                          {item.source === "screen" ? (
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                joinScreenShare(item);
                              }}
                              style={{
                                height: 40,
                                borderRadius: 14,
                                border: "1px solid rgba(123,138,255,0.24)",
                                background: "linear-gradient(135deg,#5865f2,#7b8aff)",
                                color: "#fff",
                                padding: "0 14px",
                                fontWeight: 900,
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 8,
                                flexShrink: 0,
                              }}
                            >
                              <LogIn size={16} />
                              İzle
                            </button>
                          ) : (
                            <div
                              style={{
                                height: 40,
                                borderRadius: 14,
                                border: "1px solid rgba(88,101,242,0.18)",
                                background: "rgba(88,101,242,0.12)",
                                color: "#dfe5ff",
                                padding: "0 14px",
                                fontWeight: 900,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 8,
                                flexShrink: 0,
                              }}
                            >
                              <Video size={16} />
                              Canlı
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div
                style={{
                  flex: "0 0 auto",
                  width: "100%",
                  borderRadius: 22,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "linear-gradient(180deg, rgba(18,22,30,0.96), rgba(10,13,19,0.96))",
                  boxShadow: "0 16px 30px rgba(0,0,0,0.18)",
                  padding: dockCards.length >= 4 ? 10 : 14,
                  minWidth: 0,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                  <div>
                    <div style={{ color: "#fff", fontSize: 15, fontWeight: 900 }}>Medya Dock</div>
                    <div style={{ color: "rgba(255,255,255,0.62)", fontSize: 12, fontWeight: 700 }}>
                      Kullanıcı kartları, kameralar ve yayınlar tek listede.
                    </div>
                  </div>
                  <div style={{ color: "#9fb0ff", fontSize: 12, fontWeight: 800 }}>
                    {dockCards.length} kart
                  </div>
                </div>

                <div
                  style={{
                    width: "100%",
                    display: "grid",
                    gridTemplateColumns:
                      dockCards.length <= 2
                        ? `repeat(${dockCards.length}, minmax(0, 1fr))`
                        : dockCards.length === 3
                          ? "repeat(3, minmax(0, 1fr))"
                          : "repeat(4, minmax(0, 1fr))",
                    gap: dockCards.length >= 4 ? 6 : 10,
                    alignItems: "stretch",
                    justifyItems: "stretch",
                    gridAutoRows: "1fr",
                    paddingRight: 0,
                    paddingBottom: 0,
                  }}
                >
                  {dockCards.map((card) => {
                    const isSelected =
                      card.type === "screen"
                        ? activeStageCard?.key === card.key || joinedScreenKey === card.key
                        : activeStageParticipant?.id === card.participantId;
                    const previewDataUrl = card.announcement?.previewDataUrl ?? null;
                    const cameraPreviewDataUrl = card.cameraAnnouncement?.previewDataUrl ?? null;
                    const hasCameraVisual = hasUsableLiveVideoStream(card.cameraVisual?.mediaStream);
                    return (
                      <div
                        key={card.key}
                        onClick={() => {
                          if (card.type === "screen") {
                            joinScreenShare({
                              key: card.key,
                              participantId: card.participantId,
                              participantName: card.participantName,
                              source: "screen",
                              announcement: card.announcement,
                              visual: card.visual,
                            });
                            return;
                          }

                          setSelectedParticipantId(card.participantId);

                          if (card.cameraVisual) {
                            focusMediaCard({
                              key: `${card.participantId}:camera`,
                              participantId: card.participantId,
                              participantName: card.participantName,
                              source: "camera",
                              announcement: card.cameraAnnouncement,
                              visual: card.cameraVisual,
                            });
                            return;
                          }

                          setFocusedKey(null);
                        }}
                        style={{
                          minWidth: 0,
                          borderRadius: 20,
                          overflow: "hidden",
                          border: isSelected ? "1px solid rgba(123,138,255,0.34)" : "1px solid rgba(255,255,255,0.08)",
                          background: "rgba(255,255,255,0.03)",
                          boxShadow: isSelected ? "0 0 0 1px rgba(123,138,255,0.16), 0 14px 34px rgba(0,0,0,0.22)" : "0 14px 34px rgba(0,0,0,0.22)",
                          display: "flex",
                          flexDirection: "column",
                          cursor: "pointer",
                          minHeight: 0,
                        }}
                      >
                        <div style={{ position: "relative", height: dockCards.length >= 4 ? 132 : 156, background: "#090c12", overflow: "hidden" }}>
                          {card.type === "screen" ? (
                            joinedScreenKey === card.key || fullscreenCardKey === card.key ? (
                              card.visual ? (
                                <StreamTile
                                  mediaStream={card.visual.mediaStream}
                                  label={card.participantName}
                                  posterDataUrl={previewDataUrl}
                                  fit="cover"
                                />
                              ) : previewDataUrl ? (
                                <img
                                  src={previewDataUrl}
                                  alt={`${card.participantName} preview`}
                                  style={{ width: "100%", height: "100%", display: "block", objectFit: "cover", background: "#090c12" }}
                                />
                              ) : (
                                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg,#141922,#0e1219)" }}>
                                  <UserAvatar name={card.participantName} avatarUrl={card.avatarUrl ?? null} size={60} />
                                </div>
                              )
                            ) : previewDataUrl ? (
                              <img
                                src={previewDataUrl}
                                alt={`${card.participantName} preview`}
                                style={{ width: "100%", height: "100%", display: "block", objectFit: "cover", background: "#090c12" }}
                              />
                            ) : (
                              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg,#141922,#0e1219)" }}>
                                <UserAvatar name={card.participantName} avatarUrl={card.avatarUrl ?? null} size={60} />
                              </div>
                            )
                          ) : hasCameraVisual && card.cameraVisual ? (
                            <StreamTile
                              mediaStream={card.cameraVisual.mediaStream}
                              label={card.participantName}
                              posterDataUrl={cameraPreviewDataUrl}
                              fit="cover"
                            />
                          ) : (
                            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg,#141922,#0e1219)" }}>
                              <UserAvatar name={card.participantName} avatarUrl={card.avatarUrl ?? null} size={62} />
                            </div>
                          )}
                          <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {card.type === "user" && hasCameraVisual ? <span style={pillBlueStyle}>CAM</span> : null}
                            {card.type === "screen" ? <span style={pillRedStyle}>LIVE</span> : null}
                          </div>
                          {card.type === "screen" ? (
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                if (joinedScreenKey === card.key) {
                                  leaveJoinedScreenShare();
                                  return;
                                }
                                joinScreenShare({
                                  key: card.key,
                                  participantId: card.participantId,
                                  participantName: card.participantName,
                                  source: "screen",
                                  announcement: card.announcement,
                                  visual: card.visual,
                                });
                              }}
                              style={{
                                position: "absolute",
                                right: 12,
                                bottom: 12,
                                width: 36,
                                height: 36,
                                borderRadius: 12,
                                border: "1px solid rgba(123,138,255,0.24)",
                                background: joinedScreenKey === card.key ? "rgba(255,95,95,0.18)" : "linear-gradient(135deg,#5865f2,#7b8aff)",
                                color: "#fff",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                              }}
                              title={joinedScreenKey === card.key ? "Yayından çık" : "Yayını izle"}
                            >
                              {joinedScreenKey === card.key ? <LogOut size={15} /> : <LogIn size={15} />}
                            </button>
                          ) : null}
                        </div>
                        <div style={{ padding: dockCards.length >= 4 ? "7px 6px" : "9px 10px", display: "flex", alignItems: "center", justifyContent: "center", minHeight: dockCards.length >= 4 ? 28 : 38 }}>
                          <div style={{ color: "#fff", fontSize: dockCards.length >= 4 ? 12 : 14, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "center" }}>
                            {card.participantName}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {fullscreenCard ? (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 8,
                    background: "rgba(3,4,8,0.94)",
                    backdropFilter: "blur(10px)",
                    display: "flex",
                    flexDirection: "column",
                    padding: 12,
                    boxSizing: "border-box",
                  }}
                >
                  <div
                    onDoubleClick={() => setFullscreenCardKey(null)}
                    style={{
                      flex: 1,
                      minHeight: 0,
                      borderRadius: 20,
                      overflow: "hidden",
                      position: "relative",
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "#090c12",
                    }}
                  >
                    {fullscreenCard.visual ? (
                      <StreamTile
                        mediaStream={fullscreenCard.visual.mediaStream}
                        label={fullscreenCard.participantName}
                        posterDataUrl={fullscreenCard.announcement?.previewDataUrl ?? null}
                        fit={fullscreenCard.source === "screen" ? "contain" : "contain"}
                        isLarge
                      />
                    ) : fullscreenCard.announcement?.previewDataUrl ? (
                      <img
                        src={fullscreenCard.announcement.previewDataUrl}
                        alt={fullscreenCard.participantName}
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "block",
                          objectFit: fullscreenCard.source === "screen" ? "contain" : "contain",
                          background: "#090c12",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "linear-gradient(180deg,#141922,#0e1219)",
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                          <UserAvatar
                            name={fullscreenCard.participantName}
                            avatarUrl={
                              identityMap[fullscreenCard.participantId]?.avatarUrl ??
                              (fullscreenCard.participantId === currentUserId ? currentUserAvatar : otherUserAvatar)
                            }
                            size={96}
                          />
                          <div style={{ color: "#fff", fontSize: 18, fontWeight: 900 }}>
                            {fullscreenCard.participantName}
                          </div>
                        </div>
                      </div>
                    )}

                    <div
                      style={{
                        position: "absolute",
                        top: 14,
                        left: 14,
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        zIndex: 2,
                      }}
                    >
                      {fullscreenCard.source === "screen" ? <span style={pillRedStyle}>YAYIN TAM EKRAN</span> : null}
                      {fullscreenCard.source === "camera" ? <span style={pillBlueStyle}>KAMERA TAM EKRAN</span> : null}
                    </div>

                    <button
                      onClick={() => setFullscreenCardKey(null)}
                      style={{
                        position: "absolute",
                        top: 14,
                        right: 14,
                        width: 40,
                        height: 40,
                        borderRadius: 12,
                        border: "1px solid rgba(255,255,255,0.14)",
                        background: "rgba(6,8,12,0.68)",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        backdropFilter: "blur(10px)",
                        zIndex: 2,
                      }}
                      title="Tam ekrandan çık"
                    >
                      <Minimize2 size={18} />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <div
              style={{
                position: "absolute",
                left: "50%",
                bottom: 18,
                transform: "translateX(-50%)",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                borderRadius: 18,
                background: "rgba(10,12,18,0.62)",
                border: "1px solid rgba(255,255,255,0.10)",
                backdropFilter: "blur(12px)",
                opacity: isStageHovered ? 1 : 0.06,
                transition: "opacity 160ms ease, transform 160ms ease",
                zIndex: 9,
              }}
            >
              <button
                onClick={() => sendDmMediaControl("toggleMute")}
                style={getStageControlButtonStyle(localMuted ? "activeRed" : "default")}
                title="Mikrofon"
              >
                {localMuted ? <MicOff size={18} /> : <Mic size={18} />}
              </button>
              <button
                onClick={() => sendDmMediaControl("toggleDeafen")}
                style={getStageControlButtonStyle(localDeafened ? "activeRed" : "default")}
                title="Sesi kapat"
              >
                {localDeafened ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <button
                onClick={() => sendDmMediaControl("toggleCamera")}
                style={getStageControlButtonStyle(localCameraActive ? "activeBlue" : "default")}
                title="Kamera"
              >
                {localCameraActive ? <Video size={18} /> : <VideoOff size={18} />}
              </button>
              <button
                onClick={() => sendDmMediaControl("toggleScreenShare")}
                style={getStageControlButtonStyle(localScreenActive ? "activeGreen" : "default")}
                title="Ekran paylaşımı"
              >
                <MonitorUp size={18} />
              </button>
              <button
                onClick={async () => {
                  if (conversationId) {
                    try {
                      await onEndCall(conversationId);
                    } catch (err: any) {
                      setError(err?.message || "Çağrı sonlandırılamadı.");
                    }
                  } else {
                    sendDmMediaControl("leave");
                  }
                }}
                style={getStageControlButtonStyle("danger")}
                title="Çağrıdan ayrıl"
              >
                <PhoneOff size={18} />
              </button>

            </div>

            <button
              onMouseDown={startStageResize}
              style={{
                position: "absolute",
                left: "50%",
                bottom: 0,
                transform: "translateX(-50%)",
                width: 82,
                height: 18,
                border: "none",
                background: "transparent",
                color: "rgba(255,255,255,0.50)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "ns-resize",
                zIndex: 10,
              }}
              title="Yüksekliği sürükleyerek ayarla"
            >
              <GripVertical size={16} />
            </button>
          </div>

          {dmCallState.status === "left" && conversationId ? (
            <div style={{ display: "flex", justifyContent: "center" }}>
              <button
                onClick={() => void onRejoinCall(conversationId)}
                style={{
                  height: 40,
                  borderRadius: 999,
                  border: "1px solid rgba(123,138,255,0.3)",
                  background: "linear-gradient(135deg, rgba(88,101,242,0.22), rgba(123,138,255,0.16))",
                  color: "#fff",
                  padding: "0 16px",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Görüşmeye tekrar katıl
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "18px 18px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >

        {loadingMoreHistory ? (
          <div style={{ alignSelf: "center", color: "#9aa3af", fontSize: 12, padding: "2px 0 8px" }}>Eski mesajlar yükleniyor...</div>
        ) : null}

        {!loading && !hasMoreHistory && messages.length > 0 ? (
          <div style={{ alignSelf: "center", color: "#727c8a", fontSize: 11, padding: "2px 0 8px" }}>Konuşmanın başlangıcına ulaştın.</div>
        ) : null}

        {loading ? (
          <div style={{ color: "#9aa3af", fontSize: 13 }}>Mesajlar yükleniyor...</div>
        ) : filteredMessages.length === 0 ? (
          <div style={{ color: "#9aa3af", fontSize: 13, borderRadius: 18, padding: 16, background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.02))", border: "1px solid rgba(255,255,255,0.05)" }}>
            {messages.length === 0 ? "Henüz mesaj yok. İlk mesajı sen gönder." : "Aramaya uygun mesaj bulunamadı."}
          </div>
        ) : (
          filteredMessages.map((message, index) => {
            const previousMessage = index > 0 ? filteredMessages[index - 1] : null;
            const currentDayKey = getMessageDayKey(message.createdAt);
            const previousDayKey = previousMessage ? getMessageDayKey(previousMessage.createdAt) : "";
            const shouldShowDaySeparator = Boolean(currentDayKey) && currentDayKey !== previousDayKey;
            const dayLabel = shouldShowDaySeparator ? formatMessageDayLabel(message.createdAt) : "";
            const previousIsUserMessage = Boolean(previousMessage && previousMessage.messageType !== "system");
            const isGroupedWithPrevious =
              previousIsUserMessage &&
              !shouldShowDaySeparator &&
              previousMessage?.senderUserId === message.senderUserId;

            if (message.messageType === "system" && message.systemMeta) {
              const isFocusedSearchItem = searchText.trim() && index === currentSearchIndex;
              return (
                <div key={message.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {shouldShowDaySeparator ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0 2px" }}>
                      <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
                      <div style={{ color: "#aeb8c7", fontSize: 12, fontWeight: 800, letterSpacing: 0.2, whiteSpace: "nowrap" }}>{dayLabel}</div>
                      <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
                    </div>
                  ) : null}
                  <div style={{ display: "flex", justifyContent: "center", padding: "4px 0" }}>
                    <div style={{ maxWidth: "82%", padding: "9px 14px", borderRadius: 999, background: "rgba(255,255,255,0.045)", border: isFocusedSearchItem ? "1px solid rgba(255, 214, 10, 0.65)" : "1px solid rgba(255,255,255,0.06)", boxShadow: isFocusedSearchItem ? "0 0 0 3px rgba(255, 214, 10, 0.10)" : "none", color: "#c8d0dc", fontSize: 12, fontWeight: 700, textAlign: "center" }}>
                      {highlightText(getSystemMessageText(message.systemMeta, currentUserId, otherDisplayName), searchText)}
                    </div>
                  </div>
                </div>
              );
            }
            const mine = message.senderUserId === currentUserId;
            const isFocusedSearchItem = !!searchText.trim() && index === currentSearchIndex;
            const senderName = mine ? "Sen" : otherDisplayName;
            const senderAvatar = mine ? currentUserAvatar : otherUserAvatar;
            const isEditing = draftState.editingMessageId === message.id;
            const avatarSlot = 38;
            return (
              <div key={message.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {shouldShowDaySeparator ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0 2px" }}>
                    <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
                    <div style={{ color: "#aeb8c7", fontSize: 12, fontWeight: 800, letterSpacing: 0.2, whiteSpace: "nowrap" }}>{dayLabel}</div>
                    <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
                  </div>
                ) : null}
                <div
                  id={`dm-message-${message.id}`}
                  onMouseEnter={() => setHoveredMessageId(message.id)}
                  onMouseLeave={() => setHoveredMessageId((prev) => prev === message.id ? null : prev)}
                  style={{
                    display: "flex",
                    justifyContent: mine ? "flex-end" : "flex-start",
                    position: "relative",
                    minWidth: 0,
                    paddingTop: isGroupedWithPrevious ? 6 : 28,
                  }}
                >
                  <div
                    style={{
                      maxWidth: "78%",
                      width: "fit-content",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: mine ? "flex-end" : "flex-start",
                      gap: 6,
                      position: "relative",
                      minWidth: 0,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexDirection: mine ? "row-reverse" : "row", width: "fit-content", maxWidth: "100%", minWidth: 0 }}>
                      {isGroupedWithPrevious ? (
                        <div style={{ width: avatarSlot, minWidth: avatarSlot, height: 1, flexShrink: 0 }} />
                      ) : (
                        <UserAvatar name={senderName} avatarUrl={senderAvatar} size={avatarSlot} />
                      )}
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, maxWidth: "min(70vw, 820px)", alignItems: mine ? "flex-end" : "flex-start" }}>
                        {!isGroupedWithPrevious ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: mine ? "flex-end" : "flex-start", maxWidth: "100%" }}>
                            <span style={{ color: "#fff", fontSize: 13, fontWeight: 900 }}>{senderName}</span>
                            <span style={{ color: "#9aa3af", fontSize: 11 }}>{formatMessageTime(message.createdAt)}</span>
                            {message.editedAt ? <span style={{ color: "#9aa3af", fontSize: 11 }}>(düzenlendi)</span> : null}
                            {message.isPinned ? <span style={{ ...pillNeutralStyle, height: 20 }}><Pin size={10} style={{ marginRight: 4 }} /> PIN</span> : null}
                          </div>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 0 }}>
                            {message.isPinned ? <span style={{ ...pillNeutralStyle, height: 20 }}><Pin size={10} style={{ marginRight: 4 }} /> PIN</span> : null}
                            {message.editedAt ? <span style={{ color: "#9aa3af", fontSize: 11 }}>(düzenlendi)</span> : null}
                          </div>
                        )}
                        {message.replyTo ? (
                          <div style={{ maxWidth: "100%", minWidth: 0, borderRadius: 12, padding: "8px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.05)", overflow: "hidden" }}>
                            <div style={{ color: "#9fb0ff", fontSize: 11, fontWeight: 800, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{message.replyTo.displayName}</div>
                            <div style={{ color: "#aeb8c7", fontSize: 12, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{message.replyTo.content}</div>
                          </div>
                        ) : null}
                        <div style={{ width: "fit-content", maxWidth: "100%", minWidth: 0, borderRadius: message.content ? 16 : 14, padding: message.content ? "10px 12px" : "2px", background: message.content ? (mine ? "linear-gradient(135deg,#5865f2,#7b8aff)" : "rgba(255,255,255,0.06)") : "transparent", color: "white", border: isFocusedSearchItem ? "1px solid rgba(255, 214, 10, 0.65)" : message.content ? (mine ? "none" : "1px solid rgba(255,255,255,0.06)") : "none", boxShadow: isFocusedSearchItem ? "0 0 0 3px rgba(255,214,10,0.10)" : message.content ? (mine ? "0 10px 22px rgba(88,101,242,0.22)" : "none") : "none" }}>
                          {message.content ? (
                            <div style={getMessageTextStyle(message.content)}>
                              {highlightText(message.content, searchText)}
                            </div>
                          ) : null}
                          {message.attachments?.length ? <MessageAttachments attachments={message.attachments} onOpenImage={(src, title) => setMediaLightbox({ src, title })} isOwnMessage={mine} /> : null}
                          {!message.content && !message.attachments?.length ? <div style={{ color: "#8f98a6", fontSize: 13 }}>Boş mesaj</div> : null}
                          {extractUrls(message.content || "").map((url) => (
                            <LinkPreviewCard key={`${message.id}-${url}`} url={url} />
                          ))}
                        </div>
                      </div>
                    </div>
                    {hoveredMessageId === message.id ? (
                      <div
                        style={{
                          position: "absolute",
                          top: -16,
                          right: mine ? 48 : 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                          flexWrap: "nowrap",
                          padding: 6,
                          borderRadius: 12,
                          background: "#171b22",
                          border: "1px solid rgba(255,255,255,0.08)",
                          boxShadow: "0 14px 34px rgba(0,0,0,0.28)",
                          zIndex: 3,
                          height: 46,
                          width: mine ? 206 : 126,
                          minWidth: mine ? 206 : 126,
                          whiteSpace: "nowrap",
                        }}
                      >
                        <button onClick={() => startReplyToMessage(message.id)} style={miniActionButtonStyle} title="Yanıtla"><Reply size={15} /></button>
                        <button onClick={() => togglePinMessage(message)} style={miniActionButtonStyle} title={message.isPinned ? "Pin kaldır" : "Pinle"}><Pin size={15} /></button>
                        <button onClick={() => copyMessage(message.content)} style={miniActionButtonStyle} title="Kopyala"><Copy size={15} /></button>
                        {mine ? <button onClick={() => startEditMessage(message)} style={miniActionButtonStyle} title="Düzenle"><Pencil size={15} /></button> : null}
                        {mine ? <button onClick={() => deleteMessage(message.id)} style={miniActionButtonStyle} title="Sil"><Trash2 size={15} /></button> : null}
                      </div>
                    ) : null}
                    {isEditing ? <div style={{ color: "#9fb0ff", fontSize: 12, fontWeight: 700 }}>Düzenleme modundasın</div> : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {showJumpToLatest ? (
        <div
          style={{
            position: "sticky",
            bottom: 12,
            zIndex: 12,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
            marginTop: -62,
            paddingBottom: 8,
          }}
        >
          <div
            style={{
              pointerEvents: "auto",
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              justifyContent: "center",
              padding: "10px 12px",
              borderRadius: 16,
              background: "rgba(15,18,23,0.94)",
              border: "1px solid rgba(255,255,255,0.09)",
              boxShadow: "0 18px 42px rgba(0,0,0,0.34)",
              backdropFilter: "blur(8px)",
            }}
          >
            <div style={{ color: "#cdd6e3", fontSize: 13, fontWeight: 800 }}>
              Eski mesajları görüntülüyorsun
            </div>
            <button
              type="button"
              onClick={() => {
                shouldStickToBottomRef.current = true;
                setShowJumpToLatest(false);
                scrollToBottom(true);
              }}
              style={{
                height: 36,
                padding: "0 14px",
                borderRadius: 12,
                border: "1px solid rgba(114,137,255,0.28)",
                background: "linear-gradient(135deg, rgba(88,101,242,0.96), rgba(123,138,255,0.96))",
                color: "#fff",
                fontSize: 13,
                fontWeight: 900,
                cursor: "pointer",
                boxShadow: "0 12px 28px rgba(88,101,242,0.26)",
              }}
            >
              Günümüze Git
            </button>
          </div>
        </div>
      ) : null}

      <div style={{ borderTop: "1px solid #232833", padding: 14, background: "rgba(15,18,23,0.95)", position: "relative" }}>
        {error ? <div style={{ marginBottom: 10, color: "#ffb4b4", fontSize: 12 }}>{error}</div> : null}
        {replyTargetMessage ? (
          <div style={{ marginBottom: 10, borderRadius: 12, padding: "10px 12px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "#9fb0ff", fontSize: 11, fontWeight: 800, marginBottom: 4 }}>Yanıtlanıyor: {replyTargetMessage.senderUserId === currentUserId ? "Sen" : otherDisplayName}</div>
              <div style={{ color: "#d7deea", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{replyTargetMessage.content}</div>
            </div>
            <button onClick={cancelReply} style={miniActionButtonStyle} title="Yanıtı iptal et"><X size={15} /></button>
          </div>
        ) : null}
        {draftState.editingMessageId ? (
          <div style={{ marginBottom: 10, borderRadius: 12, padding: "10px 12px", background: "rgba(88,101,242,0.10)", border: "1px solid rgba(123,138,255,0.18)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ color: "#d7deea", fontSize: 12, fontWeight: 700 }}>Mesaj düzenleniyor</div>
            <button onClick={cancelEditMessage} style={miniActionButtonStyle} title="Düzenlemeyi iptal et"><X size={15} /></button>
          </div>
        ) : null}
        <div
          onDragEnter={handleComposerDragEnter}
          onDragOver={handleComposerDragOver}
          onDragLeave={handleComposerDragLeave}
          onDrop={handleComposerDrop}
          style={{ display: "flex", flexDirection: "column", gap: 10, padding: isDraggingComposerFiles ? 10 : 0, borderRadius: 16, border: isDraggingComposerFiles ? "1px dashed rgba(123,138,255,0.52)" : "1px dashed transparent", background: isDraggingComposerFiles ? "rgba(88,101,242,0.08)" : "transparent", transition: "all 140ms ease" }}
        >
          <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={handlePickFiles} />
          {pendingAttachments.length ? (
            <div
              style={{
                display: "flex",
                gap: 8,
                overflowX: "auto",
                overflowY: "hidden",
                paddingBottom: 2,
                maxWidth: "100%",
              }}
            >
              {pendingAttachments.map((item) => (
                <div key={item.id} style={{ flex: "0 0 168px", minWidth: 168 }}>
                  <PendingAttachmentCard item={item} onRemove={removePendingAttachment} />
                </div>
              ))}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <button onClick={openFilePicker} style={{ ...miniActionButtonStyle, width: 46, height: 46 }} title="Dosya ekle"><Paperclip size={18} /></button>
              <div style={{ position: "relative" }}>
                <button onClick={() => setShowEmojiPicker((prev) => !prev)} style={{ ...miniActionButtonStyle, width: 46, height: 46 }} title="Emoji"><Smile size={18} /></button>
                {showEmojiPicker ? (
                  <div ref={emojiPickerRef} style={{ position: "absolute", bottom: 56, left: 0, zIndex: 20 }}>
                    <EmojiPicker theme={Theme.DARK} onEmojiClick={handleEmojiClick} lazyLoadEmojis />
                  </div>
                ) : null}
              </div>
            </div>
            <textarea ref={textareaRef} value={input} onChange={(e) => handleInputChange(e.target.value)} onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); } }} placeholder={draftState.editingMessageId ? "Mesajı düzenle" : `${otherDisplayName} kişisine mesaj gönder`} rows={1} style={{ flex: 1, minHeight: 46, maxHeight: 140, resize: "none", borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "white", padding: "12px 14px", fontSize: 14, outline: "none", lineHeight: 1.4, fontFamily: "inherit", overflowY: "auto" }} />
            <button onClick={() => void handleSend()} disabled={(!input.trim() && pendingAttachments.length === 0) || sending || !token} style={{ height: 46, width: 46, borderRadius: 14, border: "none", background: (!input.trim() && pendingAttachments.length === 0) || sending || !token ? "rgba(255,255,255,0.08)" : "linear-gradient(135deg,#5865f2,#7b8aff)", color: "white", cursor: (!input.trim() && pendingAttachments.length === 0) || sending || !token ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <SendHorizontal size={18} />
            </button>
          </div>
        </div>
      </div>
      <MediaLightbox state={mediaLightbox} onClose={() => setMediaLightbox(null)} />
    </div>
  );
}

const headerIconButtonStyle: CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.04)",
  color: "white",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const dangerHeaderButtonStyle: CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 10,
  border: "none",
  background: "linear-gradient(135deg,#ed4245,#ff5b61)",
  color: "white",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const searchInputStyle: CSSProperties = {
  flex: 1,
  width: "100%",
  background: "#10141a",
  color: "white",
  border: "1px solid #2f3642",
  borderRadius: 12,
  padding: "10px 12px",
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
};

const pillRedStyle: CSSProperties = {
  height: 24,
  padding: "0 9px",
  borderRadius: 999,
  display: "inline-flex",
  alignItems: "center",
  background: "#ed4245",
  color: "#fff",
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: 0.35,
};

const pillBlueStyle: CSSProperties = {
  height: 24,
  padding: "0 9px",
  borderRadius: 999,
  display: "inline-flex",
  alignItems: "center",
  background: "rgba(88,101,242,0.9)",
  color: "#fff",
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: 0.35,
};

const overlayActionButtonStyle: CSSProperties = {
  position: "absolute",
  top: 14,
  right: 14,
  width: 38,
  height: 38,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(6,8,12,0.66)",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  backdropFilter: "blur(10px)",
  zIndex: 5,
};

const stageOverlayLeaveButtonStyle: CSSProperties = {
  height: 42,
  padding: "0 18px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(13,16,22,0.82)",
  color: "#fff",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  backdropFilter: "blur(12px)",
  boxShadow: "0 14px 36px rgba(0,0,0,0.34)",
  zIndex: 6,
  fontSize: 13,
  fontWeight: 900,
  letterSpacing: 0.2,
  whiteSpace: "nowrap",
};

const miniActionButtonStyle: CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.06)",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const pillNeutralStyle: CSSProperties = {
  height: 24,
  padding: "0 9px",
  borderRadius: 999,
  display: "inline-flex",
  alignItems: "center",
  background: "rgba(255,255,255,0.10)",
  color: "#fff",
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: 0.35,
};

function getStageControlButtonStyle(
  variant: "default" | "activeRed" | "activeBlue" | "activeGreen" | "danger" | "warning"
): CSSProperties {
  const base: CSSProperties = {
    width: 46,
    height: 46,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.07)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#f2f3f5",
    cursor: "pointer",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 18px rgba(0,0,0,0.22)",
  };
  const map: Record<string, CSSProperties> = {
    default: { background: "linear-gradient(180deg, #2b2d31 0%, #23252a 100%)" },
    activeRed: { background: "linear-gradient(135deg, #ed4245 0%, #ff5d63 100%)" },
    activeBlue: { background: "linear-gradient(135deg, #5865f2 0%, #7983ff 100%)" },
    activeGreen: { background: "linear-gradient(135deg, #23a559 0%, #37c871 100%)" },
    danger: { background: "linear-gradient(135deg, #da373c 0%, #f04f55 100%)" },
    warning: { background: "linear-gradient(135deg, #f59e0b 0%, #f97316 100%)" },
  };
  return { ...base, ...map[variant] };
}
