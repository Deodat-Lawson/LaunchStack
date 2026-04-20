"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Youtube, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/app/employer/documents/components/ui/button";
import { Input } from "~/app/employer/documents/components/ui/input";
import { Label } from "~/app/employer/documents/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/app/employer/documents/components/ui/select";

interface YouTubeSourceTabProps {
    categories: { id: string; name: string }[];
    defaultCategory?: string;
    onSuccess?: () => void;
}

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
                const err = await res
                    .json()
                    .catch(() => ({ details: res.statusText }));
                throw new Error(err.details || "Failed to process video");
            }
            const data = await res.json();
            toast.success(
                `Video transcribed successfully: "${data.document?.title || "Video"}"`,
            );
            setVideoUrl("");
            setVideoTitle("");
            setVideoCategory(defaultCategory ?? "");
            router.refresh();
            onSuccess?.();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to process video URL",
            );
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-purple-500/20 rounded-lg p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                    <Youtube className="w-5 h-5 text-red-600 dark:text-red-400" />
                </div>
                <div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        Import from YouTube or Video Platforms
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        Paste a video URL — audio will be extracted and transcribed into a
                        searchable document.
                    </p>
                </div>
            </div>

            <div className="space-y-4">
                <div>
                    <Label htmlFor="video-url">Video URL</Label>
                    <Input
                        id="video-url"
                        type="url"
                        placeholder="https://www.youtube.com/watch?v=..."
                        value={videoUrl}
                        onChange={(e) => setVideoUrl(e.target.value)}
                        disabled={isSubmitting}
                        className="mt-1"
                    />
                </div>

                <div>
                    <Label htmlFor="video-title">
                        Document Title{" "}
                        <span className="text-gray-400 text-xs font-normal">
                            (optional — defaults to video title)
                        </span>
                    </Label>
                    <Input
                        id="video-title"
                        type="text"
                        placeholder="e.g. Q1 All-Hands Recording"
                        value={videoTitle}
                        onChange={(e) => setVideoTitle(e.target.value)}
                        disabled={isSubmitting}
                        className="mt-1"
                    />
                </div>

                <div>
                    <Label htmlFor="video-category">Category</Label>
                    <Select
                        value={videoCategory || undefined}
                        onValueChange={(value) => setVideoCategory(value)}
                    >
                        <SelectTrigger id="video-category" className="mt-1">
                            <SelectValue placeholder="Select a category" />
                        </SelectTrigger>
                        <SelectContent>
                            {categories.length === 0 ? (
                                <div className="p-2 text-sm text-gray-500">
                                    No categories yet
                                </div>
                            ) : (
                                categories.map((c) => (
                                    <SelectItem key={c.id} value={c.name}>
                                        {c.name}
                                    </SelectItem>
                                ))
                            )}
                        </SelectContent>
                    </Select>
                </div>

                <Button
                    onClick={handleTranscribe}
                    disabled={
                        !videoUrl.trim() ||
                        !videoCategory ||
                        isSubmitting ||
                        !userId
                    }
                    className="w-full"
                >
                    {isSubmitting ? (
                        <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Transcribing...
                        </>
                    ) : (
                        "Transcribe & Upload"
                    )}
                </Button>

                {isSubmitting && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
                        This may take a few minutes depending on the video length. Please
                        don&apos;t close this page.
                    </p>
                )}

                <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
                    Supported: YouTube, Vimeo, TikTok, Twitter/X, Twitch, Dailymotion, and
                    more
                </p>
            </div>
        </div>
    );
}
