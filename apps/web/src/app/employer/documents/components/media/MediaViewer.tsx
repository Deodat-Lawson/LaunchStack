"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ExternalLink, FileX, Loader2, RotateCw } from "lucide-react";

import { Button } from "~/components/ui/button";
import type { ViewerHighlight } from "~/lib/find-text-range";
import { activeSegmentIndex, type MediaPreview } from "~/lib/media-document";
import type { DocumentType } from "../../types";
import { EmbedPlayer } from "./EmbedPlayer";
import { FilePlayer } from "./FilePlayer";
import { TranscriptPanel } from "./TranscriptPanel";
import type { PlayerHandle } from "./types";

interface MediaViewerProps {
    document: DocumentType;
    /** A citation into the transcript: cue the player to it and mark it. */
    highlight?: ViewerHighlight | null;
}

type LoadState =
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; preview: MediaPreview };

/**
 * The viewer for an audio or video source, opened from either half of the
 * pair — the recording or its transcript: the player on top, the transcript
 * under it, wired together. `/api/documents/[id]/media` says what to play and
 * which transcript belongs to it.
 */
export function MediaViewer({ document, highlight = null }: MediaViewerProps) {
    const [state, setState] = useState<LoadState>({ status: "loading" });
    const [reload, setReload] = useState(0);
    const [activeIndex, setActiveIndex] = useState(-1);
    const playerRef = useRef<PlayerHandle>(null);

    useEffect(() => {
        let cancelled = false;
        setState({ status: "loading" });
        setActiveIndex(-1);
        void (async () => {
            try {
                const res = await fetch(`/api/documents/${document.id}/media`);
                const body = (await res.json().catch(() => null)) as
                    | (MediaPreview & { error?: undefined })
                    | { error?: string }
                    | null;
                if (cancelled) return;
                if (!res.ok || !body || "error" in body) {
                    const message =
                        body && typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
                    setState({ status: "error", message });
                    return;
                }
                setState({ status: "ready", preview: body as MediaPreview });
            } catch (err) {
                if (!cancelled) {
                    setState({
                        status: "error",
                        message: err instanceof Error ? err.message : "Failed to load",
                    });
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [document.id, reload]);

    const segments = state.status === "ready" ? (state.preview.transcript?.segments ?? null) : null;

    const handleTime = useCallback(
        (seconds: number) => {
            if (segments) setActiveIndex(activeSegmentIndex(segments, seconds));
        },
        [segments]
    );
    const seekAndPlay = useCallback((seconds: number) => {
        playerRef.current?.seek(seconds, { play: true });
    }, []);
    const cue = useCallback((seconds: number) => {
        playerRef.current?.seek(seconds);
    }, []);

    if (state.status === "loading") {
        return (
            <div className="text-ink-3 flex h-full items-center justify-center gap-2 text-sm">
                <Loader2 className="size-5 animate-spin" aria-hidden />
                Loading player…
            </div>
        );
    }

    if (state.status === "error") {
        return (
            <div
                role="alert"
                className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
            >
                <div className="bg-danger-soft text-danger flex size-11 items-center justify-center rounded-full">
                    <AlertTriangle className="size-5" aria-hidden />
                </div>
                <div>
                    <p className="text-ink text-sm font-semibold">
                        Couldn&apos;t open this recording
                    </p>
                    <p className="text-ink-3 mt-1 text-xs">{state.message}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setReload(n => n + 1)}>
                    <RotateCw />
                    Try again
                </Button>
            </div>
        );
    }

    const { preview } = state;
    const { playback, transcript } = preview;
    const fill = transcript === null;

    let player: ReactNode;
    if (playback?.type === "file") {
        player = (
            <FilePlayer
                key={playback.url}
                ref={playerRef}
                src={playback.url}
                kind={preview.kind}
                title={preview.title}
                onTimeChange={handleTime}
                fill={fill}
            />
        );
    } else if (playback?.type === "embed") {
        player = (
            <EmbedPlayer
                key={playback.embedUrl}
                ref={playerRef}
                playback={playback}
                kind={preview.kind}
                title={preview.title}
                onTimeChange={handleTime}
                fill={fill}
            />
        );
    } else if (playback?.type === "link") {
        player = (
            <div className="border-line bg-panel m-4 flex items-center gap-3 rounded-xl border p-4">
                <div className="min-w-0 flex-1">
                    <p className="text-ink text-sm font-semibold">
                        This video plays on {playback.label}
                    </p>
                    <p className="text-ink-3 mt-0.5 text-xs">
                        {playback.label} doesn&apos;t allow playing it inside the workspace.
                    </p>
                </div>
                <Button size="sm" asChild>
                    <a href={playback.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink />
                        Watch on {playback.label}
                    </a>
                </Button>
            </div>
        );
    } else {
        player = (
            <div className="border-line bg-panel-2/50 text-ink-3 m-4 flex items-center gap-3 rounded-xl border border-dashed p-4 text-sm">
                <FileX className="size-5 shrink-0" aria-hidden />
                The original recording isn&apos;t available — it may have been deleted or moved to a
                folder you can&apos;t open.
            </div>
        );
    }

    return (
        <div className="bg-surface flex h-full min-h-0 flex-col" data-testid="media-viewer">
            {player}
            {transcript ? (
                <TranscriptPanel
                    key={transcript.documentId}
                    transcript={transcript}
                    activeIndex={activeIndex}
                    onSeek={seekAndPlay}
                    onCite={cue}
                    highlight={highlight}
                />
            ) : (
                playback?.type === "file" && (
                    <p className="text-ink-4 border-line shrink-0 border-t px-4 py-2 text-xs">
                        No transcript for this recording yet. Once it has one, it shows here and the
                        recording can be cited.
                    </p>
                )
            )}
        </div>
    );
}
