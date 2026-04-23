"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface YouTubeSourceTabProps {
  categories: { id: string; name: string }[];
  defaultCategory?: string;
  onSuccess?: () => void;
}

interface TranscribeResponse {
  document?: { title?: string };
  details?: string;
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--ink-2)",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 9,
  border: "1px solid var(--line)",
  background: "var(--panel)",
  fontSize: 14,
  color: "var(--ink)",
  outline: "none",
  fontFamily: "inherit",
};

export function YouTubeSourceTab({
  categories,
  defaultCategory,
  onSuccess,
}: YouTubeSourceTabProps) {
  const { userId } = useAuth();
  const router = useRouter();

  const [videoUrl, setVideoUrl] = useState("");
  const [videoTitle, setVideoTitle] = useState("");
  const [videoCategory, setVideoCategory] = useState(defaultCategory ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleTranscribe = async () => {
    if (!userId || !videoUrl.trim() || !videoCategory) return;
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/upload/video-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          videoUrl: videoUrl.trim(),
          category: videoCategory,
          title: videoTitle.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = (await res
          .json()
          .catch(() => ({ details: res.statusText }))) as TranscribeResponse;
        throw new Error(err.details ?? "Failed to process video");
      }
      const data = (await res.json()) as TranscribeResponse;
      toast.success(
        `Video transcribed successfully: "${data.document?.title ?? "Video"}"`,
      );
      setVideoUrl("");
      setVideoTitle("");
      setVideoCategory(defaultCategory ?? "");
      router.refresh();
      onSuccess?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to process video URL",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const disabled =
    !videoUrl.trim() || !videoCategory || isSubmitting || !userId;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <label htmlFor="video-url" style={labelStyle}>
          Video URL
        </label>
        <input
          id="video-url"
          type="url"
          placeholder="https://www.youtube.com/watch?v=…"
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          disabled={isSubmitting}
          style={inputStyle}
        />
      </div>

      <div>
        <label htmlFor="video-title" style={labelStyle}>
          Document title{" "}
          <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>
            (optional — defaults to video title)
          </span>
        </label>
        <input
          id="video-title"
          type="text"
          placeholder="e.g. Q1 All-Hands recording"
          value={videoTitle}
          onChange={(e) => setVideoTitle(e.target.value)}
          disabled={isSubmitting}
          style={inputStyle}
        />
      </div>

      <div>
        <label htmlFor="video-category" style={labelStyle}>
          Category
        </label>
        <select
          id="video-category"
          value={videoCategory}
          onChange={(e) => setVideoCategory(e.target.value)}
          style={inputStyle}
        >
          <option value="">Select a category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={() => void handleTranscribe()}
        disabled={disabled}
        style={{
          width: "100%",
          padding: "12px",
          borderRadius: 10,
          background: disabled ? "var(--line)" : "var(--accent)",
          color: disabled ? "var(--ink-3)" : "white",
          fontSize: 13.5,
          fontWeight: 600,
          border: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          boxShadow: disabled ? "none" : "0 1px 4px var(--accent-glow)",
        }}
      >
        {isSubmitting ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Transcribing…
          </>
        ) : (
          "Transcribe & upload"
        )}
      </button>

      {isSubmitting && (
        <div
          style={{
            fontSize: 12,
            color: "oklch(0.5 0.14 65)",
            textAlign: "center",
          }}
        >
          This may take a few minutes depending on video length. Please don&apos;t close
          this page.
        </div>
      )}

      <div
        style={{
          fontSize: 11.5,
          color: "var(--ink-3)",
          textAlign: "center",
        }}
      >
        Supported: YouTube, Vimeo, TikTok, Twitter/X, Twitch, Dailymotion, and more
      </div>
    </div>
  );
}
