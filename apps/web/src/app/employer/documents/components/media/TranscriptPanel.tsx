"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Loader2, LocateFixed, RotateCw } from "lucide-react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { citationNeedles, findTextRange, type ViewerHighlight } from "~/lib/find-text-range";
import { formatMediaTime, type MediaPreview } from "~/lib/media-document";

type Transcript = NonNullable<MediaPreview["transcript"]>;

interface TranscriptPanelProps {
    transcript: Transcript;
    /** The segment under the playhead, or -1. */
    activeIndex: number;
    /** A line was clicked: play from it. */
    onSeek: (seconds: number) => void;
    /** A citation landed on a timestamped line: cue the player there, without playing. */
    onCite: (seconds: number) => void;
    highlight: ViewerHighlight | null;
}

interface Rect {
    top: number;
    left: number;
    width: number;
    height: number;
}

/** How long a hand on the scroll wheel keeps follow-along from scrolling. */
const MANUAL_SCROLL_GRACE_MS = 4000;

/** Scroll `child` into view inside `container` only — never the panes around it. */
function scrollWithin(container: HTMLElement, child: HTMLElement, mode: "nearest" | "center") {
    const box = container.getBoundingClientRect();
    const row = child.getBoundingClientRect();
    const top = row.top - box.top + container.scrollTop;
    if (mode === "center") {
        container.scrollTo({ top: top - (box.height - row.height) / 2, behavior: "smooth" });
        return;
    }
    if (row.top < box.top) container.scrollTo({ top, behavior: "smooth" });
    else if (row.bottom > box.bottom)
        container.scrollTo({ top: top - box.height + row.height, behavior: "smooth" });
}

function segmentIndexOf(node: Node): number {
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    const row = el?.closest("[data-segment-index]");
    return row ? Number(row.getAttribute("data-segment-index")) : -1;
}

/**
 * The transcript beside a recording. With timestamps (Whisper reports them)
 * each line plays from its moment, the line under the playhead is marked and
 * kept in view, and a citation cues the player to the cited line. Without
 * them (the cloud transcriber reports none) it is the plain text, with the
 * cited passage highlighted the way the other viewers do it.
 */
export function TranscriptPanel({
    transcript,
    activeIndex,
    onSeek,
    onCite,
    highlight,
}: TranscriptPanelProps) {
    const segments = transcript.segments;
    const scrollRef = useRef<HTMLDivElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const lastManualScroll = useRef(0);
    const [follow, setFollow] = useState(true);
    const [text, setText] = useState<string | null>(null);
    const [textState, setTextState] = useState<"idle" | "loading" | "error">(
        segments ? "idle" : "loading"
    );
    const [reload, setReload] = useState(0);
    const [cited, setCited] = useState<{ first: number; last: number } | null>(null);
    const [citeRects, setCiteRects] = useState<Rect[]>([]);

    // Plain transcripts are read from the document's own content.
    useEffect(() => {
        if (segments) return;
        let cancelled = false;
        setTextState("loading");
        void (async () => {
            try {
                const res = await fetch(`/api/documents/${transcript.documentId}/content`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const body = await res.text();
                if (cancelled) return;
                setText(body.trim());
                setTextState("idle");
            } catch {
                if (!cancelled) setTextState("error");
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [segments, transcript.documentId, reload]);

    // Keep the playing line in view, unless the reader is scrolling.
    useEffect(() => {
        if (!follow || activeIndex < 0) return;
        if (Date.now() - lastManualScroll.current < MANUAL_SCROLL_GRACE_MS) return;
        const container = scrollRef.current;
        const row = container?.querySelector<HTMLElement>(`[data-segment-index="${activeIndex}"]`);
        if (container && row) scrollWithin(container, row, "nearest");
    }, [activeIndex, follow]);

    // A citation: find the passage, mark it, bring it into view, cue the player.
    const onCiteRef = useRef(onCite);
    useEffect(() => {
        onCiteRef.current = onCite;
    }, [onCite]);
    const locate = useCallback(
        /** `reveal`: scroll to it and cue the player; otherwise only re-measure. */
        (reveal: boolean) => {
            const body = bodyRef.current;
            const container = scrollRef.current;
            if (!highlight || !body || !container) {
                setCited(null);
                setCiteRects([]);
                return;
            }
            const range = findTextRange(body, citationNeedles(highlight.text, highlight.matchText));
            if (!range) {
                setCited(null);
                setCiteRects([]);
                return;
            }

            if (segments) {
                const first = segmentIndexOf(range.startContainer);
                const last = segmentIndexOf(range.endContainer);
                if (first < 0) return;
                setCited({ first, last: Math.max(first, last) });
                if (!reveal) return;
                const row = body.querySelector<HTMLElement>(`[data-segment-index="${first}"]`);
                if (row) scrollWithin(container, row, "center");
                // Reading the cited moment is the point: hold follow-along off for a beat.
                lastManualScroll.current = Date.now();
                const segment = segments[first];
                if (segment) onCiteRef.current(segment.start);
                return;
            }

            const origin = body.getBoundingClientRect();
            const rects = Array.from(range.getClientRects())
                .filter(r => r.width > 0 && r.height > 0)
                .map(r => ({
                    top: r.top - origin.top,
                    left: r.left - origin.left,
                    width: r.width,
                    height: r.height,
                }));
            setCiteRects(rects);
            const firstRect = rects[0];
            if (!reveal || !firstRect) return;
            // A plain transcript is often one long paragraph: centre the cited
            // words themselves, not the top of the block they sit in.
            const bodyTop =
                origin.top - container.getBoundingClientRect().top + container.scrollTop;
            container.scrollTo({
                top: bodyTop + firstRect.top - (container.clientHeight - firstRect.height) / 2,
                behavior: "smooth",
            });
        },
        [highlight, segments]
    );

    useEffect(() => {
        if (!segments && text === null) return;
        locate(true);
    }, [locate, segments, text]);

    // Highlight rectangles are measured; re-measure when the panel reflows.
    useEffect(() => {
        const body = bodyRef.current;
        if (segments || !highlight || !body || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(() => locate(false));
        observer.observe(body);
        return () => observer.disconnect();
    }, [segments, highlight, locate]);

    const markManualScroll = () => {
        lastManualScroll.current = Date.now();
    };

    const languageLabel =
        transcript.language && transcript.language !== "unknown"
            ? transcript.language.toUpperCase()
            : null;

    return (
        <section aria-label="Transcript" className="flex min-h-0 flex-1 flex-col">
            <header className="border-line flex items-center gap-2 border-b px-4 py-2">
                <FileText className="text-ink-3 size-4 shrink-0" aria-hidden />
                <h3 className="text-ink text-sm font-semibold">Transcript</h3>
                {languageLabel && (
                    <span className="bg-panel-2 text-ink-3 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium">
                        {languageLabel}
                    </span>
                )}
                {segments && (
                    <span className="text-ink-4 text-xs">
                        {segments.length} line{segments.length === 1 ? "" : "s"}
                    </span>
                )}
                <span className="flex-1" />
                {segments && (
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-pressed={follow}
                        title="Keep the playing line in view"
                        className={cn("text-xs", follow ? "text-brand-ink" : "text-ink-3")}
                        onClick={() => {
                            lastManualScroll.current = 0;
                            setFollow(f => !f);
                        }}
                    >
                        <LocateFixed />
                        Follow along
                    </Button>
                )}
            </header>

            <div
                ref={scrollRef}
                className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
                onWheel={markManualScroll}
                onTouchMove={markManualScroll}
            >
                <div ref={bodyRef} className="relative">
                    {segments ? (
                        <ol className="space-y-0.5">
                            {segments.map((segment, i) => {
                                const isActive = i === activeIndex;
                                const isCited =
                                    cited !== null && i >= cited.first && i <= cited.last;
                                return (
                                    <li key={`${segment.start}-${i}`}>
                                        <button
                                            type="button"
                                            data-segment-index={i}
                                            data-cited={isCited || undefined}
                                            aria-current={isActive ? "time" : undefined}
                                            aria-label={`Play from ${formatMediaTime(segment.start)}: ${segment.text}`}
                                            onClick={() => onSeek(segment.start)}
                                            className={cn(
                                                "group flex w-full items-start gap-3 rounded-lg border-l-2 border-transparent px-3 py-1.5 text-left transition-colors",
                                                "hover:bg-panel-2 focus-visible:ring-brand/50 outline-none focus-visible:ring-[3px]",
                                                isActive && "border-brand bg-brand-soft",
                                                isCited && "bg-warn-soft ring-warn/60 ring-1"
                                            )}
                                        >
                                            <span
                                                aria-hidden
                                                className={cn(
                                                    "w-12 shrink-0 pt-0.5 font-mono text-[11px] tabular-nums",
                                                    isActive
                                                        ? "text-brand-ink"
                                                        : "text-ink-4 group-hover:text-ink-2"
                                                )}
                                            >
                                                {formatMediaTime(segment.start)}
                                            </span>
                                            <span className="text-ink text-sm leading-relaxed">
                                                {segment.text}
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ol>
                    ) : textState === "loading" ? (
                        <div className="text-ink-3 flex items-center justify-center gap-2 py-10 text-sm">
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                            Loading transcript…
                        </div>
                    ) : textState === "error" ? (
                        <div className="text-ink-3 flex flex-col items-center gap-3 py-10 text-sm">
                            Couldn&apos;t load the transcript.
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setReload(n => n + 1)}
                            >
                                <RotateCw />
                                Try again
                            </Button>
                        </div>
                    ) : text ? (
                        <>
                            {citeRects.map((r, i) => (
                                <div
                                    key={`cite-${i}`}
                                    aria-hidden
                                    data-testid="transcript-cite-highlight"
                                    className="bg-warn-soft ring-warn/60 pointer-events-none absolute rounded-sm ring-1"
                                    style={{
                                        top: r.top,
                                        left: r.left,
                                        width: r.width,
                                        height: r.height,
                                    }}
                                />
                            ))}
                            <p className="text-ink relative whitespace-pre-wrap px-3 py-1 text-sm leading-relaxed">
                                {text}
                            </p>
                        </>
                    ) : (
                        <p className="text-ink-3 px-3 py-10 text-center text-sm">
                            No speech was transcribed from this recording.
                        </p>
                    )}
                </div>
            </div>
        </section>
    );
}
