"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";
import { Music, FileText, Clock, Loader2 } from "lucide-react";
import type { DocumentType } from "../types";

interface AudioViewerProps {
    document: DocumentType;
}

interface TranscriptSegment {
    start: number;
    end: number;
    text: string;
}

function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudioViewer({ document }: AudioViewerProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const activeIndexRef = useRef(-1);
    const [transcript, setTranscript] = useState<string | null>(null);
    const [segments, setSegments] = useState<TranscriptSegment[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeSegmentIndex, setActiveSegmentIndex] = useState(-1);
    const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);

    const isTranscription = document.title.toLowerCase().includes("(transcription)");
    const metadata = document.ocrMetadata;
    const audioDocId = metadata?.audioDocumentId;
    const audioProxyUrl = audioDocId ? `/api/documents/${audioDocId}/content` : null;

    // Download audio as blob so seeking works without Range header support
    useEffect(() => {
        const url = isTranscription ? audioProxyUrl : document.url;
        if (!url) return;

        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch(url);
                if (res.ok && !cancelled) {
                    const blob = await res.blob();
                    const blobUrl = URL.createObjectURL(blob);
                    setAudioBlobUrl(blobUrl);
                }
            } catch {
                // ignore
            }
        })();

        return () => {
            cancelled = true;
            setAudioBlobUrl(prev => {
                if (prev) URL.revokeObjectURL(prev);
                return null;
            });
        };
    }, [audioProxyUrl, document.url, isTranscription]);

    // Load segments from metadata, fetch transcript text
    useEffect(() => {
        if (!isTranscription) {
            setLoading(false);
            return;
        }

        if (metadata?.segments && Array.isArray(metadata.segments)) {
            setSegments(metadata.segments as TranscriptSegment[]);
        }

        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch(`/api/documents/${document.id}/content`);
                if (res.ok && !cancelled) {
                    const text = await res.text();
                    setTranscript(text);
                }
            } catch {
                // ignore
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [document.id, isTranscription, metadata]);

    // Track current time for segment highlighting
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio || segments.length === 0) return;

        const handleTimeUpdate = () => {
            const t = audio.currentTime;
            const idx = segments.findIndex(s => t >= s.start && t < s.end);
            if (idx !== activeIndexRef.current) {
                activeIndexRef.current = idx;
                setActiveSegmentIndex(idx);
            }
        };

        audio.addEventListener("timeupdate", handleTimeUpdate);
        return () => audio.removeEventListener("timeupdate", handleTimeUpdate);
    }, [segments, audioBlobUrl]);

    const seekTo = useCallback((time: number) => {
        const audio = audioRef.current;
        if (!audio) return;
        audio.currentTime = time;
        // Autoplay rejections (e.g. no user gesture yet) are intentionally ignored.
        void audio.play().catch(() => undefined);
    }, []);

    // For a raw audio file (not a transcription), just show the player
    if (!isTranscription) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
                <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-violet-100 dark:bg-violet-900/30">
                    <Music className="h-10 w-10 text-violet-600 dark:text-violet-400" />
                </div>
                <h3 className="text-foreground text-lg font-semibold">{document.title}</h3>
                {audioBlobUrl ? (
                    <audio ref={audioRef} controls className="w-full max-w-lg" src={audioBlobUrl} />
                ) : (
                    <div className="text-muted-foreground flex items-center gap-2 text-sm">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading audio...
                    </div>
                )}
                <p className="text-muted-foreground text-sm">
                    Check the matching transcript document to view the transcribed text.
                </p>
            </div>
        );
    }

    // Transcription document view
    return (
        <div className="flex h-full flex-col overflow-hidden">
            {/* Audio player bar */}
            {audioProxyUrl && (
                <div className="flex-shrink-0 border-b border-violet-200 bg-violet-50 px-6 py-4 dark:border-violet-800 dark:bg-violet-950/30">
                    <div className="mb-2 flex items-center gap-3">
                        <Music className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                        <span className="text-sm font-medium text-violet-700 dark:text-violet-300">
                            Audio Player
                        </span>
                    </div>
                    {audioBlobUrl ? (
                        <audio ref={audioRef} controls className="w-full" src={audioBlobUrl} />
                    ) : (
                        <div className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
                            <Loader2 className="h-4 w-4 animate-spin" /> Loading audio...
                        </div>
                    )}
                </div>
            )}

            {/* Transcript content */}
            <div className="flex-1 overflow-y-auto p-6">
                <div className="mb-4 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                    <h3 className="text-foreground text-sm font-semibold">Transcript</h3>
                    {metadata?.language && (
                        <span className="rounded bg-violet-100 px-2 py-0.5 text-[10px] font-medium uppercase text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                            {metadata.language}
                        </span>
                    )}
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
                    </div>
                ) : segments.length > 0 ? (
                    <div className="space-y-1">
                        {segments.map((segment, i) => (
                            <div
                                key={i}
                                role="button"
                                tabIndex={0}
                                onMouseDown={e => {
                                    e.preventDefault();
                                    seekTo(segment.start);
                                }}
                                className={`group w-full cursor-pointer rounded-lg px-3 py-2 text-left transition-colors hover:bg-violet-50 dark:hover:bg-violet-950/30 ${
                                    i === activeSegmentIndex
                                        ? "border-l-2 border-violet-500 bg-violet-100 dark:bg-violet-900/40"
                                        : ""
                                }`}
                            >
                                <div className="flex items-start gap-3">
                                    <span className="flex flex-shrink-0 items-center gap-1 pt-0.5 font-mono text-[11px] text-violet-500 opacity-60 group-hover:opacity-100 dark:text-violet-400">
                                        <Clock className="h-3 w-3" />
                                        {formatTime(segment.start)}
                                    </span>
                                    <span className="text-foreground text-sm leading-relaxed">
                                        {segment.text}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : transcript ? (
                    <div className="prose dark:prose-invert prose-sm max-w-none">
                        <p className="text-foreground/90 whitespace-pre-wrap leading-relaxed">
                            {transcript}
                        </p>
                    </div>
                ) : (
                    <p className="text-muted-foreground text-sm">No transcript available.</p>
                )}
            </div>
        </div>
    );
}
