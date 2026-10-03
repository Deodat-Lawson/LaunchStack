import type { MediaKind } from "~/lib/media-document";

/**
 * The player for a video imported by URL.
 *
 * A YouTube-style import keeps only the transcript; the recording stays on the
 * platform. To watch it in place the viewer frames the platform's own embed
 * player, which is built from the page URL here. Only platforms with a plain
 * iframe player that needs no script on this page are embedded; anything else
 * — TikTok, X, Instagram and the rest of the import allowlist — gets a link out
 * to the page instead (`mediaPlatformLabel`).
 *
 * Every embed URL is rebuilt from a validated id rather than echoed from the
 * stored URL, so nothing the importer typed reaches the frame's `src`.
 */

export type EmbedProvider = "youtube" | "vimeo" | "dailymotion" | "soundcloud";

export interface MediaEmbed {
    provider: EmbedProvider;
    /** The platform's name, for labels and the "Watch on …" link. */
    label: string;
    kind: MediaKind;
    /** The player to frame. */
    embedUrl: string;
    /** The page itself, for opening in a new tab. */
    watchUrl: string;
    /** Where playback starts, from a `t=` in the imported link. */
    startSeconds: number;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const DIGITS = /^\d+$/;
const DAILYMOTION_ID = /^[a-zA-Z0-9]+$/;

function hostOf(url: URL): string {
    return url.hostname.toLowerCase().replace(/^(?:www\.|m\.)/, "");
}

/** `90`, `90s`, `1m30s`, `1h2m3s` → seconds; 0 when absent or unreadable. */
export function parseStartTime(raw: string | null | undefined): number {
    if (!raw) return 0;
    const value = raw.trim();
    if (DIGITS.test(value)) return Number(value);
    const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(value);
    if (!match || value === "") return 0;
    const [, h = "0", m = "0", s = "0"] = match;
    return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

function youtubeId(url: URL): string | null {
    const host = hostOf(url);
    let candidate: string | undefined;
    if (host === "youtu.be") {
        candidate = url.pathname.split("/")[1];
    } else if (
        host === "youtube.com" ||
        host === "music.youtube.com" ||
        host === "youtube-nocookie.com"
    ) {
        if (url.pathname === "/watch") {
            candidate = url.searchParams.get("v") ?? undefined;
        } else {
            const [, section, id] = url.pathname.split("/");
            if (section && ["shorts", "live", "embed", "v"].includes(section)) candidate = id;
        }
    }
    return candidate && YOUTUBE_ID.test(candidate) ? candidate : null;
}

function vimeoEmbed(url: URL): { id: string; hash: string | null } | null {
    const host = hostOf(url);
    const parts = url.pathname.split("/").filter(Boolean);
    if (host === "player.vimeo.com") {
        // player.vimeo.com/video/{id}?h={hash}
        if (parts[0] !== "video" || !parts[1] || !DIGITS.test(parts[1])) return null;
        return { id: parts[1], hash: url.searchParams.get("h") };
    }
    if (host !== "vimeo.com") return null;
    // vimeo.com/{id}, vimeo.com/{id}/{hash}, vimeo.com/channels/x/{id}, vimeo.com/groups/x/videos/{id}
    const idAt = parts.findIndex(part => DIGITS.test(part));
    if (idAt === -1) return null;
    const next = parts[idAt + 1];
    const hash = next && /^[a-f0-9]+$/i.test(next) ? next : url.searchParams.get("h");
    return { id: parts[idAt]!, hash };
}

function dailymotionId(url: URL): string | null {
    const host = hostOf(url);
    const parts = url.pathname.split("/").filter(Boolean);
    let candidate: string | undefined;
    if (host === "dai.ly") candidate = parts[0];
    else if (host === "dailymotion.com" && parts[0] === "video") candidate = parts[1];
    else if (host === "dailymotion.com" && parts[0] === "embed" && parts[1] === "video")
        candidate = parts[2];
    // A slug can follow the id: /video/x8abc12_some-title
    const id = candidate?.split("_")[0];
    return id && DAILYMOTION_ID.test(id) ? id : null;
}

function soundcloudTrack(url: URL): string | null {
    if (hostOf(url) !== "soundcloud.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    // soundcloud.com/{artist}/{track}; sets and profiles are not single recordings.
    if (parts.length !== 2 || parts[1] === "sets") return null;
    return `https://soundcloud.com/${parts.map(encodeURIComponent).join("/")}`;
}

/** The embeddable player for a video page URL, or null when the platform has none here. */
export function mediaEmbedFor(rawUrl: string | null | undefined): MediaEmbed | null {
    let url: URL;
    try {
        url = new URL(rawUrl ?? "");
    } catch {
        return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const startSeconds = parseStartTime(url.searchParams.get("t") ?? url.searchParams.get("start"));

    const yt = youtubeId(url);
    if (yt) {
        const embed = new URL(`https://www.youtube-nocookie.com/embed/${yt}`);
        embed.searchParams.set("rel", "0");
        // Lets the viewer seek from the transcript over postMessage.
        embed.searchParams.set("enablejsapi", "1");
        if (startSeconds > 0) embed.searchParams.set("start", String(startSeconds));
        return {
            provider: "youtube",
            label: "YouTube",
            kind: "video",
            embedUrl: embed.toString(),
            watchUrl: `https://www.youtube.com/watch?v=${yt}${startSeconds > 0 ? `&t=${startSeconds}s` : ""}`,
            startSeconds,
        };
    }

    const vimeo = vimeoEmbed(url);
    if (vimeo) {
        const embed = new URL(`https://player.vimeo.com/video/${vimeo.id}`);
        if (vimeo.hash) embed.searchParams.set("h", vimeo.hash);
        const hashPath = vimeo.hash ? `/${vimeo.hash}` : "";
        return {
            provider: "vimeo",
            label: "Vimeo",
            kind: "video",
            embedUrl: `${embed.toString()}${startSeconds > 0 ? `#t=${startSeconds}s` : ""}`,
            watchUrl: `https://vimeo.com/${vimeo.id}${hashPath}`,
            startSeconds,
        };
    }

    const dm = dailymotionId(url);
    if (dm) {
        const embed = new URL(`https://www.dailymotion.com/embed/video/${dm}`);
        if (startSeconds > 0) embed.searchParams.set("start", String(startSeconds));
        return {
            provider: "dailymotion",
            label: "Dailymotion",
            kind: "video",
            embedUrl: embed.toString(),
            watchUrl: `https://www.dailymotion.com/video/${dm}`,
            startSeconds,
        };
    }

    const track = soundcloudTrack(url);
    if (track) {
        const embed = new URL("https://w.soundcloud.com/player/");
        embed.searchParams.set("url", track);
        embed.searchParams.set("visual", "false");
        return {
            provider: "soundcloud",
            label: "SoundCloud",
            kind: "audio",
            embedUrl: embed.toString(),
            watchUrl: track,
            startSeconds: 0,
        };
    }

    return null;
}

const PLATFORM_LABELS: [RegExp, string][] = [
    [/(?:^|\.)(?:youtube\.com|youtu\.be)$/, "YouTube"],
    [/(?:^|\.)vimeo\.com$/, "Vimeo"],
    [/(?:^|\.)tiktok\.com$/, "TikTok"],
    [/(?:^|\.)(?:twitter\.com|x\.com)$/, "X"],
    [/(?:^|\.)(?:dailymotion\.com|dai\.ly)$/, "Dailymotion"],
    [/(?:^|\.)twitch\.tv$/, "Twitch"],
    [/(?:^|\.)(?:facebook\.com|fb\.watch)$/, "Facebook"],
    [/(?:^|\.)instagram\.com$/, "Instagram"],
    [/(?:^|\.)soundcloud\.com$/, "SoundCloud"],
    [/(?:^|\.)bilibili\.com$/, "Bilibili"],
];

/** The platform's name for a page URL, for "Watch on …"; the host when it is not one we know. */
export function mediaPlatformLabel(rawUrl: string): string {
    try {
        const host = new URL(rawUrl).hostname.toLowerCase();
        return PLATFORM_LABELS.find(([pattern]) => pattern.test(host))?.[1] ?? host;
    } catch {
        return "the original site";
    }
}
