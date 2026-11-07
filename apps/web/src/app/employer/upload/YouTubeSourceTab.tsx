"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "~/lib/auth-client";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
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
    const t = useTranslations("upload.youtube");
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
                    videoUrl: videoUrl.trim(),
                    category: videoCategory,
                    title: videoTitle.trim() || undefined,
                }),
            });
            if (!res.ok) {
                const err = (await res
                    .json()
                    .catch(() => ({ details: res.statusText }))) as TranscribeResponse;
                throw new Error(err.details ?? t("processFailed"));
            }
            const data = (await res.json()) as TranscribeResponse;
            toast.success(t("transcribed", { title: data.document?.title ?? t("fallbackTitle") }));
            setVideoUrl("");
            setVideoTitle("");
            setVideoCategory(defaultCategory ?? "");
            router.refresh();
            onSuccess?.();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t("processUrlFailed"));
        } finally {
            setIsSubmitting(false);
        }
    };

    const disabled = !videoUrl.trim() || !videoCategory || isSubmitting || !userId;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
                <label htmlFor="video-url" style={labelStyle}>
                    {t("urlLabel")}
                </label>
                <input
                    id="video-url"
                    type="url"
                    placeholder="https://www.youtube.com/watch?v=…"
                    value={videoUrl}
                    onChange={e => setVideoUrl(e.target.value)}
                    disabled={isSubmitting}
                    style={inputStyle}
                />
            </div>

            <div>
                <label htmlFor="video-title" style={labelStyle}>
                    {t("titleLabel")}{" "}
                    <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>{t("titleHint")}</span>
                </label>
                <input
                    id="video-title"
                    type="text"
                    placeholder={t("titlePlaceholder")}
                    value={videoTitle}
                    onChange={e => setVideoTitle(e.target.value)}
                    disabled={isSubmitting}
                    style={inputStyle}
                />
            </div>

            <div>
                <label htmlFor="video-category" style={labelStyle}>
                    {t("categoryLabel")}
                </label>
                <select
                    id="video-category"
                    value={videoCategory}
                    onChange={e => setVideoCategory(e.target.value)}
                    style={inputStyle}
                >
                    <option value="">{t("categoryPlaceholder")}</option>
                    {categories.map(c => (
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
                        {t("submitting")}
                    </>
                ) : (
                    t("submit")
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
                    {t("wait")}
                </div>
            )}

            <div
                style={{
                    fontSize: 11.5,
                    color: "var(--ink-3)",
                    textAlign: "center",
                }}
            >
                {t("supported")}
            </div>
        </div>
    );
}
