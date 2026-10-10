"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
    AlertTriangle,
    AudioLines,
    Download,
    Film,
    Gauge,
    Loader2,
    Pause,
    Play,
    RotateCcw,
    RotateCw,
    Volume2,
    VolumeX,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Slider } from "~/components/ui/slider";
import { formatMediaTime, type MediaKind } from "~/lib/media-document";
import { PLAYBACK_RATES, SKIP_SECONDS, type PlayerHandle } from "./types";

interface FilePlayerProps {
    /** Same-origin and ranged (`/api/documents/{id}/content`), so the element can seek. */
    src: string;
    kind: MediaKind;
    title: string;
    /** Reports the playhead as it moves and after every seek. */
    onTimeChange?: (seconds: number) => void;
    /** Let a video take all the height there is (nothing is stacked under it). */
    fill?: boolean;
}

type LoadState = "loading" | "ready" | "error";

/**
 * A stored recording, played by the browser.
 *
 * One `<video>` element plays both kinds — it plays audio-only files too — so
 * finding that a "video" has no picture (an MPEG-4 audio file typed
 * `video/mp4`) switches the presentation without reloading anything. Video
 * keeps the browser's own controls (fullscreen, picture-in-picture,
 * captions); audio gets a deck built from the kit, since the native audio
 * bar ignores the theme.
 *
 * The parent keys this by `src`, so a new file always starts from a clean state.
 */
export const FilePlayer = forwardRef<PlayerHandle, FilePlayerProps>(function FilePlayer(
    { src, kind, title, onTimeChange, fill = false },
    ref
) {
    const mediaRef = useRef<HTMLVideoElement>(null);
    const [loadState, setLoadState] = useState<LoadState>("loading");
    const [hasPicture, setHasPicture] = useState(kind === "video");
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [playing, setPlaying] = useState(false);
    /** Playing, but stalled for data. */
    const [buffering, setBuffering] = useState(false);
    const [rate, setRate] = useState(1);
    const [muted, setMuted] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    /** Where the thumb is while the scrubber is being dragged; the element seeks on release. */
    const [scrubTime, setScrubTime] = useState<number | null>(null);

    const seekTo = useCallback((seconds: number, play = false) => {
        const el = mediaRef.current;
        if (!el) return;
        const limit = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : seconds;
        el.currentTime = Math.min(Math.max(0, seconds), limit);
        // A rejected play() (no user gesture yet) leaves the playhead cued up.
        if (play) void el.play().catch(() => undefined);
    }, []);

    useImperativeHandle(
        ref,
        () => ({ seek: (seconds, options) => seekTo(seconds, options?.play === true) }),
        [seekTo]
    );

    // The audio deck's clock follows the playhead every frame while playing;
    // `timeupdate` alone only fires about four times a second.
    useEffect(() => {
        if (!playing || hasPicture) return;
        let frame = 0;
        const tick = () => {
            const el = mediaRef.current;
            if (el) setCurrentTime(el.currentTime);
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [playing, hasPicture]);

    const reportTime = () => {
        const el = mediaRef.current;
        if (!el) return;
        setCurrentTime(el.currentTime);
        onTimeChange?.(el.currentTime);
    };

    const readDuration = () => {
        const value = mediaRef.current?.duration ?? 0;
        setDuration(Number.isFinite(value) && value > 0 ? value : 0);
    };

    /** Skip from where the element is now, not from the last rendered time. */
    const skip = (delta: number) => seekTo((mediaRef.current?.currentTime ?? 0) + delta);

    const togglePlay = () => {
        const el = mediaRef.current;
        if (!el) return;
        if (el.paused) void el.play().catch(() => undefined);
        else el.pause();
    };

    const toggleMute = () => {
        const el = mediaRef.current;
        if (el) el.muted = !el.muted;
    };

    const changeRate = (value: string) => {
        const el = mediaRef.current;
        const next = Number(value);
        if (el && Number.isFinite(next)) el.playbackRate = next;
    };

    const retry = () => {
        setLoadState("loading");
        setReloadKey(k => k + 1);
    };

    const showVideo = hasPicture && loadState !== "error";
    const durationLabel = duration > 0 ? formatMediaTime(duration) : null;

    const actions = (
        <div className="flex shrink-0 items-center gap-1">
            {!showVideo && (
                <Button
                    variant="ghost"
                    size="icon"
                    className="text-ink-2 size-8"
                    aria-label={muted ? "Unmute" : "Mute"}
                    title={muted ? "Unmute" : "Mute"}
                    onClick={toggleMute}
                >
                    {muted ? <VolumeX /> : <Volume2 />}
                </Button>
            )}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Playback speed, ${rate}×`}
                        title="Playback speed"
                        className="text-ink-2 font-mono text-xs tabular-nums"
                    >
                        <Gauge />
                        {rate}×
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuLabel className="text-ink-3 text-xs">
                        Playback speed
                    </DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={String(rate)} onValueChange={changeRate}>
                        {PLAYBACK_RATES.map(r => (
                            <DropdownMenuRadioItem key={r} value={String(r)}>
                                {r === 1 ? "Normal" : `${r}×`}
                            </DropdownMenuRadioItem>
                        ))}
                    </DropdownMenuRadioGroup>
                </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="icon" asChild className="text-ink-2 size-8">
                <a href={src} download aria-label="Download the file" title="Download">
                    <Download />
                </a>
            </Button>
        </div>
    );

    return (
        <div
            className={fill ? "flex min-h-0 flex-1 flex-col" : "flex shrink-0 flex-col"}
            data-testid="file-player"
            data-kind={kind}
        >
            {/* One element in one place for the whole life of the player:
                switching presentation must not reload the media. */}
            <div
                className={
                    !showVideo
                        ? undefined
                        : fill
                          ? "relative flex min-h-0 w-full flex-1 items-center justify-center bg-[var(--code-bg)]"
                          : "relative flex aspect-video max-h-[50vh] w-full shrink-0 items-center justify-center bg-[var(--code-bg)]"
                }
            >
                <video
                    key={reloadKey}
                    ref={mediaRef}
                    src={src}
                    preload="metadata"
                    playsInline
                    controls={showVideo}
                    hidden={!showVideo}
                    aria-label={title}
                    className="h-full w-full object-contain"
                    onLoadedMetadata={event => {
                        readDuration();
                        // No picture track: an audio file in a video container.
                        if (event.currentTarget.videoWidth === 0) setHasPicture(false);
                    }}
                    onDurationChange={readDuration}
                    onLoadedData={() => setLoadState("ready")}
                    onCanPlay={() => {
                        setLoadState("ready");
                        setBuffering(false);
                    }}
                    onWaiting={() => setBuffering(true)}
                    onPlaying={() => setBuffering(false)}
                    onTimeUpdate={reportTime}
                    onSeeked={reportTime}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onEnded={() => setPlaying(false)}
                    onRateChange={event => setRate(event.currentTarget.playbackRate)}
                    onVolumeChange={event => setMuted(event.currentTarget.muted)}
                    onError={() => {
                        setPlaying(false);
                        setLoadState("error");
                    }}
                />
                {showVideo && loadState === "loading" && (
                    <Loader2
                        aria-hidden
                        className="text-ink-4 pointer-events-none absolute size-7 animate-spin"
                    />
                )}
            </div>

            {loadState === "error" ? (
                <PlaybackError kind={kind} src={src} onRetry={retry} />
            ) : showVideo ? (
                <div className="border-line flex items-center gap-2 border-b px-4 py-1.5">
                    <Film className="text-ink-3 size-4 shrink-0" aria-hidden />
                    <span className="text-ink-3 min-w-0 flex-1 truncate text-xs">
                        Video{durationLabel ? ` · ${durationLabel}` : ""}
                    </span>
                    {actions}
                </div>
            ) : (
                <div className="border-line bg-panel shadow-1 m-4 rounded-xl border p-4">
                    <div className="flex items-center gap-3">
                        <div className="bg-brand-soft text-brand-ink flex size-11 shrink-0 items-center justify-center rounded-lg">
                            <AudioLines className="size-5" aria-hidden />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-ink truncate text-sm font-semibold">{title}</p>
                            <p className="text-ink-3 text-xs">
                                {kind === "video" ? "Audio only" : "Audio"}
                                {durationLabel ? ` · ${durationLabel}` : ""}
                            </p>
                        </div>
                        {actions}
                    </div>
                    <Slider
                        className="mt-4"
                        min={0}
                        max={duration > 0 ? duration : 1}
                        step={0.1}
                        value={[Math.min(scrubTime ?? currentTime, duration > 0 ? duration : 1)]}
                        disabled={duration === 0}
                        thumbLabel="Seek"
                        onValueChange={([value]) => {
                            if (value !== undefined) setScrubTime(value);
                        }}
                        onValueCommit={([value]) => {
                            if (value !== undefined) seekTo(value);
                            setScrubTime(null);
                        }}
                    />
                    <div className="mt-2 flex items-center gap-2">
                        <span className="text-ink-3 w-12 shrink-0 font-mono text-xs tabular-nums">
                            {formatMediaTime(scrubTime ?? currentTime)}
                        </span>
                        <div className="flex flex-1 items-center justify-center gap-2">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="text-ink-2 size-8"
                                aria-label={`Back ${SKIP_SECONDS} seconds`}
                                title={`Back ${SKIP_SECONDS}s`}
                                onClick={() => skip(-SKIP_SECONDS)}
                            >
                                <RotateCcw />
                            </Button>
                            <Button
                                size="icon"
                                className="size-10 rounded-full"
                                aria-label={playing ? "Pause" : "Play"}
                                // Never disabled while loading: iOS fetches nothing,
                                // metadata included, until the first tap on play.
                                onClick={togglePlay}
                            >
                                {playing && buffering ? (
                                    <Loader2 className="animate-spin" />
                                ) : playing ? (
                                    <Pause />
                                ) : (
                                    <Play />
                                )}
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="text-ink-2 size-8"
                                aria-label={`Forward ${SKIP_SECONDS} seconds`}
                                title={`Forward ${SKIP_SECONDS}s`}
                                onClick={() => skip(SKIP_SECONDS)}
                            >
                                <RotateCw />
                            </Button>
                        </div>
                        <span className="text-ink-3 w-12 shrink-0 text-right font-mono text-xs tabular-nums">
                            {durationLabel ?? "–:––"}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
});

function PlaybackError({
    kind,
    src,
    onRetry,
}: {
    kind: MediaKind;
    src: string;
    onRetry: () => void;
}) {
    return (
        <div
            role="alert"
            className="border-line bg-panel m-4 flex flex-col items-center gap-3 rounded-xl border px-6 py-8 text-center"
        >
            <div className="bg-danger-soft text-danger flex size-11 items-center justify-center rounded-full">
                <AlertTriangle className="size-5" aria-hidden />
            </div>
            <div>
                <p className="text-ink text-sm font-semibold">
                    This {kind === "video" ? "video" : "recording"} can&apos;t be played here
                </p>
                <p className="text-ink-3 mt-1 max-w-sm text-xs">
                    Your browser may not support its format, or the file is no longer available. You
                    can still download it.
                </p>
            </div>
            <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={onRetry}>
                    <RotateCw />
                    Try again
                </Button>
                <Button size="sm" asChild>
                    <a href={src} download>
                        <Download />
                        Download
                    </a>
                </Button>
            </div>
        </div>
    );
}
