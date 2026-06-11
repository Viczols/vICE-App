import type { FastifyPluginAsync } from "fastify";

type LinkPreviewPayload = {
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

type SpecialEmbed = {
  embedUrl: string;
  imageUrl?: string | null;
  theme: NonNullable<LinkPreviewPayload["theme"]>;
  canInlinePlay: boolean;
  embedKind: "iframe" | "video" | "tweet";
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(value: string) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanText(value: string | null | undefined) {
  return decodeHtmlEntities(String(value || "").replace(/\s+/g, " ").trim());
}

function normalizeUrl(input: string, candidate: string | null | undefined) {
  const raw = String(candidate || "").trim();
  if (!raw) return null;
  try {
    return new URL(raw, input).toString();
  } catch {
    return null;
  }
}

function readMeta(html: string, key: string) {
  const safeKey = escapeRegExp(key);
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${safeKey}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${safeKey}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+name=["']${safeKey}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${safeKey}["'][^>]*>`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return cleanText(match[1]);
  }

  return null;
}

function readTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? cleanText(match[1]) : null;
}

function readDirectVideoSource(html: string, baseUrl: string) {
  const sourceMatch = html.match(/<source[^>]+src=["']([^"']+)["'][^>]*>/i);
  if (sourceMatch?.[1]) return normalizeUrl(baseUrl, sourceMatch[1]);
  const videoMatch = html.match(/<video[^>]+src=["']([^"']+)["'][^>]*>/i);
  if (videoMatch?.[1]) return normalizeUrl(baseUrl, videoMatch[1]);
  return null;
}

function extractTwitterStatusUrl(urlValue: string) {
  try {
    const url = new URL(urlValue);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (!(host.includes("twitter.com") || host.includes("x.com"))) return null;

    const parts = url.pathname.split("/").filter(Boolean);
    const statusIndex = parts.findIndex((part) => part === "status");
    if (statusIndex === -1 || !parts[statusIndex + 1]) return null;

    const username = parts[0];
    const statusId = parts[statusIndex + 1];
    const canonicalHost = host.includes("x.com") ? "x.com" : "twitter.com";
    return `https://${canonicalHost}/${username}/status/${statusId}`;
  } catch {
    return null;
  }
}

function getYouTubeEmbed(urlValue: string): SpecialEmbed | null {
  try {
    const url = new URL(urlValue);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    let videoId: string | null = null;

    if (host === "youtu.be") {
      videoId = url.pathname.split("/").filter(Boolean)[0] || null;
    } else if (host.includes("youtube.com")) {
      videoId = url.searchParams.get("v");
      if (!videoId) {
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts[0] === "shorts" && parts[1]) videoId = parts[1];
        else if (parts[0] === "embed" && parts[1]) videoId = parts[1];
      }
    }

    if (!videoId) return null;

    return {
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`,
      imageUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      theme: "youtube",
      canInlinePlay: true,
      embedKind: "iframe",
    };
  } catch {
    return null;
  }
}

function getVimeoEmbed(urlValue: string): SpecialEmbed | null {
  try {
    const url = new URL(urlValue);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (!host.includes("vimeo.com")) return null;
    const videoId = url.pathname.split("/").filter(Boolean).find((part) => /^\d+$/.test(part)) || null;
    if (!videoId) return null;
    return {
      embedUrl: `https://player.vimeo.com/video/${videoId}?autoplay=1`,
      imageUrl: null,
      theme: "vimeo",
      canInlinePlay: true,
      embedKind: "iframe",
    };
  } catch {
    return null;
  }
}

function getTwitchEmbed(urlValue: string): SpecialEmbed | null {
  try {
    const url = new URL(urlValue);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (!host.includes("twitch.tv")) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (!parts.length) return null;

    const parent = "localhost";

    if (parts[0] === "videos" && parts[1]) {
      return {
        embedUrl: `https://player.twitch.tv/?video=v${parts[1]}&parent=${parent}&autoplay=true`,
        imageUrl: null,
        theme: "twitch",
        canInlinePlay: true,
        embedKind: "iframe",
      };
    }

    const channel = parts[0];
    return {
      embedUrl: `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${parent}&autoplay=true`,
      imageUrl: null,
      theme: "twitch",
      canInlinePlay: true,
      embedKind: "iframe",
    };
  } catch {
    return null;
  }
}

function getTwitterEmbed(urlValue: string): SpecialEmbed | null {
  try {
    const url = new URL(urlValue);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (!(host.includes("twitter.com") || host.includes("x.com"))) return null;

    const canonicalStatusUrl = extractTwitterStatusUrl(urlValue) || url.toString();

    return {
      embedUrl: canonicalStatusUrl,
      imageUrl: null,
      theme: host.includes("x.com") ? "x" : "twitter",
      canInlinePlay: true,
      embedKind: "tweet",
    };
  } catch {
    return null;
  }
}

function inferTheme(host: string): LinkPreviewPayload["theme"] {
  if (host.includes("youtube.com") || host === "youtu.be") return "youtube";
  if (host.includes("kick.com")) return "kick";
  if (host.includes("twitter.com")) return "twitter";
  if (host.includes("x.com")) return "x";
  if (host.includes("twitch.tv")) return "twitch";
  if (host.includes("vimeo.com")) return "vimeo";
  return "generic";
}

const linkPreviewRoutes: FastifyPluginAsync = async (app) => {
  app.get("/link-preview", { preHandler: [app.auth] }, async (request, reply) => {
    const rawUrl = String((request.query as any)?.url ?? "").trim();

    if (!rawUrl) {
      return reply.code(400).send({ error: "URL_REQUIRED" });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return reply.code(400).send({ error: "INVALID_URL" });
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return reply.code(400).send({ error: "INVALID_URL_PROTOCOL" });
    }

    const normalizedSourceUrl = parsedUrl.toString();
    const host = parsedUrl.hostname.replace(/^www\./, "").toLowerCase();
    const basePayload: LinkPreviewPayload = {
      url: normalizedSourceUrl,
      siteName: host,
      title: `${host} bağlantısı`,
      description:
        parsedUrl.pathname && parsedUrl.pathname !== "/"
          ? decodeURIComponent(parsedUrl.pathname.slice(1).replace(/[-_]+/g, " "))
          : "Bağlantıyı aç",
      imageUrl: null,
      embedUrl: null,
      embedKind: null,
      canInlinePlay: false,
      theme: inferTheme(host),
    };

    const specialEmbed =
      getYouTubeEmbed(normalizedSourceUrl) ||
      getVimeoEmbed(normalizedSourceUrl) ||
      getTwitchEmbed(normalizedSourceUrl) ||
      getTwitterEmbed(normalizedSourceUrl);

    try {
      const response = await fetch(normalizedSourceUrl, {
        redirect: "follow",
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; vICE-LinkPreview/1.0)",
          "accept-language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });

      const finalUrl = response.url || normalizedSourceUrl;
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();

      if (contentType.startsWith("video/")) {
        return {
          ...basePayload,
          description: "Video bağlantısını uygulama içinde oynat",
          imageUrl: specialEmbed?.imageUrl ?? null,
          embedUrl: specialEmbed?.embedUrl ?? finalUrl,
          embedKind: specialEmbed?.embedKind ?? "video",
          canInlinePlay: true,
          theme: specialEmbed?.theme ?? basePayload.theme,
        } satisfies LinkPreviewPayload;
      }

      const html = await response.text();
      const ogTitle = readMeta(html, "og:title");
      const ogDescription = readMeta(html, "og:description");
      const ogImage = normalizeUrl(finalUrl, readMeta(html, "og:image") || readMeta(html, "twitter:image"));
      const ogVideo = normalizeUrl(finalUrl, readMeta(html, "og:video") || readMeta(html, "og:video:url") || readMeta(html, "twitter:player:stream"));
      const twitterPlayer = normalizeUrl(finalUrl, readMeta(html, "twitter:player"));
      const directVideo = readDirectVideoSource(html, finalUrl);
      const finalEmbedUrl = specialEmbed?.embedUrl ?? twitterPlayer ?? ogVideo ?? directVideo ?? null;
      const finalEmbedKind = specialEmbed?.embedKind ?? (finalEmbedUrl ? ((finalEmbedUrl === ogVideo || finalEmbedUrl === directVideo) ? "video" : "iframe") : null);
      const finalCanInlinePlay = Boolean(specialEmbed?.canInlinePlay || finalEmbedUrl);

      return {
        ...basePayload,
        url: finalUrl,
        title: ogTitle || readTitle(html) || basePayload.title,
        description: ogDescription || basePayload.description,
        imageUrl: specialEmbed?.imageUrl ?? ogImage ?? null,
        embedUrl: finalEmbedUrl,
        embedKind: finalEmbedKind,
        canInlinePlay: finalCanInlinePlay,
        theme: specialEmbed?.theme ?? inferTheme(new URL(finalUrl).hostname.replace(/^www\./, "").toLowerCase()),
      } satisfies LinkPreviewPayload;
    } catch (error) {
      request.log.error(error, "link preview fetch failed");
      return {
        ...basePayload,
        ...specialEmbed,
      } satisfies LinkPreviewPayload;
    }
  });
};

export default linkPreviewRoutes;
