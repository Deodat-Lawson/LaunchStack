"use client";

import { useEffect, useState } from "react";
import {
    ChevronLeft,
    ChevronRight,
    Copy,
    Download,
    ExternalLink,
    Minus,
    Plus,
    RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { copyText } from "~/lib/context-menu";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "~/components/ui/dialog";

export interface ChatMediaItem {
    src: string;
    name: string;
}

/** URLs are validated by the caller; gallery actions retain the exact original asset URL. */
export function ChatMediaGallery({
    items,
    initialIndex = 0,
    onClose,
}: {
    items: ChatMediaItem[];
    initialIndex?: number;
    onClose: () => void;
}) {
    const [index, setIndex] = useState(initialIndex);
    const [zoom, setZoom] = useState(100);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const item = items[index];
    useEffect(() => {
        setZoom(100);
        setFailed(false);
    }, [index]);
    if (!item) return null;
    return (
        <Dialog
            open
            onOpenChange={open => {
                if (!open) onClose();
            }}
        >
            <DialogContent
                className="max-h-[90dvh] max-w-[calc(100vw-24px)] overflow-hidden border-[var(--line)] bg-[var(--panel)] sm:max-w-4xl"
                onKeyDown={e => {
                    if ((e.target as HTMLElement).tagName === "INPUT") return;
                    if (e.key === "ArrowLeft") {
                        e.preventDefault();
                        setIndex(i => Math.max(0, i - 1));
                    }
                    if (e.key === "ArrowRight") {
                        e.preventDefault();
                        setIndex(i => Math.min(items.length - 1, i + 1));
                    }
                }}
            >
                <DialogTitle className="break-all pr-7 text-sm">
                    {item.name || "Image preview"}
                </DialogTitle>
                <DialogDescription>
                    Image {index + 1} of {items.length} · Use left and right arrow keys to navigate.
                </DialogDescription>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ink-3)]">
                    <button
                        type="button"
                        aria-label="Previous image"
                        disabled={index === 0}
                        onClick={() => setIndex(i => i - 1)}
                        className="rounded p-1.5 disabled:opacity-30"
                    >
                        <ChevronLeft size={15} />
                    </button>
                    <button
                        type="button"
                        aria-label="Next image"
                        disabled={index === items.length - 1}
                        onClick={() => setIndex(i => i + 1)}
                        className="rounded p-1.5 disabled:opacity-30"
                    >
                        <ChevronRight size={15} />
                    </button>
                    <button
                        type="button"
                        aria-label="Zoom out"
                        disabled={zoom <= 50}
                        onClick={() => setZoom(v => Math.max(50, v - 25))}
                        className="rounded p-1.5 disabled:opacity-30"
                    >
                        <Minus size={14} />
                    </button>
                    <span aria-live="polite">{zoom}%</span>
                    <button
                        type="button"
                        aria-label="Zoom in"
                        disabled={zoom >= 300}
                        onClick={() => setZoom(v => Math.min(300, v + 25))}
                        className="rounded p-1.5 disabled:opacity-30"
                    >
                        <Plus size={14} />
                    </button>
                    <button
                        type="button"
                        onClick={() =>
                            void copyText(item.src).then(ok =>
                                ok
                                    ? toast.success("Image URL copied")
                                    : toast.error("Couldn't copy image URL")
                            )
                        }
                        className="flex items-center gap-1 rounded p-1.5"
                    >
                        <Copy size={13} />
                        Copy URL
                    </button>
                    <a
                        href={item.src}
                        download={item.name}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 rounded p-1.5"
                    >
                        <Download size={13} />
                        Save
                    </a>
                    <a
                        href={item.src}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 rounded p-1.5"
                    >
                        <ExternalLink size={13} />
                        Original
                    </a>
                </div>
                <div className="max-h-[60dvh] overflow-auto rounded-lg bg-[var(--bg)] p-2">
                    {failed && (
                        <div
                            role="alert"
                            className="flex items-center gap-2 p-4 text-sm text-[var(--ink-3)]"
                        >
                            Image unavailable.
                            <button
                                type="button"
                                onClick={() => {
                                    setFailed(false);
                                    setAttempt(v => v + 1);
                                }}
                                className="flex items-center gap-1 underline"
                            >
                                <RotateCcw size={13} />
                                Retry loading
                            </button>
                        </div>
                    )}
                    {/* Native images support uploaded and external originals without proxying their bytes. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        key={`${index}:${attempt}`}
                        src={item.src}
                        alt={item.name}
                        onError={() => setFailed(true)}
                        style={{
                            width: `${zoom}%`,
                            maxWidth: "none",
                            height: "auto",
                            display: failed ? "none" : "block",
                            margin: "0 auto",
                        }}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}
