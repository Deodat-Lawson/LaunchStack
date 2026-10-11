import type { BrandChannel } from "../api";

/**
 * Compose's rules about text and images, kept out of the screen so each is
 * tested: where LinkedIn folds a post behind "…see more", which files can be
 * attached, and what a channel will do with the images it is given.
 */

/** LinkedIn's feed folds a post after about this many characters… */
export const SEE_MORE_CHARS = 210;
/** …or after this many lines, whichever comes first. */
export const SEE_MORE_LINES = 3;

/**
 * The part of a post a feed shows before "…see more". Cuts at the last word
 * break before the limit (or the third line break), so the fold never
 * splits a word; `more` says whether anything was folded.
 */
export function previewText(
    text: string,
    maxChars = SEE_MORE_CHARS,
    maxLines = SEE_MORE_LINES
): { shown: string; more: boolean } {
    const t = text.trim();
    let end = t.length;
    let breaks = 0;
    for (let i = 0; i < t.length && i < end; i++) {
        if (t[i] === "\n" && ++breaks === maxLines) end = i;
    }
    if (end > maxChars) end = maxChars;
    if (end >= t.length) return { shown: t, more: false };
    let cut = t.slice(0, end);
    if (end === maxChars && /\S/.test(t.charAt(end))) {
        const space = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"));
        if (space > maxChars * 0.6) cut = cut.slice(0, space);
    }
    return { shown: cut.trimEnd(), more: true };
}

export const MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
export const MEDIA_ACCEPT = MEDIA_TYPES.join(",");
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const MEDIA_MAX_COUNT = 4;

/** Why a file cannot be attached, or null when it can. */
export function mediaRejection(file: { type: string; size: number; name?: string }): string | null {
    const name = file.name ? `${file.name}: ` : "";
    if (!(MEDIA_TYPES as readonly string[]).includes(file.type))
        return `${name}attach a JPEG, PNG, GIF or WebP image.`;
    if (file.size > MEDIA_MAX_BYTES) return `${name}images can be 5 MB at most.`;
    return null;
}

/** "1.2 MB", "340 KB". */
export function fileSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * What a channel will do with the attached images. A channel without image
 * support posts the text only (a note); LinkedIn refuses WebP (an error,
 * which blocks sending).
 */
export function channelMediaNote(
    channel: Pick<BrandChannel, "name" | "platform" | "capabilities">,
    media: ReadonlyArray<{ mimeType: string }>
): { tone: "note" | "error"; text: string } | null {
    if (media.length === 0) return null;
    if (!channel.capabilities.images)
        return { tone: "note", text: `${channel.name} will post the text only.` };
    if (channel.platform === "linkedin" && media.some(m => m.mimeType === "image/webp"))
        return {
            tone: "error",
            text: "LinkedIn does not take WebP images. Use JPEG, PNG or GIF.",
        };
    return null;
}

/** The characters a channel counts against its limit. */
export function postLength(body: string): number {
    return body.trim().length;
}

export function overLimit(channel: Pick<BrandChannel, "limit">, body: string): boolean {
    return channel.limit !== null && postLength(body) > channel.limit;
}
