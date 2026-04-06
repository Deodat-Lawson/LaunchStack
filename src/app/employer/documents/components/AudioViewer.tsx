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
      setAudioBlobUrl((prev) => {
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
    return () => { cancelled = true; };
  }, [document.id, isTranscription, metadata]);

  // Track current time for segment highlighting
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || segments.length === 0) return;

    const handleTimeUpdate = () => {
      const t = audio.currentTime;
      const idx = segments.findIndex((s) => t >= s.start && t < s.end);
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
    void audio.play().catch(() => {});
  }, []);

  // For a raw audio file (not a transcription), just show the player
  if (!isTranscription) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
        <div className="w-20 h-20 bg-violet-100 dark:bg-violet-900/30 rounded-3xl flex items-center justify-center">
          <Music className="w-10 h-10 text-violet-600 dark:text-violet-400" />
        </div>
        <h3 className="text-lg font-semibold text-foreground">{document.title}</h3>
        {audioBlobUrl ? (
          <audio ref={audioRef} controls className="w-full max-w-lg" src={audioBlobUrl} />
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading audio...
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          Check the matching transcript document to view the transcribed text.
        </p>
      </div>
    );
  }

  // Transcription document view
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Audio player bar */}
      {audioProxyUrl && (
        <div className="flex-shrink-0 bg-violet-50 dark:bg-violet-950/30 border-b border-violet-200 dark:border-violet-800 px-6 py-4">
          <div className="flex items-center gap-3 mb-2">
            <Music className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            <span className="text-sm font-medium text-violet-700 dark:text-violet-300">Audio Player</span>
          </div>
          {audioBlobUrl ? (
            <audio ref={audioRef} controls className="w-full" src={audioBlobUrl} />
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading audio...
            </div>
          )}
        </div>
      )}

      {/* Transcript content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="w-4 h-4 text-violet-600 dark:text-violet-400" />
          <h3 className="text-sm font-semibold text-foreground">Transcript</h3>
          {metadata?.language && (
            <span className="px-2 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-[10px] rounded font-medium uppercase">
              {metadata.language as string}
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
          </div>
        ) : segments.length > 0 ? (
          <div className="space-y-1">
            {segments.map((segment, i) => (
              <div
                key={i}
                role="button"
                tabIndex={0}
                onMouseDown={(e) => {
                  e.preventDefault();
                  seekTo(segment.start);
                }}
                className={`w-full text-left px-3 py-2 rounded-lg transition-colors cursor-pointer group hover:bg-violet-50 dark:hover:bg-violet-950/30 ${
                  i === activeSegmentIndex
                    ? "bg-violet-100 dark:bg-violet-900/40 border-l-2 border-violet-500"
                    : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 flex items-center gap-1 text-[11px] font-mono text-violet-500 dark:text-violet-400 pt-0.5 opacity-60 group-hover:opacity-100">
                    <Clock className="w-3 h-3" />
                    {formatTime(segment.start)}
                  </span>
                  <span className="text-sm text-foreground leading-relaxed">
                    {segment.text}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : transcript ? (
          <div className="prose dark:prose-invert prose-sm max-w-none">
            <p className="whitespace-pre-wrap leading-relaxed text-foreground/90">
              {transcript}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No transcript available.</p>
        )}
      </div>
    </div>
  );
}
