"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ExternalLink, Film, Loader2, Music } from "lucide-react";

import { Button } from "~/components/ui/button";
import { IconYoutube } from "~/components/icons/brand";
import type { MediaKind, MediaPlayback } from "~/lib/media-document";
import { embedBridgeFor } from "./embed-bridge";
import type { PlayerHandle } from "./types";

type EmbedPlayback = Extract<MediaPlayback, { type: "embed" }>;

interface EmbedPlayerProps {
    playback: EmbedPlayback;
    kind: MediaKind;
    title: string;
    onTimeChange?: (seconds: number) => void;
    /** Let the frame take all the height there is (nothing is stacked under it). */
    fill?: boolean;
}

/** Re-sent after load: a platform player ignores messages until it is ready. */
const SUBSCRIBE_RETRIES_MS = [0, 600, 1500, 3000];

/**
 * A video imported by URL, played in the platform's own embed player.
 *
 * The frame is cross-origin, so it cannot reach this page whatever it runs;
 * it is not sandboxed because the platforms' players refuse to run sandboxed.
 * The referrer policy keeps the origin in the Referer YouTube now requires
 * without sending the workspace path.
 */
export const EmbedPlayer = forwardRef<PlayerHandle, EmbedPlayerProps>(function EmbedPlayer(
    { playback, kind, title, onTimeChange, fill = false },
    ref
) {
    const frameRef = useRef<HTMLIFrameElement>(null);
    const [loaded, setLoaded] = useState(false);
    const bridge = embedBridgeFor(playback.provider);
    const onTimeRef = useRef(onTimeChange);
    useEffect(() => {
        onTimeRef.current = onTimeChange;
    }, [onTimeChange]);

    const post = (messages: string[]) => {
        const target = frameRef.current?.contentWindow;
        if (!target || !bridge) return;
        for (const message of messages) target.postMessage(message, bridge.origin);
    };

    useImperativeHandle(ref, () => ({
        seek: (seconds, options) => post(bridge?.seek(seconds, options?.play === true) ?? []),
    }));

    // Follow the playhead, from this frame only.
    useEffect(() => {
        if (!bridge) return;
        let heard = false;
        const onMessage = (event: MessageEvent) => {
            if (event.origin !== bridge.origin) return;
            if (event.source !== frameRef.current?.contentWindow) return;
            const time = bridge.readTime(event.data);
            if (time === null) return;
            heard = true;
            onTimeRef.current?.(time);
        };
        window.addEventListener("message", onMessage);

        const timers = loaded
            ? SUBSCRIBE_RETRIES_MS.map(delay =>
                  window.setTimeout(() => {
                      if (heard) return;
                      const target = frameRef.current?.contentWindow;
                      for (const message of bridge.subscribe()) {
                          target?.postMessage(message, bridge.origin);
                      }
                  }, delay)
              )
            : [];
        return () => {
            window.removeEventListener("message", onMessage);
            timers.forEach(timer => window.clearTimeout(timer));
        };
    }, [bridge, loaded]);

    const PlatformIcon =
        playback.provider === "youtube" ? IconYoutube : kind === "audio" ? Music : Film;

    return (
        <div
            className={fill ? "flex min-h-0 flex-1 flex-col" : "flex shrink-0 flex-col"}
            data-testid="embed-player"
            data-provider={playback.provider}
        >
            <div
                className={
                    kind === "audio"
                        ? "relative h-[166px] w-full shrink-0"
                        : fill
                          ? "relative min-h-0 w-full flex-1 bg-[var(--code-bg)]"
                          : "relative aspect-video max-h-[50vh] w-full shrink-0 bg-[var(--code-bg)]"
                }
            >
                {!loaded && (
                    <Loader2
                        aria-hidden
                        className="text-ink-4 absolute left-1/2 top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 animate-spin"
                    />
                )}
                <iframe
                    ref={frameRef}
                    src={playback.embedUrl}
                    title={`${title} — ${playback.label} player`}
                    className="absolute inset-0 h-full w-full border-0"
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                    onLoad={() => setLoaded(true)}
                />
            </div>
            <div className="border-line flex items-center gap-2 border-b px-4 py-1.5">
                <PlatformIcon className="text-ink-3 size-4 shrink-0" aria-hidden />
                <span className="text-ink-3 min-w-0 flex-1 truncate text-xs">
                    Streaming from {playback.label}
                </span>
                <Button variant="ghost" size="sm" asChild className="text-ink-2 text-xs">
                    <a href={playback.watchUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink />
                        Open on {playback.label}
                    </a>
                </Button>
            </div>
        </div>
    );
});
