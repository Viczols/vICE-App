import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, KeyboardEvent } from "react";
import { ExternalLink, FileText, ImagePlus, Paperclip, Pin, Search, SendHorizontal, Smile, Video, Volume2, VolumeX, X } from "lucide-react";
import EmojiPicker, { Theme, type EmojiClickData } from "emoji-picker-react";
import type { Channel, VoicePresenceItem } from "../layout/MainLayout";

type ChatAreaProps = {
  selectedChannel: Channel;
  voicePresenceMap: Record<string, VoicePresenceItem[]>;
  activeVoiceChannelId: string | null;
};

type ReplyPreview = {
  id: string;
  userId: string;
  displayName: string;
  username?: string;
  content: string;
};

type ChatAttachment = {
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

type ChatMessage = {
  id: string;
  channelId: string;
  userId: string;
  displayName: string;
  username?: string;
  avatarUrl?: string | null;
  highestRoleColor?: string | null;
  content: string;
  createdAt: string;
  editedAt?: string | null;
  deletedAt?: string | null;
  replyToMessageId?: string | null;
  replyTo?: ReplyPreview | null;
  isPinned?: boolean;
  pinnedAt?: string | null;
  pinnedBy?: string | null;
  attachments?: ChatAttachment[];
};

type IdentityMap = Record<
  string,
  {
    displayName?: string;
    username?: string;
    avatarUrl?: string | null;
    highestRoleColor?: string | null;
  }
>;

type VoiceVisualEntry = {
  participantId: string;
  participantName: string;
  trackSid: string;
  mediaStream: MediaStream;
  source: "camera" | "screen";
};

type StreamAnnouncement = {
  trackSid: string;
  participantId: string;
  participantName: string;
  source: "camera" | "screen";
  previewDataUrl?: string | null;
  previewUpdatedAt?: number | null;
};

type DraftActionState = {
  editingMessageId: string | null;
  editText: string;
  replyToMessageId: string | null;
};

type MessagesPageResponse = {
  messages: ChatMessage[];
  hasMore: boolean;
  nextBefore: string | null;
};


const STREAM_EVENT_NAME = "vice-voice-visuals-updated";
const STREAM_SNAPSHOT_KEY = "__vice_voice_visuals_snapshot__";
const STREAM_ANNOUNCEMENT_EVENT_NAME = "vice-voice-stream-announcements-updated";
const STREAM_ANNOUNCEMENT_CLEAR_EVENT_NAME = "vice-voice-stream-announcements-cleared";
const STREAM_ANNOUNCEMENT_SNAPSHOT_KEY = "__vice_voice_stream_announcements__";
const REQUEST_VISUAL_RECONCILE_EVENT_NAME = "vice-request-voice-visual-reconcile";
const USER_IDENTITY_EVENT_NAME = "vice-user-identity-map-updated";

function getVoiceUserInitials(name: string) {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
}


function MessageAvatar({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl?: string | null;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        style={{
          width: 42,
          height: 42,
          borderRadius: 999,
          objectFit: "cover",
          flexShrink: 0,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "#1c212a",
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: 42,
        height: 42,
        borderRadius: 999,
        background: "linear-gradient(135deg, #5865f2, #7b8aff)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "white",
        fontWeight: 800,
        fontSize: 14,
        flexShrink: 0,
        boxShadow: "0 10px 24px rgba(88,101,242,0.22)",
      }}
    >
      {(name || "?").slice(0, 1).toUpperCase()}
    </div>
  );
}

function StreamTile({
  mediaStream,
  label,
  isLarge = false,
  fit = "cover",
  posterDataUrl = null,
  posterHoldMs = 1500,
  muted = true,
  volume = 1,
  onVolumeChange,
  showVolumeControls = false,
}: {
  mediaStream: MediaStream;
  label: string;
  isLarge?: boolean;
  fit?: "cover" | "contain";
  posterDataUrl?: string | null;
  posterHoldMs?: number;
  muted?: boolean;
  volume?: number;
  onVolumeChange?: (value: number) => void;
  showVolumeControls?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const revealTimerRef = useRef<number | null>(null);
  const lastTrackSignatureRef = useRef<string | null>(null);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isVolumeHovered, setIsVolumeHovered] = useState(false);

  useEffect(() => {
    const trackSignature = mediaStream
      .getVideoTracks()
      .map((track) => `${track.id}:${track.readyState}`)
      .join("|");
    const shouldResetReveal =
      lastTrackSignatureRef.current !== null &&
      lastTrackSignatureRef.current !== trackSignature;

    lastTrackSignatureRef.current = trackSignature;

    if (shouldResetReveal) {
      setIsVideoReady(false);
    }

    const video = videoRef.current;
    if (!video) return;

    if (video.srcObject !== mediaStream) {
      video.srcObject = mediaStream;
    }

    const reveal = () => {
      if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = window.setTimeout(
        () => setIsVideoReady(true),
        posterDataUrl ? posterHoldMs : 180
      );
    };

    const onLoadedData = () => {
      if (!posterDataUrl) setIsVideoReady(true);
    };

    const onPlaying = () => reveal();

    const play = async () => {
      try {
        await video.play();
      } catch {}
    };

    video.addEventListener("loadeddata", onLoadedData);
    video.addEventListener("playing", onPlaying);
    void play();

    return () => {
      if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current);
      video.removeEventListener("loadeddata", onLoadedData);
      video.removeEventListener("playing", onPlaying);
    };
  }, [mediaStream, posterDataUrl, posterHoldMs]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = muted;
    video.volume = muted ? 0 : Math.max(0, Math.min(1, volume));

    if (!muted) {
      const play = async () => {
        try {
          await video.play();
        } catch {}
      };
      void play();
    }
  }, [muted, volume]);

  useEffect(() => {
    return () => {
      const video = videoRef.current;
      if (!video) return;
      try {
        video.pause();
      } catch {}
      try {
        video.srcObject = null;
      } catch {}
    };
  }, []);

  const hasAudioTracks = mediaStream.getAudioTracks().length > 0;
  const shouldShowVolumeUi = showVolumeControls && hasAudioTracks;
  const safeVolume = muted ? 0 : Math.max(0, Math.min(1, volume));

  return (
    <div
      style={{
        borderRadius: 18,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.08)",
        background: "#0c1016",
        width: "100%",
        height: isLarge ? "100%" : "auto",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          width: "100%",
          height: isLarge ? "100%" : "auto",
          aspectRatio: isLarge ? undefined : "16 / 9",
          background: "#090c12",
          position: "relative",
          minHeight: 0,
          flex: isLarge ? 1 : undefined,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
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
            display: "block",
            objectFit: fit,
            background: "#090c12",
            opacity: isVideoReady ? 1 : 0,
            transition: "opacity 180ms ease",
          }}
        />

        {posterDataUrl && !isVideoReady ? (
          <img
            src={posterDataUrl}
            alt={`${label} preview`}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              display: "block",
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
              width: 54,
              height: 184,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              zIndex: 6,
            }}
          >
            <div
              style={{
                position: "absolute",
                right: 6,
                bottom: 48,
                width: 42,
                height: 128,
                borderRadius: 16,
                background: "rgba(13,16,22,0.88)",
                border: "1px solid rgba(255,255,255,0.12)",
                backdropFilter: "blur(12px)",
                boxShadow: "0 16px 34px rgba(0,0,0,0.28)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "10px 0",
                opacity: isVolumeHovered ? 1 : 0,
                transform: isVolumeHovered ? "translateY(0)" : "translateY(6px)",
                pointerEvents: isVolumeHovered ? "auto" : "none",
                transition: "opacity 140ms ease, transform 140ms ease",
              }}
            >
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(safeVolume * 100)}
                onChange={(event) =>
                  onVolumeChange?.(Number(event.target.value) / 100)
                }
                style={{
                  height: 96,
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
                width: 34,
                height: 34,
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
                flexShrink: 0,
              }}
              title={muted || volume <= 0 ? "Sesi aç" : "Sesi kapat"}
            >
              {muted || volume <= 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
          </div>
        ) : null}

        {isLarge ? (
          <div
            style={{
              position: "absolute",
              left: 14,
              right: shouldShowVolumeUi ? 58 : 14,
              bottom: 14,
              padding: "10px 12px",
              borderRadius: 12,
              background:
                "linear-gradient(180deg, rgba(6,8,12,0.08) 0%, rgba(6,8,12,0.78) 100%)",
              color: "#dbe3ee",
              fontSize: 12,
              fontWeight: 800,
              pointerEvents: "none",
              textAlign: "left",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {label}
          </div>
        ) : null}
      </div>

      {!isLarge ? (
        <div
          style={{
            padding: "10px 12px",
            fontSize: 12,
            color: "#dbe3ee",
            fontWeight: 700,
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
}


function formatMessageTime(value?: string | null) {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

function isSameCalendarDay(first?: string | null, second?: string | null) {
  if (!first || !second) return false;
  const firstDate = new Date(first);
  const secondDate = new Date(second);
  if (Number.isNaN(firstDate.getTime()) || Number.isNaN(secondDate.getTime())) {
    return false;
  }

  return (
    firstDate.getFullYear() === secondDate.getFullYear() &&
    firstDate.getMonth() === secondDate.getMonth() &&
    firstDate.getDate() === secondDate.getDate()
  );
}

function formatDaySeparatorLabel(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function resolveAssetUrl(value?: string | null) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  if (/^https?:\/\//i.test(normalized)) return normalized;
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
  if (theme === "youtube") {
    return "linear-gradient(135deg, rgba(255,0,51,0.22), rgba(255,255,255,0.04))";
  }
  if (theme === "kick" || theme === "twitch" || theme === "vimeo") {
    return "linear-gradient(135deg, rgba(88,101,242,0.22), rgba(255,255,255,0.04))";
  }
  if (theme === "twitter" || theme === "x") {
    return "linear-gradient(135deg, rgba(29,155,240,0.22), rgba(255,255,255,0.04))";
  }
  return "linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))";
}

function ensureTwitterWidgetsScript() {
  const existingTwttr = (window as any).twttr;
  if (existingTwttr?.widgets?.createTweet) {
    return Promise.resolve(existingTwttr);
  }

  return new Promise<any>((resolve, reject) => {
    const existingScript = document.querySelector('script[data-vice-twitter-widgets="true"]') as HTMLScriptElement | null;

    const waitForWidgets = (attempt = 0) => {
      const twttr = (window as any).twttr;
      if (twttr?.widgets?.createTweet) {
        resolve(twttr);
        return;
      }
      if (attempt >= 80) {
        reject(new Error("TWITTER_WIDGETS_LOAD_FAILED"));
        return;
      }
      window.setTimeout(() => waitForWidgets(attempt + 1), 100);
    };

    if (existingScript) {
      waitForWidgets();
      return;
    }

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

        return twttr.widgets.createTweet(tweetId, container, {
          theme: "dark",
          dnt: true,
          align: "center",
          conversation: "none",
        });
      })
      .then((result: unknown) => {
        if (cancelled) return;
        if (!result) {
          setLoadFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });

    return () => {
      cancelled = true;
      if (container) container.innerHTML = "";
    };
  }, [url]);

  if (loadFailed) {
    return (
      <div
        style={{
          width: "100%",
          minHeight: 220,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0c1016",
          color: "#dbe3ee",
          padding: 18,
          textAlign: "center",
          lineHeight: 1.5,
        }}
      >
        X gönderisi uygulama içinde yüklenemedi.
      </div>
    );
  }

  return (
    <div
      style={{
        width: "100%",
        minHeight: 220,
        background: "#0c1016",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        overflow: "auto",
        padding: "10px 0",
      }}
    >
      <div ref={containerRef} style={{ width: "100%", maxWidth: 520 }} />
    </div>
  );
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
    fetch(`http://localhost:3001/link-preview?url=${encodeURIComponent(url)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok || !data) throw new Error(data?.error || "LINK_PREVIEW_FAILED");
        if (!cancelled) {
          setPreview({ ...buildFallbackLinkPreview(url), ...data, url });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreview(buildFallbackLinkPreview(url));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [url]);

  const accent = getPreviewAccent(preview.theme);
  const isTweetPreview = preview.embedKind === "tweet" && Boolean(preview.embedUrl);
  const canInlinePlay = Boolean(
    preview.canInlinePlay &&
      preview.embedUrl &&
      preview.embedKind &&
      preview.embedKind !== "tweet"
  );

  return (
    <div
      style={{
        display: "block",
        marginTop: 8,
        borderRadius: 16,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.08)",
        background: accent,
        boxShadow: "0 10px 26px rgba(0,0,0,0.16)",
        maxWidth: 520,
      }}
    >
      <div style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ color: "#aeb8c8", fontSize: 11, fontWeight: 800 }}>
          {preview.siteName || "Bağlantı"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {canInlinePlay ? (
            <button
              type="button"
              onClick={() => setIsInlinePlaying((prev) => !prev)}
              style={{
                height: 26,
                padding: "0 10px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.1)",
                background: isInlinePlaying ? "rgba(255,255,255,0.12)" : "rgba(88,101,242,0.18)",
                color: "#fff",
                fontSize: 11,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {isInlinePlaying ? "Kapat" : "Oynat"}
            </button>
          ) : null}
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            style={{
              width: 28,
              height: 28,
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.1)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#aeb8c8",
              background: "rgba(255,255,255,0.04)",
            }}
            title="Bağlantıyı aç"
          >
            <ExternalLink size={14} color="#aeb8c8" />
          </a>
        </div>
      </div>

      {isTweetPreview ? (
        <TweetEmbed url={preview.embedUrl!} />
      ) : isInlinePlaying && preview.embedUrl && preview.embedKind ? (
        <div style={{ width: "100%", aspectRatio: "16 / 9", background: "#000" }}>
          {preview.embedKind === "video" ? (
            <video
              src={preview.embedUrl}
              controls
              autoPlay
              playsInline
              preload="metadata"
              style={{ width: "100%", height: "100%", border: 0, display: "block", background: "#000" }}
            />
          ) : (
            <iframe
              src={preview.embedUrl}
              title={preview.title || "Video"}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
              style={{ width: "100%", height: "100%", border: 0, display: "block" }}
            />
          )}
        </div>
      ) : preview.imageUrl ? (
        <button
          type="button"
          onClick={() => {
            if (canInlinePlay) {
              setIsInlinePlaying(true);
              return;
            }
            window.open(url, "_blank", "noopener,noreferrer");
          }}
          style={{
            width: "100%",
            padding: 0,
            border: 0,
            display: "block",
            background: "#0c1016",
            cursor: canInlinePlay ? "pointer" : "alias",
            position: "relative",
          }}
        >
          <img
            src={preview.imageUrl}
            alt={preview.title || url}
            style={{ width: "100%", display: "block", maxHeight: 240, objectFit: "cover", background: "#0c1016" }}
          />
          {canInlinePlay ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.34) 100%)",
              }}
            >
              <div
                style={{
                  height: 54,
                  padding: "0 18px",
                  borderRadius: 999,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  background: "rgba(11,14,18,0.84)",
                  border: "1px solid rgba(255,255,255,0.14)",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 900,
                  boxShadow: "0 14px 30px rgba(0,0,0,0.3)",
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    background: "#5865f2",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      width: 0,
                      height: 0,
                      borderTop: "7px solid transparent",
                      borderBottom: "7px solid transparent",
                      borderLeft: "11px solid white",
                      marginLeft: 3,
                    }}
                  />
                </div>
                Uygulama içinde oynat
              </div>
            </div>
          ) : null}
        </button>
      ) : (
        <div style={{ width: "100%", height: isTweetPreview ? 220 : 140, background: "linear-gradient(135deg, rgba(15,18,23,0.9), rgba(35,40,51,0.85))", display: "flex", alignItems: "center", justifyContent: "center", color: "#ffffff", fontWeight: 900, fontSize: 18 }}>
          {loading ? "Yükleniyor..." : canInlinePlay ? "Uygulama içinde açılabilir" : (preview.siteName || "Bağlantı")}
        </div>
      )}

      <div style={{ padding: 12 }}>
        <div style={{ color: "#ffffff", fontSize: 15, fontWeight: 900, marginBottom: 5, lineHeight: 1.35 }}>
          {preview.title || url}
        </div>
        <div style={{ color: "#aeb8c8", fontSize: 12, lineHeight: 1.45, marginBottom: 8 }}>
          {isTweetPreview
            ? "Gönderi önizlemesi burada gösteriliyor"
            : canInlinePlay
              ? isInlinePlaying
                ? "Video uygulama içinde oynatılıyor"
                : "Videoyu burada oynatabilirsin"
              : (preview.description || "Bağlantıyı aç")}
        </div>
        <div style={{ color: "#7f8794", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{url}</div>
      </div>
    </div>
  );
}

function PendingAttachmentCard({
  item,
  onRemove,
}: {
  item: PendingAttachment;
  onRemove: (id: string) => void;
}) {
  return (
    <div style={{ borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", overflow: "hidden", position: "relative", minWidth: 0 }}>
      <button
        onClick={() => onRemove(item.id)}
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          width: 24,
          height: 24,
          borderRadius: 999,
          border: "1px solid rgba(255,255,255,0.1)",
          background: "rgba(11,14,18,0.82)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          zIndex: 2,
        }}
        title="Kaldır"
      >
        <X size={12} />
      </button>

      {item.kind === "image" && item.previewUrl ? (
        <img src={item.previewUrl} alt={item.file.name} style={{ width: "100%", height: 84, objectFit: "cover", display: "block", background: "#0f1217" }} />
      ) : item.kind === "video" && item.previewUrl ? (
        <video src={item.previewUrl} muted playsInline style={{ width: "100%", height: 84, objectFit: "cover", display: "block", background: "#0f1217" }} />
      ) : (
        <div style={{ width: "100%", height: 84, display: "flex", alignItems: "center", justifyContent: "center", background: "#0f1217", color: "#dbe3ee" }}>
          {item.kind === "video" ? <Video size={18} /> : <FileText size={18} />}
        </div>
      )}

      <div style={{ padding: "8px 9px" }}>
        <div style={{ color: "#e6ebf2", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.file.name}</div>
        <div style={{ color: "#8f98a6", fontSize: 10, marginTop: 2 }}>{formatFileSize(item.file.size)}</div>
      </div>
    </div>
  );
}

function MessageAttachments({
  attachments,
  onOpenImage,
}: {
  attachments: ChatAttachment[];
  onOpenImage: (src: string, title?: string) => void;
}) {
  if (!attachments.length) return null;

  const images = attachments.filter((item) => item.kind === "image");
  const videos = attachments.filter((item) => item.kind === "video");
  const files = attachments.filter((item) => item.kind === "file");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
      {images.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: images.length === 1 ? "minmax(0, 340px)" : "repeat(auto-fit, minmax(132px, 1fr))", gap: 8, maxWidth: 460 }}>
          {images.map((item) => {
            const resolvedUrl = resolveAssetUrl(item.url);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenImage(resolvedUrl, item.originalName)}
                style={{ borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", display: "block", background: "#0f1217", padding: 0, cursor: "zoom-in" }}
                title={item.originalName}
              >
                <img src={resolvedUrl} alt={item.originalName} style={{ width: "100%", display: "block", objectFit: "cover", maxHeight: images.length === 1 ? 260 : 180 }} />
              </button>
            );
          })}
        </div>
      ) : null}

      {videos.map((item) => (
        <div key={item.id} style={{ maxWidth: 520, borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", background: "#0f1217" }}>
          <video controls preload="metadata" src={resolveAssetUrl(item.url)} style={{ width: "100%", maxHeight: 320, display: "block", background: "#000" }} />
          <div style={{ padding: "8px 10px", color: "#dbe3ee", fontSize: 11, fontWeight: 700 }}>
            {item.originalName}{item.sizeBytes ? ` • ${formatFileSize(item.sizeBytes)}` : ""}
          </div>
        </div>
      ))}

      {files.map((item) => (
        <a
          key={item.id}
          href={resolveAssetUrl(item.url)}
          target="_blank"
          rel="noreferrer"
          style={{
            textDecoration: "none",
            maxWidth: 440,
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)",
            padding: "10px 12px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ width: 38, height: 38, borderRadius: 11, background: "rgba(88,101,242,0.16)", display: "flex", alignItems: "center", justifyContent: "center", color: "#dce7ff", flexShrink: 0 }}>
            <FileText size={16} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ color: "#ffffff", fontSize: 12, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.originalName}</div>
            <div style={{ color: "#8f98a6", fontSize: 11, marginTop: 2 }}>
              {[item.mimeType || "Dosya", item.sizeBytes ? formatFileSize(item.sizeBytes) : ""].filter(Boolean).join(" • ")}
            </div>
          </div>
          <ExternalLink size={15} color="#aeb8c8" />
        </a>
      ))}
    </div>
  );
}

function highlightMentions(text: string) {
  const parts = text.split(/(@[a-zA-Z0-9_.-]+)/g);
  return parts.map((part, index) => {
    if (/^@[a-zA-Z0-9_.-]+$/.test(part)) {
      return (
        <span
          key={`${part}-${index}`}
          style={{
            color: "#dce7ff",
            background: "rgba(88,101,242,0.18)",
            border: "1px solid rgba(88,101,242,0.22)",
            borderRadius: 8,
            padding: "1px 6px",
            fontWeight: 700,
          }}
        >
          {part}
        </span>
      );
    }
    return <span key={`${part}-${index}`}>{part}</span>;
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
    lineHeight: emojiOnly ? 1.25 : 1.62,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    width: "100%",
    letterSpacing: emojiOnly ? 0.2 : 0,
  };
}

function MediaPreviewCard({
  item,
  visual,
  accent = "blue",
}: {
  item: StreamAnnouncement;
  visual?: VoiceVisualEntry | null;
  accent?: "blue" | "red";
}) {
  const initials = getVoiceUserInitials(item.participantName);
  const accentBg = accent === "red" ? "#ed4245" : "#5865f2";

  return (
    <div style={{ borderRadius: 22, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", boxShadow: "0 14px 34px rgba(0,0,0,0.2)" }}>
      <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#0b0f14", overflow: "hidden" }}>
        {visual ? (
          <StreamTile mediaStream={visual.mediaStream} label={`${item.participantName} • ${item.source === "screen" ? "Ekran paylaşımı" : "Kamera"}`} fit={item.source === "screen" ? "cover" : "contain"} posterDataUrl={item.previewDataUrl ?? null} />
        ) : item.previewDataUrl ? (
          <img src={item.previewDataUrl} alt={`${item.participantName} preview`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", filter: "brightness(0.9)" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg, #11161d 0%, #0c1016 100%)" }}>
            <div style={{ width: 72, height: 72, borderRadius: 24, background: "linear-gradient(135deg, #5865f2, #7b8aff)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, fontSize: 28, boxShadow: "0 16px 34px rgba(88,101,242,0.28)" }}>
              {initials}
            </div>
          </div>
        )}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.15) 45%, rgba(0,0,0,0.82) 100%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: 12, left: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", pointerEvents: "none" }}>
          <span style={{ height: 24, padding: "0 9px", borderRadius: 999, display: "inline-flex", alignItems: "center", background: accentBg, color: "#fff", fontSize: 10, fontWeight: 900, letterSpacing: 0.35 }}>
            {item.source === "screen" ? "LIVE" : "CAM"}
          </span>
        </div>
        <div style={{ position: "absolute", left: 14, right: 14, bottom: 14, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, pointerEvents: "none" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "#ffffff", fontSize: 16, fontWeight: 900, marginBottom: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.participantName}</div>
            <div style={{ color: "rgba(255,255,255,0.72)", fontSize: 12, fontWeight: 700 }}>{item.source === "screen" ? "Ekran paylaşımı" : "Kamera"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MediaLightbox({
  state,
  onClose,
}: {
  state: MediaLightboxState | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!state) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown as any);
    return () => window.removeEventListener("keydown", onKeyDown as any);
  }, [state, onClose]);

  if (!state) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(5, 7, 11, 0.86)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        boxSizing: "border-box",
      }}
    >
      <button
        type="button"
        onClick={onClose}
        style={{
          position: "absolute",
          top: 18,
          right: 18,
          width: 42,
          height: 42,
          borderRadius: 999,
          border: "1px solid rgba(255,255,255,0.14)",
          background: "rgba(15,18,24,0.82)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
        title="Kapat"
      >
        <X size={18} />
      </button>

      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          maxWidth: "min(92vw, 1200px)",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
        }}
      >
        <img
          src={state.src}
          alt={state.title || "Görsel"}
          style={{
            maxWidth: "100%",
            maxHeight: "calc(88vh - 44px)",
            borderRadius: 18,
            display: "block",
            objectFit: "contain",
            boxShadow: "0 22px 60px rgba(0,0,0,0.42)",
          }}
        />
        {state.title ? (
          <div style={{ color: "#dbe3ee", fontSize: 13, fontWeight: 700, textAlign: "center", maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {state.title}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function ChatArea({ selectedChannel, voicePresenceMap, activeVoiceChannelId }: ChatAreaProps) {
  const isVoice = selectedChannel.type === "voice";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const [voiceVisuals, setVoiceVisuals] = useState<VoiceVisualEntry[]>([]);
  const [streamAnnouncements, setStreamAnnouncements] = useState<StreamAnnouncement[]>([]);
  const [focusedVisualTrackSid, setFocusedVisualTrackSid] = useState<string | null>(null);
  const [joinedAnnouncementTrackSid, setJoinedAnnouncementTrackSid] = useState<string | null>(null);
  const [joinedAnnouncementKey, setJoinedAnnouncementKey] = useState<string | null>(null);
  const [localScreenShareActive, setLocalScreenShareActive] = useState(false);
  const [streamVolumes, setStreamVolumes] = useState<Record<string, number>>({});
  const [identityMap, setIdentityMap] = useState<IdentityMap>({});
  const [videoLockTrackSid, setVideoLockTrackSid] = useState<string | null>(null);
  const [isJoinedStreamHovered, setIsJoinedStreamHovered] = useState(false);

  const [searchText, setSearchText] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showPinnedPanel, setShowPinnedPanel] = useState(false);
  const [draftState, setDraftState] = useState<DraftActionState>({ editingMessageId: null, editText: "", replyToMessageId: null });
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isDraggingComposerFiles, setIsDraggingComposerFiles] = useState(false);
  const [mediaLightbox, setMediaLightbox] = useState<MediaLightboxState | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesContentRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerDragDepthRef = useRef(0);
  const firstLoadRef = useRef(true);
  const wsRef = useRef<WebSocket | null>(null);
  const staleReconcileTimerRef = useRef<number | null>(null);
  const orphanFirstSeenAtRef = useRef<Record<string, number>>({});
  const previousLiveVisualKeysRef = useRef<Set<string>>(new Set());
  const voiceVisualsRef = useRef<VoiceVisualEntry[]>([]);
  const streamAnnouncementsRef = useRef<StreamAnnouncement[]>([]);
  const lastReconcileRequestRef = useRef<{ signature: string; at: number }>({ signature: "", at: 0 });
  const identityMapRef = useRef<IdentityMap>({});
  const loadingMoreMessagesRef = useRef(false);
  const hasMoreMessagesRef = useRef(true);
  const oldestMessageCursorRef = useRef<string | null>(null);
  const initialAutoScrollLockRef = useRef(false);
  const initialAutoScrollTimerRef = useRef<number | null>(null);
  const initialBottomSettlerRafRef = useRef<number | null>(null);
  const initialBottomSettlerUntilRef = useRef<number>(0);
  const hasCompletedInitialChannelMountRef = useRef(false);

  const watchedStreamMemoryRef = useRef<
    Record<
      string,
      {
        joinedAnnouncementKey: string | null;
        joinedAnnouncementTrackSid: string | null;
        focusedVisualTrackSid: string | null;
      }
    >
  >({});

  const token = useMemo(() => localStorage.getItem("token"), []);
  const localUserId = useMemo(() => {
    try {
      const raw = localStorage.getItem("auth_user");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.id ? String(parsed.id) : null;
    } catch {
      return null;
    }
  }, []);


  useEffect(() => {
    return () => {
      setPendingAttachments((prev) => {
        prev.forEach((item) => {
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        });
        return prev;
      });
    };
  }, []);

  useEffect(() => {
    setMediaLightbox(null);
  }, [selectedChannel.id]);
  const selectedStreamChannelKeys = useMemo(() => {
    const keys = [String(selectedChannel.id)];
    if (selectedChannel.serverId) {
      keys.push(`server:${selectedChannel.serverId}:channel:${selectedChannel.id}`);
    }
    return keys;
  }, [selectedChannel.id, selectedChannel.serverId]);

  const selectedStreamMemoryKey = useMemo(() => {
    return selectedChannel.serverId
      ? `server:${selectedChannel.serverId}:channel:${selectedChannel.id}`
      : String(selectedChannel.id);
  }, [selectedChannel.id, selectedChannel.serverId]);

  const currentVoiceMembers = useMemo(() => {
    const members = isVoice ? voicePresenceMap[selectedChannel.id] || [] : [];
    return [...members].sort((a, b) =>
      String(a.displayName || "").localeCompare(
        String(b.displayName || ""),
        "tr",
        { sensitivity: "base" }
      )
    );
  }, [isVoice, voicePresenceMap, selectedChannel.id]);

  useEffect(() => {
    composerDragDepthRef.current = 0;
    setIsDraggingComposerFiles(false);
  }, [selectedChannel.id]);

  const isInsideSelectedVoiceRoom = Boolean(
    isVoice && activeVoiceChannelId && String(activeVoiceChannelId) === String(selectedChannel.id)
  );

  const joinedUsersCount = currentVoiceMembers.length;


  const resizeTextarea = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  };

  useEffect(() => {
    identityMapRef.current = identityMap;
  }, [identityMap]);

  useEffect(() => {
    loadingMoreMessagesRef.current = loadingMoreMessages;
  }, [loadingMoreMessages]);

  useEffect(() => {
    hasMoreMessagesRef.current = hasMoreMessages;
  }, [hasMoreMessages]);

  const patchMessageWithIdentity = (message: ChatMessage, map: IdentityMap): ChatMessage => {
    const patch = map[message.userId];
    const replyPatch = message.replyTo ? map[message.replyTo.userId] : null;
    return {
      ...message,
      displayName: patch?.displayName || message.displayName,
      username: patch?.username || message.username,
      avatarUrl: patch?.avatarUrl !== undefined ? patch.avatarUrl : message.avatarUrl ?? null,
      highestRoleColor:
        patch?.highestRoleColor !== undefined
          ? patch.highestRoleColor
          : message.highestRoleColor ?? "#ffffff",
      replyTo: message.replyTo
        ? {
            ...message.replyTo,
            displayName: replyPatch?.displayName || message.replyTo.displayName,
            username: replyPatch?.username || message.replyTo.username,
          }
        : null,
    };
  };

  const enrichMessagesWithIdentity = (rows: ChatMessage[], map: IdentityMap) => rows.map((m) => patchMessageWithIdentity(m, map));

  const removeMessage = (messageId: string) => {
    setMessages((prev) => prev.filter((item) => item.id !== messageId));
  };

  const upsertMessage = (incoming: ChatMessage) => {
    setMessages((prev) => {
      const nextMessage = patchMessageWithIdentity(incoming, identityMapRef.current);
      if (nextMessage.deletedAt) {
        return prev.filter((item) => item.id !== nextMessage.id);
      }
      const index = prev.findIndex((item) => item.id === nextMessage.id);
      if (index === -1) {
        return [...prev, nextMessage].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      }
      const next = [...prev];
      next[index] = nextMessage;
      return next;
    });
  };

  const isLiveMediaStream = (value: unknown): value is MediaStream => {
    if (!(value instanceof MediaStream)) return false;
    return value.getVideoTracks().some((track) => track.readyState !== "ended");
  };

  const getAnnouncementKey = (item: { participantId: string; source: "camera" | "screen" }) => `${item.participantId}:${item.source}`;

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

  const persistWatchedStreamMemory = (
    channelKey: string,
    next: {
      joinedAnnouncementKey?: string | null;
      joinedAnnouncementTrackSid?: string | null;
      focusedVisualTrackSid?: string | null;
    }
  ) => {
    const prev = watchedStreamMemoryRef.current[channelKey] || {
      joinedAnnouncementKey: null,
      joinedAnnouncementTrackSid: null,
      focusedVisualTrackSid: null,
    };

    watchedStreamMemoryRef.current[channelKey] = {
      joinedAnnouncementKey:
        next.joinedAnnouncementKey !== undefined
          ? next.joinedAnnouncementKey
          : prev.joinedAnnouncementKey,
      joinedAnnouncementTrackSid:
        next.joinedAnnouncementTrackSid !== undefined
          ? next.joinedAnnouncementTrackSid
          : prev.joinedAnnouncementTrackSid,
      focusedVisualTrackSid:
        next.focusedVisualTrackSid !== undefined
          ? next.focusedVisualTrackSid
          : prev.focusedVisualTrackSid,
    };
  };

  const joinMediaAnnouncement = (item: StreamAnnouncement) => {
    const nextJoinKey = getAnnouncementKey(item);
    const fallbackVisual = voiceVisuals.find(
      (visual) => visual.trackSid === item.trackSid || getAnnouncementKey(visual) === nextJoinKey
    );
    const nextFocusedTrackSid = fallbackVisual?.trackSid || null;

    setJoinedAnnouncementTrackSid(item.trackSid);
    setJoinedAnnouncementKey(nextJoinKey);
    setFocusedVisualTrackSid(nextFocusedTrackSid);

    persistWatchedStreamMemory(selectedStreamMemoryKey, {
      joinedAnnouncementKey: nextJoinKey,
      joinedAnnouncementTrackSid: item.trackSid,
      focusedVisualTrackSid: nextFocusedTrackSid,
    });

    const dispatchReconcile = () =>
      window.dispatchEvent(
        new CustomEvent(REQUEST_VISUAL_RECONCILE_EVENT_NAME, {
          detail: { channelId: selectedChannel.id, trackSid: item.trackSid },
        })
      );

    dispatchReconcile();
    window.setTimeout(dispatchReconcile, 180);
    window.setTimeout(dispatchReconcile, 700);
    window.setTimeout(dispatchReconcile, 1400);
  };



  const cancelInitialBottomSettler = () => {
    if (initialBottomSettlerRafRef.current != null) {
      window.cancelAnimationFrame(initialBottomSettlerRafRef.current);
      initialBottomSettlerRafRef.current = null;
    }
  };

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior });
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
  };

  const startInitialBottomSettler = (durationMs = 3200) => {
    if (isVoice) return;

    cancelInitialBottomSettler();
    initialBottomSettlerUntilRef.current = Date.now() + durationMs;

    const tick = () => {
      const container = scrollContainerRef.current;
      if (!container) {
        initialBottomSettlerRafRef.current = null;
        return;
      }

      container.scrollTop = container.scrollHeight;
      updateJumpToLatestVisibility();

      if (Date.now() < initialBottomSettlerUntilRef.current && initialAutoScrollLockRef.current) {
        initialBottomSettlerRafRef.current = window.requestAnimationFrame(tick);
        return;
      }

      container.scrollTop = container.scrollHeight;
      initialBottomSettlerRafRef.current = null;
    };

    initialBottomSettlerRafRef.current = window.requestAnimationFrame(tick);
  };

  const updateJumpToLatestVisibility = () => {
    const container = scrollContainerRef.current;

    if (!container || isVoice) {
      setShowJumpToLatest(false);
      return;
    }

    const distanceFromBottom = Math.max(
      0,
      container.scrollHeight - container.scrollTop - container.clientHeight
    );

    setShowJumpToLatest(distanceFromBottom >= 10000);
  };

  const parseMessagesPage = (data: any): MessagesPageResponse => {
    if (Array.isArray(data)) {
      const rows = data.filter((item) => !item?.deletedAt);
      return {
        messages: rows,
        hasMore: rows.length >= 50,
        nextBefore: rows[0]?.createdAt ?? null,
      };
    }

    const rows = Array.isArray(data?.messages)
      ? data.messages.filter((item: any) => !item?.deletedAt)
      : [];

    return {
      messages: rows,
      hasMore: Boolean(data?.hasMore),
      nextBefore: data?.nextBefore ? String(data.nextBefore) : (rows[0]?.createdAt ?? null),
    };
  };

  const fetchMessages = async (channelId: string) => {
    if (!token) return;
    setLoading(true);
    oldestMessageCursorRef.current = null;
    setHasMoreMessages(true);

    try {
      setError("");
      const res = await fetch(`http://localhost:3001/channels/${channelId}/messages?limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Mesajlar alınamadı.");
        return;
      }

      const page = parseMessagesPage(data);
      const safeRows = enrichMessagesWithIdentity(page.messages, identityMapRef.current);
      setMessages(safeRows);
      setHasMoreMessages(page.hasMore);
      oldestMessageCursorRef.current = page.nextBefore;
    } catch (err) {
      console.error("chat fetch error:", err);
      setError("Mesajlar yüklenirken bağlantı hatası oluştu.");
    } finally {
      setLoading(false);
    }
  };

  const loadOlderMessages = async () => {
    if (!token || isVoice) return;
    if (loadingMoreMessagesRef.current || !hasMoreMessagesRef.current) return;
    const before = oldestMessageCursorRef.current;
    if (!before) {
      setHasMoreMessages(false);
      return;
    }

    const container = scrollContainerRef.current;
    const previousScrollHeight = container?.scrollHeight ?? 0;
    const previousScrollTop = container?.scrollTop ?? 0;

    setLoadingMoreMessages(true);

    try {
      const res = await fetch(
        `http://localhost:3001/channels/${selectedChannel.id}/messages?limit=50&before=${encodeURIComponent(before)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(data?.error || "Eski mesajlar alınamadı.");
        return;
      }

      const page = parseMessagesPage(data);
      const olderRows = enrichMessagesWithIdentity(page.messages, identityMapRef.current);

      if (olderRows.length === 0) {
        setHasMoreMessages(false);
        oldestMessageCursorRef.current = null;
        return;
      }

      oldestMessageCursorRef.current = page.nextBefore;
      setHasMoreMessages(page.hasMore);

      setMessages((prev) => {
        const existingIds = new Set(prev.map((item) => item.id));
        const uniqueOlder = olderRows.filter((item) => !existingIds.has(item.id));
        return [...uniqueOlder, ...prev];
      });

      requestAnimationFrame(() => {
        const nextContainer = scrollContainerRef.current;
        if (!nextContainer) return;
        const newScrollHeight = nextContainer.scrollHeight;
        nextContainer.scrollTop = previousScrollTop + (newScrollHeight - previousScrollHeight);
      });
    } catch (err) {
      console.error("chat load older error:", err);
      setError("Eski mesajlar yüklenirken bağlantı hatası oluştu.");
    } finally {
      setLoadingMoreMessages(false);
    }
  };


  useEffect(() => {
    const isInitialChannelMount = !hasCompletedInitialChannelMountRef.current;

    firstLoadRef.current = isInitialChannelMount;
    shouldStickToBottomRef.current = true;
    cancelInitialBottomSettler();

    if (initialAutoScrollTimerRef.current) {
      window.clearTimeout(initialAutoScrollTimerRef.current);
      initialAutoScrollTimerRef.current = null;
    }

    if (isInitialChannelMount) {
      initialAutoScrollLockRef.current = true;
      initialAutoScrollTimerRef.current = window.setTimeout(() => {
        initialAutoScrollLockRef.current = false;
        initialAutoScrollTimerRef.current = null;
        cancelInitialBottomSettler();
      }, 3200);
      hasCompletedInitialChannelMountRef.current = true;
    } else {
      initialAutoScrollLockRef.current = false;
    }

    setShowJumpToLatest(false);
    setHasMoreMessages(true);
    setLoadingMoreMessages(false);
    oldestMessageCursorRef.current = null;
  }, [selectedChannel.id]);

  useEffect(() => {
    return () => {
      if (initialAutoScrollTimerRef.current) {
        window.clearTimeout(initialAutoScrollTimerRef.current);
      }
      cancelInitialBottomSettler();
    };
  }, []);

  useEffect(() => {
    if (isVoice) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = (allowLoadMore = true) => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      shouldStickToBottomRef.current = distanceFromBottom <= 96;

      if (!shouldStickToBottomRef.current && initialAutoScrollLockRef.current) {
        initialAutoScrollLockRef.current = false;
        if (initialAutoScrollTimerRef.current) {
          window.clearTimeout(initialAutoScrollTimerRef.current);
          initialAutoScrollTimerRef.current = null;
        }
      }

      updateJumpToLatestVisibility();

      if (
        allowLoadMore &&
        !initialAutoScrollLockRef.current &&
        container.scrollTop <= 120
      ) {
        void loadOlderMessages();
      }
    };

    const syncJumpButtonOnly = () => {
      updateJumpToLatestVisibility();
    };

    requestAnimationFrame(syncJumpButtonOnly);
    const mountTimer = window.setTimeout(syncJumpButtonOnly, 60);

    const onScroll = () => handleScroll(true);
    container.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.clearTimeout(mountTimer);
      container.removeEventListener("scroll", onScroll);
    };
  }, [isVoice, selectedChannel.id]);

  useEffect(() => {
    if (isVoice) return;

    const contentEl = messagesContentRef.current;
    if (!contentEl || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (shouldStickToBottomRef.current || initialAutoScrollLockRef.current) {
        scrollToBottom("auto");
      }
      updateJumpToLatestVisibility();
    });

    observer.observe(contentEl);
    return () => observer.disconnect();
  }, [isVoice, selectedChannel.id]);

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
          previewUrl: kind === "image" || kind === "video" ? URL.createObjectURL(file) : null,
        } satisfies PendingAttachment;
      });

      if (nextItems.length < incoming.length) {
        setError("En fazla 10 dosya ekleyebilirsin.");
      }

      return [...prev, ...nextItems];
    });
  };

  const removePendingAttachment = (id: string) => {
    setPendingAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  };

  const handlePickFiles = (event: any) => {
    if (event.target.files?.length) {
      appendPendingFiles(event.target.files);
    }
    event.target.value = "";
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleComposerDragEnter = (event: DragEvent<HTMLDivElement>) => {
    const hasFiles =
      Array.from(event.dataTransfer?.items || []).some((item) => item.kind === "file") ||
      (event.dataTransfer?.files?.length ?? 0) > 0;

    if (!hasFiles) return;
    event.preventDefault();
    event.stopPropagation();
    composerDragDepthRef.current += 1;
    setIsDraggingComposerFiles(true);
  };

  const handleComposerDragOver = (event: DragEvent<HTMLDivElement>) => {
    const hasFiles =
      Array.from(event.dataTransfer?.items || []).some((item) => item.kind === "file") ||
      (event.dataTransfer?.files?.length ?? 0) > 0;

    if (!hasFiles) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    if (!isDraggingComposerFiles) {
      setIsDraggingComposerFiles(true);
    }
  };

  const handleComposerDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    composerDragDepthRef.current = Math.max(0, composerDragDepthRef.current - 1);
    if (composerDragDepthRef.current === 0) {
      setIsDraggingComposerFiles(false);
    }
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

  const sendMessage = async () => {
    const trimmed = messageText.trim();
    if ((!trimmed && pendingAttachments.length === 0) || !token || isVoice) return;
    try {
      setSending(true);
      setError("");

      const hasFiles = pendingAttachments.length > 0;
      const res = await fetch(`http://localhost:3001/channels/${selectedChannel.id}/messages`, {
        method: "POST",
        headers: hasFiles ? { Authorization: `Bearer ${token}` } : { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: hasFiles
          ? (() => {
              const form = new FormData();
              if (trimmed) form.append("content", trimmed);
              if (draftState.replyToMessageId) form.append("replyToMessageId", draftState.replyToMessageId);
              pendingAttachments.forEach((item) => form.append("files", item.file));
              return form;
            })()
          : JSON.stringify({ content: trimmed, replyToMessageId: draftState.replyToMessageId || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Mesaj gönderilemedi.");
        return;
      }
      if (data) {
        upsertMessage(data);
      }
      shouldStickToBottomRef.current = true;
      setMessageText("");
      setDraftState((prev) => ({ ...prev, replyToMessageId: null }));
      setShowEmojiPicker(false);
      composerDragDepthRef.current = 0;
      setIsDraggingComposerFiles(false);
      setPendingAttachments((prev) => {
        prev.forEach((item) => {
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        });
        return [];
      });
      requestAnimationFrame(() => {
        resizeTextarea();
        scrollToBottom("auto");
      });
      window.setTimeout(() => scrollToBottom("smooth"), 40);
    } catch (err) {
      console.error("chat send error:", err);
      setError("Mesaj gönderilirken bağlantı hatası oluştu.");
    } finally {
      setSending(false);
    }
  };

  const copyMessage = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch (err) {
      console.error("copy failed", err);
    }
  };

  const startEditMessage = (message: ChatMessage) => {
    if (message.deletedAt) return;
    setDraftState((prev) => ({ ...prev, editingMessageId: message.id, editText: message.content }));
  };

  const cancelEditMessage = () => setDraftState((prev) => ({ ...prev, editingMessageId: null, editText: "" }));

  const saveEditMessage = async (messageId: string) => {
    const nextContent = draftState.editText.trim();
    if (!nextContent || !token) return;
    try {
      setError("");
      const res = await fetch(`http://localhost:3001/channels/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: nextContent }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Mesaj düzenlenemedi.");
        return;
      }
      upsertMessage(data);
      setDraftState((prev) => ({ ...prev, editingMessageId: null, editText: "" }));
    } catch (err) {
      console.error("edit failed", err);
      setError("Mesaj düzenlenirken bağlantı hatası oluştu.");
    }
  };

  const deleteMessage = async (messageId: string) => {
    if (!token) return;
    try {
      setError("");
      const res = await fetch(`http://localhost:3001/channels/messages/${messageId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Mesaj silinemedi.");
        return;
      }
      if (data?.payload?.id) removeMessage(data.payload.id);
      else removeMessage(messageId);
    } catch (err) {
      console.error("delete failed", err);
      setError("Mesaj silinirken bağlantı hatası oluştu.");
    }
  };

  const togglePinMessage = async (message: ChatMessage) => {
    if (!token || message.deletedAt) return;
    const method = message.isPinned ? "DELETE" : "POST";
    try {
      setError("");
      const res = await fetch(`http://localhost:3001/channels/messages/${message.id}/pin`, {
        method,
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || (message.isPinned ? "Pin kaldırılamadı." : "Mesaj pinlenemedi."));
        return;
      }
      if (data?.payload) upsertMessage(data.payload);
      else if (data?.id) upsertMessage(data);
    } catch (err) {
      console.error("pin toggle failed", err);
      setError("Pin işlemi sırasında bağlantı hatası oluştu.");
    }
  };

  const startReplyToMessage = (messageId: string) => {
    setDraftState((prev) => ({ ...prev, replyToMessageId: messageId }));
    textareaRef.current?.focus();
  };

  const insertEmoji = (emoji: string) => {
    setMessageText((prev) => `${prev}${emoji}`);
    setShowEmojiPicker(false);
    requestAnimationFrame(() => resizeTextarea());
    textareaRef.current?.focus();
  };

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    insertEmoji(emojiData.emoji);
  };

  useEffect(() => {
    resizeTextarea();
  }, [messageText, pendingAttachments.length]);

  useEffect(() => {
    voiceVisualsRef.current = voiceVisuals;
  }, [voiceVisuals]);

  useEffect(() => {
    streamAnnouncementsRef.current = streamAnnouncements;
  }, [streamAnnouncements]);

  useEffect(() => {
    if (!focusedVisualTrackSid) {
      setVideoLockTrackSid(null);
      return;
    }
    setVideoLockTrackSid(focusedVisualTrackSid);
    const timeoutId = window.setTimeout(() => {
      setVideoLockTrackSid((current) => (current === focusedVisualTrackSid ? null : current));
    }, 1200);
    return () => window.clearTimeout(timeoutId);
  }, [focusedVisualTrackSid]);

  useEffect(() => {
    if (!joinedAnnouncementTrackSid) return;
    const directAnnouncement = streamAnnouncements.find((item) => item.trackSid === joinedAnnouncementTrackSid);
    if (directAnnouncement) {
      const nextKey = getAnnouncementKey(directAnnouncement);
      if (nextKey !== joinedAnnouncementKey) setJoinedAnnouncementKey(nextKey);
      return;
    }
    const directVisual = voiceVisuals.find((item) => item.trackSid === joinedAnnouncementTrackSid);
    if (directVisual) {
      const nextKey = getAnnouncementKey(directVisual);
      if (nextKey !== joinedAnnouncementKey) setJoinedAnnouncementKey(nextKey);
    }
  }, [joinedAnnouncementTrackSid, joinedAnnouncementKey, streamAnnouncements, voiceVisuals]);

  useEffect(() => {
    const resetScopedVisualState = () => {
      voiceVisualsRef.current = [];
      streamAnnouncementsRef.current = [];
      setVoiceVisuals([]);
      setStreamAnnouncements([]);
      setLocalScreenShareActive(false);
      setFocusedVisualTrackSid(null);
    };

    const identityHandler = (event: Event) => {
      const customEvent = event as CustomEvent<{ map?: IdentityMap }>;
      const nextMap = customEvent.detail?.map || {};
      identityMapRef.current = nextMap;
      setIdentityMap(nextMap);
      setMessages((prev) => enrichMessagesWithIdentity(prev, nextMap));
    };

    window.addEventListener(USER_IDENTITY_EVENT_NAME, identityHandler as EventListener);

    resetScopedVisualState();

    const remembered = watchedStreamMemoryRef.current[selectedStreamMemoryKey];
    if (remembered) {
      setJoinedAnnouncementKey(remembered.joinedAnnouncementKey || null);
      setJoinedAnnouncementTrackSid(remembered.joinedAnnouncementTrackSid || null);
      setFocusedVisualTrackSid(remembered.focusedVisualTrackSid || null);
    } else {
      setJoinedAnnouncementKey(null);
      setJoinedAnnouncementTrackSid(null);
      setFocusedVisualTrackSid(null);
    }

    const applyVisualDetail = (detail?: { channelId: string | null; visuals: VoiceVisualEntry[]; localScreenShareActive: boolean }) => {
      if (!detail || !selectedStreamChannelKeys.includes(String(detail.channelId ?? ""))) return;
      const safeVisuals = Array.isArray(detail.visuals)
        ? detail.visuals.filter((item) => item && item.trackSid && item.mediaStream && isLiveMediaStream(item.mediaStream))
        : [];
      voiceVisualsRef.current = safeVisuals;
      setVoiceVisuals(safeVisuals);
      setLocalScreenShareActive(Boolean(detail.localScreenShareActive));
      setFocusedVisualTrackSid((prev) => (prev && safeVisuals.some((item) => item.trackSid === prev) ? prev : null));
    };

    const applyAnnouncementDetail = (detail?: {
      channelId: string | null;
      announcements?: StreamAnnouncement[];
      userId?: string | null;
      participantId?: string | null;
      trackSid?: string | null;
      source?: "camera" | "screen" | null;
    }) => {
      if (!detail || !selectedStreamChannelKeys.includes(String(detail.channelId ?? ""))) return;

      const incomingAnnouncements = Array.isArray(detail.announcements)
        ? detail.announcements.filter(
            (item) =>
              item &&
              item.trackSid &&
              item.participantId &&
              (item.source === "screen" || item.source === "camera")
          )
        : [];

      const dedupedAnnouncements = Array.from(
        new Map(
          incomingAnnouncements.map((item) => [getAnnouncementKey(item), item])
        ).values()
      );

      streamAnnouncementsRef.current = dedupedAnnouncements;
      setStreamAnnouncements(dedupedAnnouncements);

      setJoinedAnnouncementTrackSid((prev) => {
        if (!prev && !joinedAnnouncementKey) return prev;

        const visualByKey = joinedAnnouncementKey
          ? voiceVisualsRef.current.find(
              (item) => getAnnouncementKey(item) === joinedAnnouncementKey
            ) || null
          : null;
        if (visualByKey) return visualByKey.trackSid;

        const announcementByKey = joinedAnnouncementKey
          ? dedupedAnnouncements.find(
              (item) => getAnnouncementKey(item) === joinedAnnouncementKey
            ) || null
          : null;
        if (announcementByKey) return announcementByKey.trackSid;

        const joinedStillExistsByTrack = prev
          ? dedupedAnnouncements.some((item) => item.trackSid === prev) ||
            voiceVisualsRef.current.some((item) => item.trackSid === prev)
          : false;

        return joinedStillExistsByTrack ? prev : null;
      });

      setFocusedVisualTrackSid((prev) => {
        if (!prev) return prev;
        if (voiceVisualsRef.current.some((item) => item.trackSid === prev)) return prev;
        return null;
      });
    };

    const visualHandler = (event: Event) => applyVisualDetail((event as CustomEvent<any>).detail);
    const announcementHandler = (event: Event) => applyAnnouncementDetail((event as CustomEvent<any>).detail);
    const clearHandler = (event: Event) => {
      const customEvent = event as CustomEvent<{
        channelId: string | null;
        userId?: string | null;
        participantId?: string | null;
        trackSid?: string | null;
        source?: "camera" | "screen" | null;
      }>;
      if (!customEvent.detail || !selectedStreamChannelKeys.includes(String(customEvent.detail.channelId ?? ""))) return;

      const clearedUserId = customEvent.detail.userId
        ? String(customEvent.detail.userId)
        : customEvent.detail.participantId
          ? String(customEvent.detail.participantId)
          : null;
      const clearedTrackSid = customEvent.detail.trackSid ? String(customEvent.detail.trackSid) : null;
      const clearedSource =
        customEvent.detail.source === "camera" || customEvent.detail.source === "screen"
          ? customEvent.detail.source
          : null;

      const hasPreciseClearTarget = !!clearedTrackSid || (!!clearedUserId && !!clearedSource);

      const matchesClearedVisual = (visual: VoiceVisualEntry) => {
        if (clearedTrackSid && visual.trackSid === clearedTrackSid) return true;
        if (clearedUserId && clearedSource) {
          return String(visual.participantId) === clearedUserId && visual.source === clearedSource;
        }
        return false;
      };

      const nextVisuals = hasPreciseClearTarget
        ? voiceVisualsRef.current.filter((visual) => !matchesClearedVisual(visual))
        : voiceVisualsRef.current;

      voiceVisualsRef.current = nextVisuals;
      setVoiceVisuals(nextVisuals);
      setLocalScreenShareActive(nextVisuals.some((visual) => visual.source === "screen"));

      const shouldRemoveAnnouncement = (item: StreamAnnouncement) => {
        if (clearedTrackSid && item.trackSid === clearedTrackSid) return true;
        if (clearedUserId && clearedSource) {
          return (
            String(item.participantId) === clearedUserId &&
            item.source === clearedSource
          );
        }
        return false;
      };

      const nextAnnouncements = hasPreciseClearTarget
        ? streamAnnouncementsRef.current.filter((item) => !shouldRemoveAnnouncement(item))
        : streamAnnouncementsRef.current;

      streamAnnouncementsRef.current = nextAnnouncements;
      setStreamAnnouncements(nextAnnouncements);

      const joinedVisualByKey = joinedAnnouncementKey
        ? nextVisuals.find((item) => getAnnouncementKey(item) === joinedAnnouncementKey) || null
        : null;
      const joinedAnnouncementByKey = joinedAnnouncementKey
        ? nextAnnouncements.find((item) => getAnnouncementKey(item) === joinedAnnouncementKey) || null
        : null;
      const joinedVisualByTrack = joinedAnnouncementTrackSid
        ? nextVisuals.find((item) => item.trackSid === joinedAnnouncementTrackSid) || null
        : null;
      const joinedAnnouncementByTrack = joinedAnnouncementTrackSid
        ? nextAnnouncements.find((item) => item.trackSid === joinedAnnouncementTrackSid) || null
        : null;

      const nextJoinedVisual =
        joinedVisualByKey || joinedVisualByTrack || null;
      const nextJoinedAnnouncement =
        joinedAnnouncementByKey || joinedAnnouncementByTrack || null;

      if (nextJoinedVisual || nextJoinedAnnouncement) {
        const nextJoinedKey = nextJoinedVisual
          ? getAnnouncementKey(nextJoinedVisual)
          : nextJoinedAnnouncement
            ? getAnnouncementKey(nextJoinedAnnouncement)
            : null;
        const nextJoinedTrackSid = nextJoinedVisual?.trackSid || nextJoinedAnnouncement?.trackSid || null;

        setJoinedAnnouncementKey(nextJoinedKey);
        setJoinedAnnouncementTrackSid(nextJoinedTrackSid);
        setFocusedVisualTrackSid((prev) => {
          if (nextJoinedVisual) {
            if (prev && nextVisuals.some((item) => item.trackSid === prev && getAnnouncementKey(item) === nextJoinedKey)) {
              return prev;
            }
            return nextJoinedVisual.trackSid;
          }
          return null;
        });
        persistWatchedStreamMemory(selectedStreamMemoryKey, {
          joinedAnnouncementKey: nextJoinedKey,
          joinedAnnouncementTrackSid: nextJoinedTrackSid,
          focusedVisualTrackSid: nextJoinedVisual?.trackSid || null,
        });
        return;
      }

      if (joinedAnnouncementKey || joinedAnnouncementTrackSid || focusedVisualTrackSid) {
        setJoinedAnnouncementTrackSid(null);
        setJoinedAnnouncementKey(null);
        setFocusedVisualTrackSid(null);
        setIsJoinedStreamHovered(false);
        persistWatchedStreamMemory(selectedStreamMemoryKey, {
          joinedAnnouncementKey: null,
          joinedAnnouncementTrackSid: null,
          focusedVisualTrackSid: null,
        });
      } else {
        setFocusedVisualTrackSid((prev) => {
          if (!prev) return null;
          return nextVisuals.some((item) => item.trackSid === prev) ? prev : null;
        });
      }
    };

    window.addEventListener(STREAM_EVENT_NAME, visualHandler as EventListener);
    window.addEventListener(STREAM_ANNOUNCEMENT_EVENT_NAME, announcementHandler as EventListener);
    window.addEventListener(STREAM_ANNOUNCEMENT_CLEAR_EVENT_NAME, clearHandler as EventListener);

    try {
      const snapshot = (window as any)[STREAM_SNAPSHOT_KEY];
      const currentEntry = selectedStreamChannelKeys.map((key) => snapshot?.[key]).find((entry: any) => entry && !Array.isArray(entry));
      if (currentEntry) {
        applyVisualDetail(currentEntry);
      } else {
        voiceVisualsRef.current = [];
        setVoiceVisuals([]);
        setLocalScreenShareActive(false);
        setFocusedVisualTrackSid(null);
      }
    } catch {
      voiceVisualsRef.current = [];
      setVoiceVisuals([]);
      setLocalScreenShareActive(false);
      setFocusedVisualTrackSid(null);
    }

    try {
      const snapshot = (window as any)[STREAM_ANNOUNCEMENT_SNAPSHOT_KEY];
      const currentEntry = selectedStreamChannelKeys.map((key) => snapshot?.[key]).find((entry: any) => entry && !Array.isArray(entry));
      if (currentEntry) {
        applyAnnouncementDetail(currentEntry);
      } else {
        streamAnnouncementsRef.current = [];
        setStreamAnnouncements([]);
      }
    } catch {
      streamAnnouncementsRef.current = [];
      setStreamAnnouncements([]);
    }

    return () => {
      window.removeEventListener(USER_IDENTITY_EVENT_NAME, identityHandler as EventListener);
      window.removeEventListener(STREAM_EVENT_NAME, visualHandler as EventListener);
      window.removeEventListener(STREAM_ANNOUNCEMENT_EVENT_NAME, announcementHandler as EventListener);
      window.removeEventListener(STREAM_ANNOUNCEMENT_CLEAR_EVENT_NAME, clearHandler as EventListener);
    };
  }, [selectedChannel.id, selectedChannel.serverId, selectedStreamMemoryKey, selectedStreamChannelKeys]);

  useEffect(() => {
    if (!isVoice) return;

    if (!joinedAnnouncementKey && !joinedAnnouncementTrackSid) {
      setFocusedVisualTrackSid(null);
      return;
    }

    const visualByKey = joinedAnnouncementKey
      ? voiceVisuals.find((item) => getAnnouncementKey(item) === joinedAnnouncementKey) || null
      : null;

    if (visualByKey) {
      setFocusedVisualTrackSid((prev) => (prev === visualByKey.trackSid ? prev : visualByKey.trackSid));
      if (joinedAnnouncementTrackSid !== visualByKey.trackSid) {
        setJoinedAnnouncementTrackSid(visualByKey.trackSid);
      }
      return;
    }

    const announcementByKey = joinedAnnouncementKey
      ? streamAnnouncements.find((item) => getAnnouncementKey(item) === joinedAnnouncementKey) || null
      : null;

    if (announcementByKey) {
      if (joinedAnnouncementTrackSid !== announcementByKey.trackSid) {
        setJoinedAnnouncementTrackSid(announcementByKey.trackSid);
      }
      setFocusedVisualTrackSid(null);
      return;
    }

    if (joinedAnnouncementTrackSid) {
      const visualByTrack = voiceVisuals.find((item) => item.trackSid === joinedAnnouncementTrackSid) || null;
      if (visualByTrack) {
        const nextKey = getAnnouncementKey(visualByTrack);
        if (!joinedAnnouncementKey) {
          setJoinedAnnouncementKey(nextKey);
        }
        setFocusedVisualTrackSid((prev) => (prev === visualByTrack.trackSid ? prev : visualByTrack.trackSid));
        return;
      }

      const announcementByTrack =
        streamAnnouncements.find((item) => item.trackSid === joinedAnnouncementTrackSid) || null;

      if (announcementByTrack) {
        if (!joinedAnnouncementKey) {
          setJoinedAnnouncementKey(getAnnouncementKey(announcementByTrack));
        }
        setFocusedVisualTrackSid(null);
        return;
      }
    }

    setJoinedAnnouncementTrackSid(null);
    setJoinedAnnouncementKey(null);
    setFocusedVisualTrackSid(null);
    persistWatchedStreamMemory(selectedStreamMemoryKey, {
      joinedAnnouncementTrackSid: null,
      joinedAnnouncementKey: null,
      focusedVisualTrackSid: null,
    });
  }, [voiceVisuals, streamAnnouncements, joinedAnnouncementTrackSid, joinedAnnouncementKey, isVoice, selectedStreamMemoryKey]);

  const {
    availableAnnouncements,
    screenVisuals,
    cameraVisuals,
    screenAnnouncements,
    cameraAnnouncements,
    mediaAnnouncements,
    hasMediaAnnouncements,
    joinedAnnouncement,
    joinedVisuals,
    focusedVisual,
    focusedAnnouncementPreview,
    isFocusedVideoLocked,
    shouldShowFocusedPreview,
  } = useMemo(() => {
    const dedupedAnnouncements = Array.from(
      streamAnnouncements.reduce((map, item) => {
        const key = `${item.participantId}:${item.source}`;
        const existing = map.get(key);
        if (!existing) {
          map.set(key, item);
          return map;
        }
        const existingTs = existing.previewUpdatedAt || 0;
        const nextTs = item.previewUpdatedAt || 0;
        if (nextTs >= existingTs) map.set(key, item);
        return map;
      }, new Map<string, StreamAnnouncement>()).values()
    );

    const nextScreenVisuals = voiceVisuals.filter((item) => item.source === "screen");
    const nextCameraVisuals = voiceVisuals.filter((item) => item.source === "camera");
    const nextScreenAnnouncements = dedupedAnnouncements.filter((item) => item.source === "screen");
    const nextCameraAnnouncements = dedupedAnnouncements.filter((item) => item.source === "camera");
    const nextMediaAnnouncements = [...dedupedAnnouncements].sort((a, b) => {
      if (a.source !== b.source) return a.source === "screen" ? -1 : 1;
      const tsA = a.previewUpdatedAt || 0;
      const tsB = b.previewUpdatedAt || 0;
      if (tsA !== tsB) return tsB - tsA;
      return a.participantName.localeCompare(b.participantName, "tr");
    });

    const nextJoinedAnnouncement = joinedAnnouncementKey
      ? dedupedAnnouncements.find((item) => getAnnouncementKey(item) === joinedAnnouncementKey) || null
      : joinedAnnouncementTrackSid
        ? dedupedAnnouncements.find((item) => item.trackSid === joinedAnnouncementTrackSid) || null
        : null;

    const nextJoinedVisuals = voiceVisuals.filter((item) => {
      if (joinedAnnouncementKey) return getAnnouncementKey(item) === joinedAnnouncementKey;
      if (joinedAnnouncementTrackSid) return item.trackSid === joinedAnnouncementTrackSid;
      return false;
    });

    const nextFocusedVisual =
      nextJoinedVisuals.find((item) => item.trackSid === focusedVisualTrackSid) || nextJoinedVisuals[0] || null;
    const nextFocusedAnnouncementPreview =
      nextJoinedAnnouncement?.previewDataUrl && !nextFocusedVisual ? nextJoinedAnnouncement.previewDataUrl : null;
    const nextIsFocusedVideoLocked =
      !!nextFocusedVisual && !!videoLockTrackSid && nextFocusedVisual.trackSid === videoLockTrackSid;
    const nextShouldShowFocusedPreview =
      !nextFocusedVisual && !nextIsFocusedVideoLocked && !!nextFocusedAnnouncementPreview && !!nextJoinedAnnouncement;

    return {
      availableAnnouncements: dedupedAnnouncements,
      screenVisuals: nextScreenVisuals,
      cameraVisuals: nextCameraVisuals,
      screenAnnouncements: nextScreenAnnouncements,
      cameraAnnouncements: nextCameraAnnouncements,
      mediaAnnouncements: nextMediaAnnouncements,
      hasMediaAnnouncements: nextMediaAnnouncements.length > 0,
      joinedAnnouncement: nextJoinedAnnouncement,
      joinedVisuals: nextJoinedVisuals,
      focusedVisual: nextFocusedVisual,
      focusedAnnouncementPreview: nextFocusedAnnouncementPreview,
      isFocusedVideoLocked: nextIsFocusedVideoLocked,
      shouldShowFocusedPreview: nextShouldShowFocusedPreview,
    };
  }, [
    streamAnnouncements,
    voiceVisuals,
    joinedAnnouncementKey,
    joinedAnnouncementTrackSid,
    focusedVisualTrackSid,
    videoLockTrackSid,
  ]);

  useEffect(() => {
    if (!isVoice) return;

    const hasAnyMedia = mediaAnnouncements.length > 0 || voiceVisuals.length > 0;
    if (!hasAnyMedia) {
      if (joinedAnnouncementKey || joinedAnnouncementTrackSid || focusedVisualTrackSid) {
        setJoinedAnnouncementKey(null);
        setJoinedAnnouncementTrackSid(null);
        setFocusedVisualTrackSid(null);
        setIsJoinedStreamHovered(false);
        persistWatchedStreamMemory(selectedStreamMemoryKey, {
          joinedAnnouncementKey: null,
          joinedAnnouncementTrackSid: null,
          focusedVisualTrackSid: null,
        });
      }
      return;
    }

    const hasJoinedMedia =
      voiceVisuals.some((item) => {
        if (joinedAnnouncementKey && getAnnouncementKey(item) === joinedAnnouncementKey) return true;
        if (joinedAnnouncementTrackSid && item.trackSid === joinedAnnouncementTrackSid) return true;
        return false;
      }) ||
      mediaAnnouncements.some((item) => {
        if (joinedAnnouncementKey && getAnnouncementKey(item) === joinedAnnouncementKey) return true;
        if (joinedAnnouncementTrackSid && item.trackSid === joinedAnnouncementTrackSid) return true;
        return false;
      });

    if (!hasJoinedMedia && (joinedAnnouncementKey || joinedAnnouncementTrackSid || focusedVisualTrackSid)) {
      setJoinedAnnouncementKey(null);
      setJoinedAnnouncementTrackSid(null);
      setFocusedVisualTrackSid(null);
      setIsJoinedStreamHovered(false);
      persistWatchedStreamMemory(selectedStreamMemoryKey, {
        joinedAnnouncementKey: null,
        joinedAnnouncementTrackSid: null,
        focusedVisualTrackSid: null,
      });
    }
  }, [
    isVoice,
    mediaAnnouncements,
    voiceVisuals,
    joinedAnnouncementKey,
    joinedAnnouncementTrackSid,
    focusedVisualTrackSid,
    selectedStreamMemoryKey,
  ]);

  useEffect(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (isVoice) {
      setMessages([]);
      setMessageText("");
      setError("");
      return;
    }
    fetchMessages(selectedChannel.id);
    if (!token) return;
    const ws = new WebSocket(`ws://localhost:3001/channels/${selectedChannel.id}/ws?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (!message?.type) return;
        if (message.type === "CHANNEL_MESSAGE_DELETED" && message.payload?.id) {
          removeMessage(message.payload.id);
          return;
        }
        if (["NEW_CHANNEL_MESSAGE", "CHANNEL_MESSAGE_UPDATED", "CHANNEL_MESSAGE_PINNED", "CHANNEL_MESSAGE_UNPINNED"].includes(message.type) && message.payload) {
          upsertMessage(message.payload);
        }
      } catch (err) {
        console.error("chat ws parse error:", err);
      }
    };
    ws.onerror = (err) => console.error("chat ws error:", err);
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [selectedChannel.id, isVoice, token]);

  useEffect(() => {
    if (isVoice || loading) return;
    if (!messages.length) return;
    if (!initialAutoScrollLockRef.current) return;

    startInitialBottomSettler();

    return () => cancelInitialBottomSettler();
  }, [messages.length, loading, isVoice, selectedChannel.id]);

  useEffect(() => {
    if (isVoice) return;

    const shouldForceInitialBottom = firstLoadRef.current;
    const shouldFollowBottom = shouldStickToBottomRef.current;

    if (!shouldForceInitialBottom && !shouldFollowBottom) return;

    if (shouldForceInitialBottom) {
      startInitialBottomSettler();
      firstLoadRef.current = false;
      return () => cancelInitialBottomSettler();
    }

    const runScroll = () => scrollToBottom("auto");

    const raf1 = window.requestAnimationFrame(() => {
      runScroll();
      window.requestAnimationFrame(runScroll);
    });
    const t1 = window.setTimeout(runScroll, 0);
    const t2 = window.setTimeout(runScroll, 40);
    const t3 = window.setTimeout(runScroll, 120);
    const t4 = window.setTimeout(runScroll, 260);
    const t5 = window.setTimeout(runScroll, 420);

    return () => {
      window.cancelAnimationFrame(raf1);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
      window.clearTimeout(t5);
    };
  }, [messages, isVoice, selectedChannel.id]);

  const onComposerKeyDown = async (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (draftState.editingMessageId && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      await saveEditMessage(draftState.editingMessageId);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (messageText.trim() || pendingAttachments.length > 0) {
        await sendMessage();
      }
    }
  };

  useEffect(() => {
    if (staleReconcileTimerRef.current) {
      window.clearTimeout(staleReconcileTimerRef.current);
      staleReconcileTimerRef.current = null;
    }
    if (!isVoice) {
      orphanFirstSeenAtRef.current = {};
      previousLiveVisualKeysRef.current = new Set();
      return;
    }
    const now = Date.now();
    const currentLiveVisualKeys = new Set(voiceVisuals.map((item) => `${item.participantId}:${item.source}`));
    const previousLiveVisualKeys = previousLiveVisualKeysRef.current;
    const disappearedKeys = new Set<string>();
    previousLiveVisualKeys.forEach((key) => {
      if (!currentLiveVisualKeys.has(key)) disappearedKeys.add(key);
    });
    previousLiveVisualKeysRef.current = currentLiveVisualKeys;
    const orphanAnnouncements = availableAnnouncements.filter((item) => {
      const matchingVisual = voiceVisuals.find((visual) => visual.trackSid === item.trackSid || (visual.participantId === item.participantId && visual.source === item.source));
      return !matchingVisual;
    });
    if (orphanAnnouncements.length === 0) {
      orphanFirstSeenAtRef.current = {};
      return;
    }
    const orphanMap = orphanFirstSeenAtRef.current;
    const orphanKeys = new Set<string>();
    orphanAnnouncements.forEach((item) => {
      const key = `${item.participantId}:${item.source}`;
      orphanKeys.add(key);
      if (!orphanMap[key]) orphanMap[key] = now;
    });
    Object.keys(orphanMap).forEach((key) => {
      if (!orphanKeys.has(key)) delete orphanMap[key];
    });
    const immediateCandidates = orphanAnnouncements.filter((item) => disappearedKeys.has(`${item.participantId}:${item.source}`));
    const delayedCandidates = orphanAnnouncements.filter((item) => {
      const key = `${item.participantId}:${item.source}`;
      if (disappearedKeys.has(key)) return false;
      return now - (orphanMap[key] || now) >= 900;
    });
    const candidates = immediateCandidates.length > 0 ? immediateCandidates : delayedCandidates;
    if (candidates.length === 0) {
      const nextCheckIn = orphanAnnouncements.reduce((minDelay, item) => {
        const key = `${item.participantId}:${item.source}`;
        if (disappearedKeys.has(key)) return minDelay;
        const remaining = Math.max(0, 900 - (now - (orphanMap[key] || now)));
        return Math.min(minDelay, remaining);
      }, 900);
      staleReconcileTimerRef.current = window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent(REQUEST_VISUAL_RECONCILE_EVENT_NAME, { detail: { channelId: selectedChannel.id } }));
      }, Math.max(120, nextCheckIn));
      return () => {
        if (staleReconcileTimerRef.current) window.clearTimeout(staleReconcileTimerRef.current);
      };
    }
    const signature = candidates.map((item) => `${item.participantId}:${item.source}:${item.trackSid}`).sort().join("|");
    if (signature === lastReconcileRequestRef.current.signature && now - lastReconcileRequestRef.current.at < 900) return;
    staleReconcileTimerRef.current = window.setTimeout(() => {
      const firedAt = Date.now();
      if (signature === lastReconcileRequestRef.current.signature && firedAt - lastReconcileRequestRef.current.at < 900) return;
      lastReconcileRequestRef.current = { signature, at: firedAt };
      window.dispatchEvent(new CustomEvent(REQUEST_VISUAL_RECONCILE_EVENT_NAME, { detail: { channelId: selectedChannel.id } }));
    }, immediateCandidates.length > 0 ? 120 : 180);
    return () => {
      if (staleReconcileTimerRef.current) window.clearTimeout(staleReconcileTimerRef.current);
    };
  }, [isVoice, selectedChannel.id, selectedChannel.serverId, availableAnnouncements, voiceVisuals, selectedStreamChannelKeys]);

  const pinnedMessages = useMemo(() => {
    return [...messages]
      .filter((m) => m.isPinned && !m.deletedAt)
      .sort((a, b) => new Date(b.pinnedAt || b.createdAt).getTime() - new Date(a.pinnedAt || a.createdAt).getTime());
  }, [messages]);

  const filteredMessages = useMemo(() => {
    const term = searchText.trim().toLowerCase();
    return messages.filter((message) => {
      if (message.deletedAt) return false;
      if (!term) return true;
      const attachmentText = (message.attachments || []).map((item) => `${item.originalName} ${item.mimeType || ""}`).join(" ");
      const haystack = [message.displayName, message.username || "", message.content || "", message.replyTo?.displayName || "", message.replyTo?.username || "", message.replyTo?.content || "", attachmentText]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [messages, searchText]);

  const replyTargetMessage = draftState.replyToMessageId ? messages.find((m) => m.id === draftState.replyToMessageId) || null : null;

  useEffect(() => {
    if (isVoice) {
      setShowJumpToLatest(false);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      updateJumpToLatestVisibility();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [filteredMessages, isVoice]);

  return (
    <div style={{ flex: 1, minHeight: 0, background: "linear-gradient(180deg, #11141a 0%, #0f1217 100%)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ minHeight: 72, borderBottom: "1px solid #232833", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", background: "rgba(255,255,255,0.02)", boxSizing: "border-box", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
          <div style={{ width: 38, height: 38, borderRadius: 14, background: isVoice ? "linear-gradient(135deg, #5865f2, #7b8aff)" : "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: "1px solid rgba(255,255,255,0.06)" }}>
            <span style={{ fontSize: 16 }}>{isVoice ? "🔊" : "#"}</span>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 18, color: "#ffffff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{selectedChannel.name}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {!isVoice ? (
            <>
              <button onClick={() => setShowSearch((prev) => !prev)} style={toolbarIconButtonStyle} title="Mesajlarda ara">
                <Search size={16} />
              </button>
              {showSearch ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 220, maxWidth: 320, flex: 1, height: 40, borderRadius: 12, padding: "0 12px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <Search size={14} color="#9ba4b2" />
                  <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Mesajlarda ara..." style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "#e5ebf3", fontSize: 13 }} />
                </div>
              ) : null}
              <button onClick={() => setShowPinnedPanel((prev) => !prev)} style={toolbarIconButtonStyle} title="Pinlenmiş mesajlar">
                <Pin size={16} />
              </button>
            </>
          ) : null}
          <div style={{ padding: "8px 12px", borderRadius: 999, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", color: "#a8b0bc", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{isVoice ? "Voice Channel" : "Metin kanalı"}</div>
        </div>
      </div>

      {showPinnedPanel && !isVoice ? (
        <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)", padding: "12px 18px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#ffffff", marginBottom: 10 }}>Pinlenmiş mesajlar</div>
          {pinnedMessages.length === 0 ? (
            <div style={{ color: "#8f98a6", fontSize: 13 }}>Henüz pinlenmiş mesaj yok.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {pinnedMessages.map((message) => (
                <button key={message.id} onClick={() => document.getElementById(`msg-${message.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} style={{ textAlign: "left", width: "100%", padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", color: "#dbe3ee", cursor: "pointer" }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{message.displayName}</div>
                  <div style={{ fontSize: 12, color: "#98a1af", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{message.deletedAt ? "Bu mesaj silindi." : message.content}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <div
        ref={scrollContainerRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: isVoice ? "hidden" : "auto",
          padding: "18px 18px 14px",
          boxSizing: "border-box",
          position: "relative",
        }}
      >
        {isVoice ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: joinedAnnouncementTrackSid || joinedAnnouncementKey ? 12 : 18,
              minHeight: 0,
              height: "100%",
            }}
          >
            {!(joinedAnnouncementTrackSid || joinedAnnouncementKey) ? (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: hasMediaAnnouncements ? "minmax(0, 1.12fr) minmax(320px, 0.88fr)" : "minmax(0, 1fr)",
                    gap: 18,
                    minHeight: 0,
                    alignItems: "stretch",
                  }}
                >
                  <div
                    style={{
                      borderRadius: 28,
                      border: "1px solid rgba(255,255,255,0.07)",
                      background:
                        "radial-gradient(circle at top left, rgba(88,101,242,0.22), transparent 34%), linear-gradient(180deg, rgba(20,24,32,0.98) 0%, rgba(12,16,22,0.98) 100%)",
                      boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
                      padding: 24,
                      display: "flex",
                      flexDirection: "column",
                      minHeight: 0,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 16,
                        flexWrap: "wrap",
                        marginBottom: 18,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            height: 30,
                            padding: "0 12px",
                            borderRadius: 999,
                            background: "rgba(255,255,255,0.05)",
                            border: "1px solid rgba(255,255,255,0.07)",
                            color: "#cfd8ea",
                            fontSize: 11,
                            fontWeight: 900,
                            letterSpacing: 0.35,
                            textTransform: "uppercase",
                            marginBottom: 14,
                          }}
                        >
                          Voice Room
                        </div>

                        <div
                          style={{
                            color: "#ffffff",
                            fontSize: 28,
                            fontWeight: 900,
                            lineHeight: 1.1,
                            marginBottom: 8,
                          }}
                        >
                          {selectedChannel.name}
                        </div>

                        <div
                          style={{
                            color: "#93a0b4",
                            fontSize: 14,
                            lineHeight: 1.65,
                            maxWidth: 620,
                          }}
                        >
                          {isInsideSelectedVoiceRoom
                            ? "Odadasın. Aşağıdaki kullanıcı kartlarından kimin içeride olduğunu görebilir, açık yayın varsa sağ panelden izlemeye geçebilirsin."
                            : "Bu oda için canlı kullanıcı kartları ve açık yayınlar burada görünür. Odaya katıldıktan sonra deneyim daha canlı hale gelir."}
                        </div>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          flexWrap: "wrap",
                          justifyContent: "flex-end",
                        }}
                      >
                        <div
                          style={{
                            height: 36,
                            padding: "0 14px",
                            borderRadius: 999,
                            display: "inline-flex",
                            alignItems: "center",
                            background: "rgba(255,255,255,0.05)",
                            border: "1px solid rgba(255,255,255,0.07)",
                            color: "#e8edf7",
                            fontSize: 12,
                            fontWeight: 800,
                          }}
                        >
                          Odadaki kişi: {joinedUsersCount}
                        </div>
                        <div
                          style={{
                            height: 36,
                            padding: "0 14px",
                            borderRadius: 999,
                            display: "inline-flex",
                            alignItems: "center",
                            background: screenAnnouncements.length > 0 ? "rgba(237,66,69,0.14)" : "rgba(255,255,255,0.05)",
                            border: screenAnnouncements.length > 0 ? "1px solid rgba(237,66,69,0.24)" : "1px solid rgba(255,255,255,0.07)",
                            color: screenAnnouncements.length > 0 ? "#ffd6d7" : "#c7cfdb",
                            fontSize: 12,
                            fontWeight: 900,
                            letterSpacing: 0.25,
                          }}
                        >
                          {screenAnnouncements.length > 0 ? `LIVE • ${screenAnnouncements.length}` : "Açık yayın yok"}
                        </div>
                        <div
                          style={{
                            height: 36,
                            padding: "0 14px",
                            borderRadius: 999,
                            display: "inline-flex",
                            alignItems: "center",
                            background: cameraAnnouncements.length > 0 ? "rgba(88,101,242,0.14)" : "rgba(255,255,255,0.05)",
                            border: cameraAnnouncements.length > 0 ? "1px solid rgba(88,101,242,0.24)" : "1px solid rgba(255,255,255,0.07)",
                            color: cameraAnnouncements.length > 0 ? "#dde3ff" : "#c7cfdb",
                            fontSize: 12,
                            fontWeight: 900,
                            letterSpacing: 0.25,
                          }}
                        >
                          {cameraAnnouncements.length > 0 ? `KAMERA • ${cameraAnnouncements.length}` : "Kamera yok"}
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        flex: 1,
                        minHeight: 0,
                        overflow: "auto",
                        paddingRight: 2,
                      }}
                    >
                      {currentVoiceMembers.length > 0 ? (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(172px, 1fr))",
                            gap: 14,
                            alignItems: "stretch",
                          }}
                        >
                          {currentVoiceMembers.map((member) => {
                            const isSelf = localUserId === String(member.userId);
                            const isMuted = Boolean(member.muted);
                            const isDeafened = Boolean(member.deafened);
                            const isStreaming = screenAnnouncements.some(
                              (item) => String(item.participantId) === String(member.userId)
                            );

                            return (
                              <div
                                key={member.userId}
                                style={{
                                  position: "relative",
                                  borderRadius: 24,
                                  border: isSelf
                                    ? "1px solid rgba(88,101,242,0.28)"
                                    : "1px solid rgba(255,255,255,0.06)",
                                  background: isSelf
                                    ? "linear-gradient(180deg, rgba(88,101,242,0.12), rgba(255,255,255,0.03))"
                                    : "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.025))",
                                  padding: 16,
                                  minHeight: 178,
                                  display: "flex",
                                  flexDirection: "column",
                                  justifyContent: "space-between",
                                  overflow: "hidden",
                                  boxShadow: isSelf
                                    ? "0 16px 36px rgba(88,101,242,0.16)"
                                    : "0 12px 28px rgba(0,0,0,0.18)",
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 10,
                                    marginBottom: 14,
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 8,
                                      minWidth: 0,
                                    }}
                                  >
                                    <span
                                      style={{
                                        width: 10,
                                        height: 10,
                                        borderRadius: 999,
                                        background: isStreaming ? "#ed4245" : isSelf ? "#5865f2" : "#43b581",
                                        boxShadow: isStreaming
                                          ? "0 0 0 6px rgba(237,66,69,0.12)"
                                          : isSelf
                                            ? "0 0 0 6px rgba(88,101,242,0.12)"
                                            : "0 0 0 6px rgba(67,181,129,0.10)",
                                        flexShrink: 0,
                                      }}
                                    />
                                    <span
                                      style={{
                                        color: "#d8e1f0",
                                        fontSize: 11,
                                        fontWeight: 800,
                                        textTransform: "uppercase",
                                        letterSpacing: 0.4,
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                      }}
                                    >
                                      {isStreaming ? "Canlı yayın" : isSelf ? "Bu sensin" : "Odada"}
                                    </span>
                                  </div>

                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 8,
                                      flexShrink: 0,
                                    }}
                                  >
                                    {isMuted ? (
                                      <span style={{ color: "#ffb7ba", fontSize: 12, fontWeight: 800 }}>Mic Kapalı</span>
                                    ) : null}
                                    {isDeafened ? (
                                      <span style={{ color: "#ffd4a8", fontSize: 12, fontWeight: 800 }}>Kulaklık Kapalı</span>
                                    ) : null}
                                  </div>
                                </div>

                                <div
                                  style={{
                                    flex: 1,
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: 14,
                                    textAlign: "center",
                                  }}
                                >
                                  {member.avatarUrl ? (
                                    <img
                                      src={member.avatarUrl}
                                      alt={member.displayName}
                                      style={{
                                        width: 84,
                                        height: 84,
                                        borderRadius: 28,
                                        objectFit: "cover",
                                        border: "1px solid rgba(255,255,255,0.12)",
                                        background: "#1c212a",
                                        boxShadow: "0 18px 34px rgba(0,0,0,0.28)",
                                      }}
                                    />
                                  ) : (
                                    <div
                                      style={{
                                        width: 84,
                                        height: 84,
                                        borderRadius: 28,
                                        background: "linear-gradient(135deg, #5865f2, #7b8aff)",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        color: "white",
                                        fontWeight: 900,
                                        fontSize: 28,
                                        boxShadow: "0 18px 34px rgba(88,101,242,0.28)",
                                      }}
                                    >
                                      {getVoiceUserInitials(member.displayName)}
                                    </div>
                                  )}

                                  <div style={{ minWidth: 0 }}>
                                    <div
                                      style={{
                                        color: "#ffffff",
                                        fontWeight: 800,
                                        fontSize: 15,
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        maxWidth: "100%",
                                      }}
                                    >
                                      {member.displayName}
                                    </div>
                                    <div
                                      style={{
                                        color: "#8f9bae",
                                        fontSize: 12,
                                        marginTop: 4,
                                      }}
                                    >
                                      {member.username ? `@${member.username}` : isSelf ? "Hazır" : "Bağlı"}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div
                          style={{
                            borderRadius: 24,
                            border: "1px dashed rgba(255,255,255,0.08)",
                            background: "rgba(255,255,255,0.02)",
                            minHeight: 280,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            textAlign: "center",
                            padding: 28,
                            color: "#94a0b3",
                          }}
                        >
                          <div
                            style={{
                              width: 82,
                              height: 82,
                              borderRadius: 26,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              background: "rgba(255,255,255,0.04)",
                              border: "1px solid rgba(255,255,255,0.06)",
                              fontSize: 30,
                              marginBottom: 16,
                            }}
                          >
                            🎧
                          </div>
                          <div style={{ color: "#ffffff", fontSize: 18, fontWeight: 800, marginBottom: 8 }}>
                            Oda şu an sakin
                          </div>
                          <div style={{ maxWidth: 420, fontSize: 14, lineHeight: 1.65 }}>
                            Bu ses kanalında henüz kimse görünmüyor. Birisi katıldığında burada kullanıcı kartı olarak belirecek.
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {hasMediaAnnouncements ? (
                    <div
                      style={{
                        borderRadius: 28,
                        border: "1px solid rgba(255,255,255,0.07)",
                        background: "linear-gradient(180deg, rgba(18,22,29,0.98) 0%, rgba(10,13,18,0.98) 100%)",
                        boxShadow: "0 22px 54px rgba(0,0,0,0.26)",
                        padding: 18,
                        display: "flex",
                        flexDirection: "column",
                        minHeight: 0,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          marginBottom: 14,
                          flexWrap: "wrap",
                        }}
                      >
                        <div>
                          <div style={{ color: "#ffffff", fontSize: 18, fontWeight: 900 }}>Canlı Medya</div>
                          <div style={{ color: "#8e9bb0", fontSize: 13, marginTop: 4 }}>
                            Yayınlar ve kameralar burada tek listede görünür.
                          </div>
                        </div>

                        <div
                          style={{
                            height: 32,
                            padding: "0 12px",
                            borderRadius: 999,
                            display: "inline-flex",
                            alignItems: "center",
                            background: screenAnnouncements.length > 0 ? "rgba(237,66,69,0.14)" : "rgba(88,101,242,0.14)",
                            border: screenAnnouncements.length > 0 ? "1px solid rgba(237,66,69,0.22)" : "1px solid rgba(88,101,242,0.22)",
                            color: screenAnnouncements.length > 0 ? "#ffd2d4" : "#dde3ff",
                            fontSize: 11,
                            fontWeight: 900,
                            letterSpacing: 0.35,
                            textTransform: "uppercase",
                          }}
                        >
                          {mediaAnnouncements.length} aktif
                        </div>
                      </div>

                      <div style={{ flex: 1, minHeight: 0, overflow: "auto", paddingRight: 2 }}>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr",
                            gap: 14,
                          }}
                        >
                          {mediaAnnouncements.map((item) => {
                            const itemKey = getAnnouncementKey(item);
                            const isOwnMedia = localUserId === item.participantId;
                            const visual =
                              voiceVisuals.find(
                                (entry) =>
                                  entry.trackSid === item.trackSid ||
                                  (String(entry.participantId) === String(item.participantId) && entry.source === item.source)
                              ) || null;

                            if (item.source === "camera") {
                              return (
                                <div key={itemKey} style={{ position: "relative", cursor: "pointer" }} onDoubleClick={() => joinMediaAnnouncement(item)}>
                                  <MediaPreviewCard item={item} visual={visual} accent="blue" />
                                  {isOwnMedia ? (
                                    <div
                                      style={{
                                        position: "absolute",
                                        top: 12,
                                        right: 12,
                                        height: 24,
                                        padding: "0 8px",
                                        borderRadius: 999,
                                        display: "inline-flex",
                                        alignItems: "center",
                                        background: "rgba(255,255,255,0.08)",
                                        border: "1px solid rgba(255,255,255,0.12)",
                                        color: "#ffffff",
                                        fontSize: 10,
                                        fontWeight: 800,
                                        letterSpacing: 0.3,
                                      }}
                                    >
                                      SEN
                                    </div>
                                  ) : null}
                                </div>
                              );
                            }

                            return (
                              <div
                                key={itemKey}
                                onDoubleClick={() => joinMediaAnnouncement(item)}
                                style={{
                                  borderRadius: 22,
                                  overflow: "hidden",
                                  border: "1px solid rgba(255,255,255,0.08)",
                                  background: "rgba(255,255,255,0.03)",
                                  boxShadow: "0 14px 34px rgba(0,0,0,0.2)",
                                }}
                              >
                                <div
                                  style={{
                                    position: "relative",
                                    width: "100%",
                                    aspectRatio: "16 / 9",
                                    background: "#0b0f14",
                                    overflow: "hidden",
                                  }}
                                >
                                  {item.previewDataUrl ? (
                                    <img
                                      src={item.previewDataUrl}
                                      alt={`${item.participantName} preview`}
                                      style={{
                                        width: "100%",
                                        height: "100%",
                                        objectFit: "cover",
                                        display: "block",
                                        filter: "brightness(0.88)",
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
                                        background: "linear-gradient(180deg, #11161d 0%, #0c1016 100%)",
                                      }}
                                    >
                                      <div
                                        style={{
                                          width: 72,
                                          height: 72,
                                          borderRadius: 24,
                                          background: "linear-gradient(135deg, #5865f2, #7b8aff)",
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          color: "#fff",
                                          fontWeight: 900,
                                          fontSize: 28,
                                          boxShadow: "0 16px 34px rgba(88,101,242,0.28)",
                                        }}
                                      >
                                        {getVoiceUserInitials(item.participantName)}
                                      </div>
                                    </div>
                                  )}

                                  <div
                                    style={{
                                      position: "absolute",
                                      inset: 0,
                                      background: "linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.15) 45%, rgba(0,0,0,0.82) 100%)",
                                    }}
                                  />

                                  <div
                                    style={{
                                      position: "absolute",
                                      top: 12,
                                      left: 12,
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 8,
                                      flexWrap: "wrap",
                                    }}
                                  >
                                    <span
                                      style={{
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
                                      }}
                                    >
                                      LIVE
                                    </span>
                                    {isOwnMedia ? (
                                      <span
                                        style={{
                                          height: 24,
                                          padding: "0 8px",
                                          borderRadius: 999,
                                          display: "inline-flex",
                                          alignItems: "center",
                                          background: "rgba(255,255,255,0.08)",
                                          border: "1px solid rgba(255,255,255,0.12)",
                                          color: "#ffffff",
                                          fontSize: 10,
                                          fontWeight: 800,
                                          letterSpacing: 0.3,
                                        }}
                                      >
                                        SEN
                                      </span>
                                    ) : null}
                                  </div>
                                </div>

                                <div
                                  style={{
                                    padding: "14px 14px 15px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 12,
                                  }}
                                >
                                  <div style={{ minWidth: 0 }}>
                                    <div
                                      style={{
                                        color: "#ffffff",
                                        fontSize: 16,
                                        fontWeight: 900,
                                        marginBottom: 5,
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                      }}
                                    >
                                      {item.participantName}
                                    </div>
                                    <div
                                      style={{
                                        color: "rgba(255,255,255,0.72)",
                                        fontSize: 12,
                                        fontWeight: 700,
                                      }}
                                    >
                                      Ekran paylaşımı
                                    </div>
                                  </div>

                                  <button
                                    onClick={() => {
                                      const nextJoinKey = getAnnouncementKey(item);
                                      const fallbackVisual = voiceVisuals.find(
                                        (entry) =>
                                          entry.trackSid === item.trackSid || getAnnouncementKey(entry) === nextJoinKey
                                      );
                                      const nextFocusedTrackSid = fallbackVisual?.trackSid || null;

                                      setJoinedAnnouncementTrackSid(item.trackSid);
                                      setJoinedAnnouncementKey(nextJoinKey);
                                      setFocusedVisualTrackSid(nextFocusedTrackSid);
                                      setIsJoinedStreamHovered(false);

                                      persistWatchedStreamMemory(selectedStreamMemoryKey, {
                                        joinedAnnouncementKey: nextJoinKey,
                                        joinedAnnouncementTrackSid: item.trackSid,
                                        focusedVisualTrackSid: nextFocusedTrackSid,
                                      });

                                      const dispatchReconcile = () =>
                                        window.dispatchEvent(
                                          new CustomEvent(REQUEST_VISUAL_RECONCILE_EVENT_NAME, {
                                            detail: { channelId: selectedChannel.id, trackSid: item.trackSid },
                                          })
                                        );
                                      dispatchReconcile();
                                      window.setTimeout(dispatchReconcile, 180);
                                      window.setTimeout(dispatchReconcile, 700);
                                      window.setTimeout(dispatchReconcile, 1400);
                                    }}
                                    style={{
                                      ...primaryButtonStyle,
                                      height: 40,
                                      padding: "0 16px",
                                      flexShrink: 0,
                                      boxShadow: "0 12px 26px rgba(88,101,242,0.22)",
                                    }}
                                  >
                                    İzle
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: 12,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    width: "100%",
                    margin: "0 auto",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                    justifyContent: "stretch",
                    gap: 12,
                    overflow: "hidden",
                  }}
                >
                  <div
                    onMouseEnter={() => setIsJoinedStreamHovered(true)}
                    onMouseLeave={() => setIsJoinedStreamHovered(false)}
                    style={{
                      position: "relative",
                      flex: 1,
                      minHeight: 0,
                      width: "100%",
                      borderRadius: 26,
                      overflow: "hidden",
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "#0b0f14",
                      display: "flex",
                      alignItems: "stretch",
                      justifyContent: "center",
                      minWidth: 0,
                      boxShadow: "0 20px 46px rgba(0,0,0,0.3)",
                    }}
                  >
                    {focusedVisual ? (
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          minHeight: 0,
                          display: "flex",
                          alignItems: "stretch",
                          justifyContent: "center",
                        }}
                      >
                        <StreamTile
                          mediaStream={focusedVisual.mediaStream}
                          label={`${focusedVisual.participantName} • ${
                            focusedVisual.source === "screen" ? "Ekran paylaşımı" : "Kamera"
                          }`}
                          isLarge
                          fit="contain"
                          posterDataUrl={joinedAnnouncement?.previewDataUrl ?? null}
                          posterHoldMs={1700}
                          muted={focusedVisual.source !== "screen"}
                          volume={getStreamVolume(focusedVisual)}
                          onVolumeChange={(value) => setStreamVolume(focusedVisual, value)}
                          showVolumeControls={focusedVisual.source === "screen"}
                        />
                      </div>
                    ) : shouldShowFocusedPreview ? (
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "flex",
                          flexDirection: "column",
                          minHeight: 0,
                          position: "relative",
                        }}
                      >
                        <div
                          style={{
                            flex: 1,
                            minHeight: 0,
                            background: "#090c12",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <img
                            src={focusedAnnouncementPreview || undefined}
                            alt={`${joinedAnnouncement?.participantName} preview`}
                            style={{
                              width: "100%",
                              height: "100%",
                              display: "block",
                              objectFit: "contain",
                              background: "#090c12",
                            }}
                          />
                        </div>
                        <div
                          style={{
                            position: "absolute",
                            left: 14,
                            right: 14,
                            bottom: 14,
                            padding: "10px 12px",
                            borderRadius: 12,
                            background: "linear-gradient(180deg, rgba(6,8,12,0.08) 0%, rgba(6,8,12,0.78) 100%)",
                            color: "#dbe3ee",
                            fontWeight: 800,
                            fontSize: 13,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {joinedAnnouncement?.participantName} • {joinedAnnouncement?.source === "screen" ? "Ekran paylaşımı" : "Kamera"}
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#8f98a6",
                          fontSize: 14,
                          textAlign: "center",
                          padding: 24,
                          boxSizing: "border-box",
                        }}
                      >
                        Yayın bulunamadı ya da görüntü henüz bağlanmadı.
                      </div>
                    )}

                    <div
                      style={{
                        position: "absolute",
                        top: 14,
                        left: 14,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                        zIndex: 5,
                      }}
                    >
                      <div
                        style={{
                          height: 28,
                          padding: "0 10px",
                          borderRadius: 999,
                          display: "inline-flex",
                          alignItems: "center",
                          background: "rgba(13,16,22,0.68)",
                          border: "1px solid rgba(255,255,255,0.12)",
                          backdropFilter: "blur(12px)",
                          color: "#ffffff",
                          fontSize: 11,
                          fontWeight: 900,
                          letterSpacing: 0.3,
                        }}
                      >
                        {joinedAnnouncement?.participantName || focusedVisual?.participantName || "Yayın"}
                      </div>
                      <div
                        style={{
                          height: 28,
                          padding: "0 10px",
                          borderRadius: 999,
                          display: "inline-flex",
                          alignItems: "center",
                          background: "rgba(237,66,69,0.18)",
                          border: "1px solid rgba(237,66,69,0.28)",
                          backdropFilter: "blur(12px)",
                          color: "#ffd9da",
                          fontSize: 11,
                          fontWeight: 900,
                          letterSpacing: 0.3,
                        }}
                      >
                        LIVE
                      </div>
                    </div>

                    <div
                      style={{
                        position: "absolute",
                        left: "50%",
                        bottom: 18,
                        transform: `translateX(-50%) translateY(${isJoinedStreamHovered ? "0" : "10px"})`,
                        opacity: isJoinedStreamHovered ? 1 : 0,
                        pointerEvents: isJoinedStreamHovered ? "auto" : "none",
                        transition: "opacity 180ms ease, transform 180ms ease",
                        zIndex: 6,
                      }}
                    >
                      <button
                        onClick={() => {
                          setJoinedAnnouncementTrackSid(null);
                          setJoinedAnnouncementKey(null);
                          setFocusedVisualTrackSid(null);
                          setVideoLockTrackSid(null);
                          setIsJoinedStreamHovered(false);
                          persistWatchedStreamMemory(selectedStreamMemoryKey, {
                            joinedAnnouncementTrackSid: null,
                            joinedAnnouncementKey: null,
                            focusedVisualTrackSid: null,
                          });
                        }}
                        style={{
                          ...secondaryButtonStyle,
                          height: 44,
                          padding: "0 18px",
                          borderRadius: 999,
                          background: "rgba(13,16,22,0.82)",
                          border: "1px solid rgba(255,255,255,0.14)",
                          backdropFilter: "blur(12px)",
                          boxShadow: "0 14px 36px rgba(0,0,0,0.34)",
                        }}
                      >
                        Yayından Ayrıl
                      </button>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) auto",
                      gap: 12,
                      alignItems: "stretch",
                      minHeight: 148,
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        borderRadius: 22,
                        border: "1px solid rgba(255,255,255,0.07)",
                        background: "linear-gradient(180deg, rgba(18,22,29,0.98) 0%, rgba(10,13,18,0.98) 100%)",
                        padding: 14,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          marginBottom: 12,
                        }}
                      >
                        <div>
                          <div style={{ color: "#ffffff", fontSize: 15, fontWeight: 900 }}>Medya Dock</div>
                          <div style={{ color: "#8f9bae", fontSize: 12, marginTop: 3 }}>
                            Yayınlar ve kameralar arasında hızlı geçiş yap.
                          </div>
                        </div>
                        <div style={{ color: "#96a3b6", fontSize: 11, fontWeight: 800 }}>
                          {mediaAnnouncements.length} medya
                        </div>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          gap: 12,
                          overflowX: "auto",
                          paddingBottom: 4,
                        }}
                      >
                        {mediaAnnouncements.map((item) => {
                          const streamKey = getAnnouncementKey(item);
                          const isSelected =
                            (joinedAnnouncement && getAnnouncementKey(joinedAnnouncement) === streamKey) ||
                            joinedAnnouncementTrackSid === item.trackSid;
                          const isOwnStream = localUserId === item.participantId;

                          return (
                            <button
                              key={streamKey}
                              onClick={() => {
                                joinMediaAnnouncement(item);
                              }}
                              style={{
                                width: 184,
                                borderRadius: 18,
                                overflow: "hidden",
                                border: isSelected
                                  ? "1px solid rgba(88,101,242,0.42)"
                                  : "1px solid rgba(255,255,255,0.08)",
                                background: isSelected ? "rgba(88,101,242,0.12)" : "rgba(255,255,255,0.04)",
                                boxShadow: isSelected ? "0 0 0 1px rgba(88,101,242,0.18)" : "none",
                                padding: 0,
                                cursor: "pointer",
                                flexShrink: 0,
                              }}
                            >
                              <div
                                style={{
                                  width: "100%",
                                  aspectRatio: "16 / 10",
                                  background: "#0c1016",
                                  position: "relative",
                                  overflow: "hidden",
                                }}
                              >
                                {item.previewDataUrl ? (
                                  <img
                                    src={item.previewDataUrl}
                                    alt={`${item.participantName} küçük önizleme`}
                                    style={{
                                      width: "100%",
                                      height: "100%",
                                      objectFit: "cover",
                                      display: "block",
                                      filter: isSelected ? "brightness(1)" : "brightness(0.82)",
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
                                      background: "linear-gradient(180deg, #11161d 0%, #0c1016 100%)",
                                    }}
                                  >
                                    <div
                                      style={{
                                        width: 52,
                                        height: 52,
                                        borderRadius: 18,
                                        background: "linear-gradient(135deg, #5865f2, #7b8aff)",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        color: "white",
                                        fontWeight: 900,
                                        fontSize: 20,
                                      }}
                                    >
                                      {getVoiceUserInitials(item.participantName)}
                                    </div>
                                  </div>
                                )}

                                <div
                                  style={{
                                    position: "absolute",
                                    top: 8,
                                    left: 8,
                                    height: 18,
                                    padding: "0 6px",
                                    borderRadius: 999,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    background: item.source === "screen" ? "#ed4245" : "#5865f2",
                                    color: "#fff",
                                    fontSize: 10,
                                    fontWeight: 900,
                                  }}
                                >
                                  {item.source === "screen" ? "LIVE" : "CAM"}
                                </div>

                                {isOwnStream ? (
                                  <div
                                    style={{
                                      position: "absolute",
                                      top: 8,
                                      right: 8,
                                      height: 18,
                                      padding: "0 6px",
                                      borderRadius: 999,
                                      display: "inline-flex",
                                      alignItems: "center",
                                      background: "rgba(88,101,242,0.18)",
                                      border: "1px solid rgba(88,101,242,0.28)",
                                      color: "#eef1ff",
                                      fontSize: 10,
                                      fontWeight: 800,
                                    }}
                                  >
                                    Sen
                                  </div>
                                ) : null}
                              </div>

                              <div
                                style={{
                                  padding: "10px 12px 12px",
                                  textAlign: "left",
                                }}
                              >
                                <div
                                  style={{
                                    color: "#ffffff",
                                    fontSize: 12,
                                    fontWeight: 900,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  {item.participantName}
                                </div>
                                <div style={{ color: "#8f9bae", fontSize: 11, marginTop: 4 }}>
                                  {item.source === "screen" ? "Ekran paylaşımı" : "Kamera"}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div
                      style={{
                        width: 224,
                        borderRadius: 22,
                        border: "1px solid rgba(255,255,255,0.07)",
                        background: "linear-gradient(180deg, rgba(18,22,29,0.98) 0%, rgba(10,13,18,0.98) 100%)",
                        padding: 14,
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        overflow: "hidden",
                      }}
                    >
                      <div>
                        <div style={{ color: "#ffffff", fontSize: 15, fontWeight: 900 }}>Oda Kullanıcıları</div>
                        <div style={{ color: "#8f9bae", fontSize: 12, marginTop: 3 }}>
                          İzlerken odadaki kişiler
                        </div>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 8, overflow: "auto" }}>
                        {currentVoiceMembers.length > 0 ? currentVoiceMembers.map((member) => {
                          const isSelf = localUserId === String(member.userId);
                          const isStreaming = mediaAnnouncements.some(
                            (item) => String(item.participantId) === String(member.userId)
                          );
                          return (
                            <div
                              key={member.userId}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                padding: "10px 10px",
                                borderRadius: 16,
                                background: isSelf ? "rgba(88,101,242,0.12)" : "rgba(255,255,255,0.04)",
                                border: isSelf ? "1px solid rgba(88,101,242,0.2)" : "1px solid rgba(255,255,255,0.05)",
                              }}
                            >
                              {member.avatarUrl ? (
                                <img
                                  src={member.avatarUrl}
                                  alt={member.displayName}
                                  style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: 14,
                                    objectFit: "cover",
                                    background: "#1c212a",
                                    flexShrink: 0,
                                  }}
                                />
                              ) : (
                                <div
                                  style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: 14,
                                    background: "linear-gradient(135deg, #5865f2, #7b8aff)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    color: "white",
                                    fontWeight: 800,
                                    fontSize: 14,
                                    flexShrink: 0,
                                  }}
                                >
                                  {getVoiceUserInitials(member.displayName)}
                                </div>
                              )}

                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div
                                  style={{
                                    color: "#ffffff",
                                    fontSize: 13,
                                    fontWeight: 800,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  {member.displayName}
                                </div>
                                <div style={{ color: "#8f9bae", fontSize: 11, marginTop: 3 }}>
                                  {isStreaming ? "Yayında" : member.muted ? "Mic kapalı" : member.deafened ? "Kulaklık kapalı" : "Bağlı"}
                                </div>
                              </div>
                            </div>
                          );
                        }) : (
                          <div style={{ color: "#94a0b3", fontSize: 13, lineHeight: 1.6 }}>
                            Oda kullanıcıları burada görünecek.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : loading ? (
          <div style={{ color: "#8f98a6", fontSize: 14 }}>Mesajlar yükleniyor...</div>
        ) : (
          <>
            <div ref={messagesContentRef} style={{ width: "100%", maxWidth: "none", margin: "0", display: "flex", flexDirection: "column", gap: 4, alignItems: "stretch" }}>
            {filteredMessages.length === 0 ? (
              <div style={{ borderRadius: 20, padding: 18, background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.02))", border: "1px solid rgba(255,255,255,0.05)", color: "#97a0ae", fontSize: 14, lineHeight: 1.7 }}>
                {searchText.trim() ? "Aramana uygun mesaj bulunamadı." : "Bu kanalda henüz mesaj yok. İlk mesajı sen gönder."}
              </div>
            ) : (
              filteredMessages.map((message, index) => {
                const isDeleted = Boolean(message.deletedAt);
                const isPinned = Boolean(message.isPinned);
                const isEditing = draftState.editingMessageId === message.id;
                const isOwnMessage = localUserId === message.userId;
                const previousMessage = filteredMessages[index - 1];
                const showDaySeparator = !previousMessage || !isSameCalendarDay(previousMessage.createdAt, message.createdAt);
                const isGrouped = !!previousMessage && !showDaySeparator && previousMessage.userId === message.userId && !previousMessage.deletedAt;
                const isEmojiOnly = isEmojiOnlyMessage(message.content);
                return (
                  <div key={message.id} data-message-index={index} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {showDaySeparator ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: index === 0 ? "6px 12px 12px" : "16px 12px 12px" }}>
                        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.09)" }} />
                        <div style={{ flexShrink: 0, color: "#aeb8c8", fontSize: 12, fontWeight: 800, letterSpacing: 0.2, whiteSpace: "nowrap" }}>
                          {formatDaySeparatorLabel(message.createdAt)}
                        </div>
                        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.09)" }} />
                      </div>
                    ) : null}
                    <div id={`msg-${message.id}`} onMouseEnter={() => setHoveredMessageId(message.id)} onMouseLeave={() => setHoveredMessageId((current) => (current === message.id ? null : current))} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: isGrouped ? "2px 12px 4px" : "8px 12px 6px", borderRadius: 16, background: hoveredMessageId === message.id ? "rgba(255,255,255,0.025)" : "transparent", transition: "background 140ms ease", position: "relative" }}>
                    <div style={{ width: 42, flexShrink: 0 }}>{!isGrouped ? <MessageAvatar name={message.displayName} avatarUrl={message.avatarUrl} /> : null}</div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      {!isGrouped ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
                          <span style={{ color: message.highestRoleColor || "#ffffff", fontWeight: 800, fontSize: 16 }}>{message.displayName}</span>
                          <span style={{ color: "#7f8794", fontSize: 13, fontWeight: 600 }}>{formatMessageTime(message.createdAt)}</span>
                          {message.editedAt ? <span style={{ color: "#7f8794", fontSize: 11, fontWeight: 700 }}>düzenlendi</span> : null}
                          {isPinned ? <span style={{ color: "#f7d68c", fontSize: 11, fontWeight: 800, background: "rgba(247,214,140,0.12)", border: "1px solid rgba(247,214,140,0.2)", borderRadius: 999, padding: "3px 8px" }}>PIN</span> : null}
                        </div>
                      ) : null}

                      {message.replyTo && !isDeleted ? (
                        <button onClick={() => document.getElementById(`msg-${message.replyTo?.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} style={{ textAlign: "left", marginBottom: 8, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: "8px 10px", color: "#cfd7e2", width: "100%", cursor: "pointer" }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: "#dce7ff", marginBottom: 3 }}>↪ {message.replyTo.displayName}{message.replyTo.username ? ` • @${message.replyTo.username}` : ""}</div>
                          <div style={{ fontSize: 12, color: "#94a0b0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{message.replyTo.content || "Bu mesaj silindi."}</div>
                        </button>
                      ) : null}

                      <div style={{ width: "100%" }}>
                        {isEditing ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            <textarea value={draftState.editText} onChange={(e) => setDraftState((prev) => ({ ...prev, editText: e.target.value }))} style={{ width: "100%", minHeight: 74, resize: "vertical", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "#e6ebf2", padding: 12, boxSizing: "border-box", outline: "none", fontFamily: "inherit", fontSize: 14 }} />
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button onClick={() => void saveEditMessage(message.id)} style={smallPrimaryButtonStyle}>Kaydet</button>
                              <button onClick={cancelEditMessage} style={smallSecondaryButtonStyle}>İptal</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {message.content ? <div style={getMessageTextStyle(message.content)}>{highlightMentions(message.content)}</div> : null}
                            {message.attachments?.length ? <MessageAttachments attachments={message.attachments} onOpenImage={(src, title) => setMediaLightbox({ src, title })} /> : null}
                            {!message.content && !message.attachments?.length ? (
                              <div style={{ color: "#8f98a6", fontSize: 13 }}>Boş mesaj</div>
                            ) : null}
                            {extractUrls(message.content || "").map((url) => (
                              <LinkPreviewCard key={`${message.id}-${url}`} url={url} />
                            ))}
                          </>
                        )}
                      </div>
                    </div>
                    {!isDeleted && hoveredMessageId === message.id ? (
                      <div style={{ position: "absolute", top: -6, right: 10, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "6px", borderRadius: 12, background: "#171b22", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 14px 34px rgba(0,0,0,0.28)" }}>
                        <button onClick={() => startReplyToMessage(message.id)} style={messageActionButtonStyle} title="Yanıtla">↩</button>
                        <button onClick={() => copyMessage(message.content)} style={messageActionButtonStyle} title="Kopyala">⧉</button>
                        <button onClick={() => void togglePinMessage(message)} style={messageActionButtonStyle} title={isPinned ? "Pin kaldır" : "Pinle"}>📌</button>
                        {isOwnMessage ? (
                          <>
                            <button onClick={() => startEditMessage(message)} style={messageActionButtonStyle} title="Düzenle">✎</button>
                            <button onClick={() => void deleteMessage(message.id)} style={messageActionButtonStyle} title="Sil">🗑</button>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>
          </>
        )}

        {showJumpToLatest && !isVoice ? (
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
                  scrollToBottom("smooth");
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
      </div>

      {!isVoice && (
        <div style={{ borderTop: "1px solid #232833", padding: "12px 16px 16px", background: "rgba(255,255,255,0.015)", boxSizing: "border-box", position: "relative" }}>
          {replyTargetMessage ? (
            <div style={{ marginBottom: 10, borderRadius: 14, padding: "10px 12px", background: "rgba(88,101,242,0.12)", border: "1px solid rgba(88,101,242,0.18)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "#dbe6ff", fontSize: 12, fontWeight: 800, marginBottom: 4 }}>Yanıtlanıyor: {replyTargetMessage.displayName}</div>
                <div style={{ color: "#aeb8c8", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 520 }}>
                  {replyTargetMessage.deletedAt
                    ? "Bu mesaj silindi."
                    : replyTargetMessage.content || (replyTargetMessage.attachments?.length ? "Ekli medya / dosya" : "")}
                </div>
              </div>
              <button onClick={() => setDraftState((prev) => ({ ...prev, replyToMessageId: null }))} style={smallSecondaryButtonStyle}>Kapat</button>
            </div>
          ) : null}

          {showEmojiPicker ? (
            <div
              style={{
                position: "absolute",
                right: 74,
                bottom: 88,
                width: 352,
                maxWidth: "calc(100vw - 320px)",
                borderRadius: 18,
                overflow: "hidden",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: "0 18px 40px rgba(0,0,0,0.28)",
                zIndex: 30,
              }}
            >
              <EmojiPicker
                theme={Theme.DARK}
                onEmojiClick={handleEmojiClick}
                lazyLoadEmojis
                autoFocusSearch={false}
                searchPlaceholder="Emoji ara"
                width="100%"
                height={380}
                previewConfig={{ showPreview: false }}
              />
            </div>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handlePickFiles}
            accept="image/*,video/*,.pdf,.zip,.rar,.7z,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
            style={{ display: "none" }}
          />

          <div
            onDragEnter={handleComposerDragEnter}
            onDragOver={handleComposerDragOver}
            onDragLeave={handleComposerDragLeave}
            onDrop={handleComposerDrop}
            style={{
              position: "relative",
              marginTop: 2,
              borderRadius: 24,
              transition: "box-shadow 160ms ease, transform 160ms ease",
              boxShadow: isDraggingComposerFiles ? "0 0 0 1px rgba(88,101,242,0.5), 0 0 0 6px rgba(88,101,242,0.12)" : "none",
            }}
          >
            {pendingAttachments.length > 0 ? (
              <div style={{ marginBottom: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(108px, 108px))", justifyContent: "flex-start", gap: 8, maxHeight: 150, overflowY: "auto", paddingRight: 4 }}>
                {pendingAttachments.map((item) => (
                  <PendingAttachmentCard key={item.id} item={item} onRemove={removePendingAttachment} />
                ))}
              </div>
            ) : null}

            <div style={{ width: "100%", background: isDraggingComposerFiles ? "linear-gradient(180deg, #1b2230 0%, #171d28 100%)" : "linear-gradient(180deg, #171b22 0%, #15181f 100%)", border: isDraggingComposerFiles ? "1px solid rgba(88,101,242,0.55)" : "1px solid #2a2f39", borderRadius: 20, minHeight: pendingAttachments.length > 0 ? 58 : 64, display: "flex", alignItems: "flex-end", gap: 10, padding: "8px 10px", boxSizing: "border-box", transition: "border-color 160ms ease, background 160ms ease, box-shadow 160ms ease" }}>
              <button onClick={openFilePicker} style={composerIconButtonStyle} title="Dosya / medya ekle">
                <Paperclip size={18} />
              </button>
              <textarea ref={textareaRef} value={messageText} onChange={(e) => setMessageText(e.target.value)} onKeyDown={onComposerKeyDown} placeholder={isDraggingComposerFiles ? "Dosyaları bırak" : `#${selectedChannel.name} kanalına mesaj gönder`} style={{ flex: 1, minWidth: 220, minHeight: 22, maxHeight: 100, resize: "none", background: "transparent", border: "none", outline: "none", color: "#e6ebf2", fontSize: 14, lineHeight: 1.5, fontFamily: "inherit", padding: "7px 0" }} />
              <button onClick={() => setShowEmojiPicker((prev) => !prev)} style={composerIconButtonStyle} title="Emoji">
                <Smile size={18} />
              </button>
              <button onClick={() => void sendMessage()} disabled={sending || (!messageText.trim() && pendingAttachments.length === 0)} style={{ width: 42, height: 42, borderRadius: 13, border: "none", display: "flex", alignItems: "center", justifyContent: "center", background: sending || (!messageText.trim() && pendingAttachments.length === 0) ? "rgba(255,255,255,0.08)" : "linear-gradient(135deg,#5865f2,#7b8aff)", color: "white", cursor: sending || (!messageText.trim() && pendingAttachments.length === 0) ? "not-allowed" : "pointer", flexShrink: 0, boxShadow: sending || (!messageText.trim() && pendingAttachments.length === 0) ? "none" : "0 10px 24px rgba(88,101,242,0.28)" }} title="Gönder">
                <SendHorizontal size={18} />
              </button>
            </div>

            {isDraggingComposerFiles ? (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 24,
                  border: "2px dashed rgba(123,138,255,0.8)",
                  background: "rgba(17, 22, 31, 0.72)",
                  backdropFilter: "blur(6px)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "column",
                  gap: 10,
                  pointerEvents: "none",
                  zIndex: 6,
                }}
              >
                <div style={{ width: 52, height: 52, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, rgba(88,101,242,0.32), rgba(123,138,255,0.24))", color: "#ffffff", boxShadow: "0 12px 28px rgba(88,101,242,0.2)" }}>
                  <ImagePlus size={24} />
                </div>
                <div style={{ color: "#ffffff", fontSize: 16, fontWeight: 900 }}>Dosyaları buraya bırak</div>
                <div style={{ color: "#b8c2d3", fontSize: 12, fontWeight: 700 }}>Resim, video ve dosyalar preview olarak eklenecek</div>
              </div>
            ) : null}
          </div>

          {error ? <div style={{ marginTop: 10, color: "#ffb3b5", fontSize: 12 }}>{error}</div> : null}
        </div>
      )}

      <MediaLightbox state={mediaLightbox} onClose={() => setMediaLightbox(null)} />
    </div>
  );
}

const panelStyle: CSSProperties = {
  borderRadius: 22,
  border: "1px solid rgba(255,255,255,0.06)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.015))",
  padding: 18,
};

const toolbarIconButtonStyle: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.06)",
  background: "rgba(255,255,255,0.04)",
  color: "#dbe3ee",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  flexShrink: 0,
};

const primaryButtonStyle: CSSProperties = {
  height: 42,
  borderRadius: 14,
  border: "none",
  background: "linear-gradient(135deg,#5865f2,#7b8aff)",
  color: "white",
  fontWeight: 800,
  padding: "0 16px",
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  height: 42,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.04)",
  color: "#dbe3ee",
  fontWeight: 800,
  padding: "0 16px",
  cursor: "pointer",
};

const smallPrimaryButtonStyle: CSSProperties = {
  height: 36,
  borderRadius: 12,
  border: "none",
  background: "linear-gradient(135deg,#5865f2,#7b8aff)",
  color: "white",
  fontWeight: 800,
  padding: "0 12px",
  cursor: "pointer",
};

const smallSecondaryButtonStyle: CSSProperties = {
  height: 36,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.04)",
  color: "#dbe3ee",
  fontWeight: 800,
  padding: "0 12px",
  cursor: "pointer",
};

const composerIconButtonStyle: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.06)",
  background: "rgba(255,255,255,0.03)",
  color: "#dbe3ee",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const messageActionButtonStyle: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.06)",
  background: "rgba(255,255,255,0.03)",
  color: "#dbe3ee",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 800,
};
