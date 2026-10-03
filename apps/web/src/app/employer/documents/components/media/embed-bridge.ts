/**
 * Talking to a framed platform player over `postMessage`, so the transcript
 * can seek it and follow along — without loading the platform's own API
 * script onto this page.
 *
 * YouTube's player speaks the protocol its IFrame API uses internally
 * (`enablejsapi=1` on the embed URL turns it on); Vimeo's player speaks the
 * one documented for player.js. Other platforms play, but are not driven.
 * Messages are only ever read from the frame's own window and origin.
 */

export interface EmbedBridge {
    /** The only origin messages are posted to and accepted from. */
    origin: string;
    /** Sent once the frame loads (and a few times after), to start receiving the playhead. */
    subscribe(): string[];
    seek(seconds: number, play: boolean): string[];
    /** The playhead in a message the frame posted, or null when it carries none. */
    readTime(data: unknown): number | null;
}

function parse(data: unknown): Record<string, unknown> | null {
    if (typeof data === "string") {
        try {
            const value: unknown = JSON.parse(data);
            return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
        } catch {
            return null;
        }
    }
    return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
}

function finiteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** How the IFrame API addresses the one player in a frame. */
const WIDGET = { id: 1, channel: "widget" } as const;

const youtube: EmbedBridge = {
    origin: "https://www.youtube-nocookie.com",
    subscribe: () => [JSON.stringify({ event: "listening", ...WIDGET })],
    seek: (seconds, play) => [
        JSON.stringify({ event: "command", func: "seekTo", args: [seconds, true], ...WIDGET }),
        ...(play
            ? [JSON.stringify({ event: "command", func: "playVideo", args: [], ...WIDGET })]
            : []),
    ],
    readTime: data => {
        const message = parse(data);
        if (message?.event !== "infoDelivery" && message?.event !== "initialDelivery") return null;
        const info = message.info as Record<string, unknown> | undefined;
        return finiteNumber(info?.currentTime);
    },
};

const vimeo: EmbedBridge = {
    origin: "https://player.vimeo.com",
    subscribe: () => [JSON.stringify({ method: "addEventListener", value: "timeupdate" })],
    seek: (seconds, play) => [
        JSON.stringify({ method: "setCurrentTime", value: seconds }),
        ...(play ? [JSON.stringify({ method: "play" })] : []),
    ],
    readTime: data => {
        const message = parse(data);
        if (message?.event !== "timeupdate") return null;
        const payload = message.data as Record<string, unknown> | undefined;
        return finiteNumber(payload?.seconds);
    },
};

const BRIDGES: Record<string, EmbedBridge> = { youtube, vimeo };

/** The bridge for a provider whose player can be driven, or null. */
export function embedBridgeFor(provider: string): EmbedBridge | null {
    return BRIDGES[provider] ?? null;
}
