"use client";

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Loader2, AlertTriangle, RotateCw, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

export type ImageFitMode = "fit-view" | "fit-width" | "fit-height" | "actual";

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3] as const;

export interface ImageViewerProps {
    src: string;
    alt: string;
    minimal?: boolean;
}

export function ImageViewer({ src, alt, minimal = false }: ImageViewerProps) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [fitMode, setFitMode] = useState<ImageFitMode>("fit-view");
    const [zoomLevel, setZoomLevel] = useState(1);
    const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
    const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(
        null
    );
    const containerRef = useRef<HTMLDivElement>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);

    // Track container size for small-image detection
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const observer = new ResizeObserver(entries => {
            const entry = entries[0];
            if (entry) {
                const { width, height } = entry.contentRect;
                setContainerSize({ width, height });
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        setLoading(true);
        setError(false);
        setDimensions(null);
        setFitMode("fit-view");
        setZoomLevel(1);
    }, [src]);

    const handleLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
        const img = e.currentTarget;
        setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
        setLoading(false);
    }, []);

    const handleError = useCallback(() => {
        setLoading(false);
        setError(true);
    }, []);

    const handleRetry = useCallback(() => {
        setLoading(true);
        setError(false);
    }, []);

    // Zoom controls
    const zoomIn = useCallback(() => {
        const idx = ZOOM_STEPS.findIndex(s => s >= zoomLevel);
        const nextIdx = idx >= 0 ? Math.min(idx + 1, ZOOM_STEPS.length - 1) : ZOOM_STEPS.length - 1;
        setZoomLevel(ZOOM_STEPS[nextIdx] ?? 1);
        setFitMode("actual");
    }, [zoomLevel]);

    const zoomOut = useCallback(() => {
        const idx = ZOOM_STEPS.findIndex(s => s >= zoomLevel);
        const nextIdx = idx > 0 ? idx - 1 : 0;
        setZoomLevel(ZOOM_STEPS[nextIdx] ?? 0.5);
        setFitMode("actual");
    }, [zoomLevel]);

    const resetView = useCallback(() => {
        setFitMode("fit-view");
        setZoomLevel(1);
    }, []);

    const handleDoubleClick = useCallback(() => {
        if (fitMode === "fit-view") {
            setFitMode("actual");
            setZoomLevel(1);
        } else {
            resetView();
        }
    }, [fitMode, resetView]);

    // Keyboard shortcuts
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (error || loading) return;
            if (
                e.target instanceof HTMLElement &&
                (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")
            )
                return;

            switch (e.key) {
                case "+":
                case "=":
                    e.preventDefault();
                    zoomIn();
                    break;
                case "-":
                    e.preventDefault();
                    zoomOut();
                    break;
                case "0":
                    e.preventDefault();
                    resetView();
                    break;
                default:
                    break;
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [error, loading, zoomIn, zoomOut, resetView]);

    // Compute object-fit and sizing based on fit mode and zoom
    const getImageStyle = (): React.CSSProperties => {
        if (fitMode === "actual" || zoomLevel !== 1) {
            const scale = zoomLevel;
            return {
                width: dimensions ? dimensions.width * scale : "auto",
                height: dimensions ? dimensions.height * scale : "auto",
                maxWidth: "none",
                objectFit: "none",
            };
        }

        switch (fitMode) {
            case "fit-width":
                return { width: "100%", height: "auto", objectFit: "contain" as const };
            case "fit-height":
                return { width: "auto", height: "100%", objectFit: "contain" as const };
            case "fit-view":
            default:
                return { width: "100%", height: "100%", objectFit: "contain" as const };
        }
    };

    const needsScroll = fitMode === "actual" || zoomLevel !== 1;

    // Image smaller than viewport: only in actual/zoom mode (fit modes scale to fill)
    const displayedWidth = dimensions ? dimensions.width * zoomLevel : 0;
    const displayedHeight = dimensions ? dimensions.height * zoomLevel : 0;
    const isSmallerThanViewport =
        (fitMode === "actual" || zoomLevel !== 1) &&
        !!dimensions &&
        !!containerSize &&
        displayedWidth > 0 &&
        displayedHeight > 0 &&
        displayedWidth < containerSize.width - 32 &&
        displayedHeight < containerSize.height - 32;

    // Very small image (both dims < 128px) - for pixelated rendering when zoomed
    const isVerySmallImage = !!dimensions && dimensions.width < 128 && dimensions.height < 128;

    // Respect prefers-reduced-motion for zoom transitions
    const prefersReducedMotion = useMemo(() => {
        if (typeof window === "undefined") return false;
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }, []);

    if (error) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-900/20">
                    <AlertTriangle className="h-7 w-7 text-red-500" />
                </div>
                <div>
                    <p className="text-foreground mb-1 text-sm font-medium">Failed to load image</p>
                    <Button
                        onClick={handleRetry}
                        className="mt-3 inline-flex gap-2 bg-purple-600 text-white hover:bg-purple-700"
                    >
                        <RotateCw className="h-4 w-4" />
                        Retry
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div
            className="bg-muted/30 flex h-full flex-col"
            role="img"
            aria-label={alt ? `Image: ${alt}` : "Image viewer"}
        >
            {/* Toolbar - hidden in minimal mode */}
            {!minimal && (
                <div className="border-border bg-background/80 flex flex-shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
                    <div className="flex items-center gap-1">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
                                    {fitMode === "fit-view" && "Fit to view"}
                                    {fitMode === "fit-width" && "Fit to width"}
                                    {fitMode === "fit-height" && "Fit to height"}
                                    {fitMode === "actual" && "Actual size"}
                                    <span className="opacity-60">▾</span>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                                <DropdownMenuItem onClick={() => setFitMode("fit-view")}>
                                    Fit to view
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setFitMode("fit-width")}>
                                    Fit to width
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setFitMode("fit-height")}>
                                    Fit to height
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() => {
                                        setFitMode("actual");
                                        setZoomLevel(1);
                                    }}
                                >
                                    Actual size (1:1)
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>

                        <div className="bg-border mx-1 h-4 w-px" />

                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={zoomOut}
                            disabled={zoomLevel <= ZOOM_STEPS[0]}
                            aria-label="Zoom out"
                        >
                            <ZoomOut className="h-3.5 w-3.5" />
                        </Button>
                        <span className="text-muted-foreground min-w-[3rem] text-center text-xs tabular-nums">
                            {Math.round(zoomLevel * 100)}%
                        </span>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={zoomIn}
                            disabled={zoomLevel >= (ZOOM_STEPS.at(-1) ?? 3)}
                            aria-label="Zoom in"
                        >
                            <ZoomIn className="h-3.5 w-3.5" />
                        </Button>

                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={resetView}
                            aria-label="Reset view"
                        >
                            <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                    </div>

                    {dimensions &&
                        (isSmallerThanViewport ? (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <span className="text-muted-foreground cursor-help text-xs tabular-nums underline decoration-dotted underline-offset-1">
                                        {dimensions.width} × {dimensions.height}
                                    </span>
                                </TooltipTrigger>
                                <TooltipContent>Image is smaller than viewport</TooltipContent>
                            </Tooltip>
                        ) : (
                            <span className="text-muted-foreground text-xs tabular-nums">
                                {dimensions.width} × {dimensions.height}
                            </span>
                        ))}
                </div>
            )}

            {/* Image area */}
            <div
                ref={containerRef}
                className={cn(
                    "relative flex min-h-[200px] flex-1 items-center justify-center p-4",
                    needsScroll && "overflow-auto"
                )}
            >
                {!error && (
                    <div
                        className={cn(
                            "relative flex items-center justify-center",
                            !needsScroll && "h-full w-full",
                            needsScroll && "min-h-full min-w-full"
                        )}
                        onDoubleClick={handleDoubleClick}
                    >
                        <div
                            className={cn(
                                "inline-flex items-center justify-center",
                                isSmallerThanViewport &&
                                    "border-border bg-background/50 rounded-lg border p-2 shadow-sm"
                            )}
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element -- Dynamic sizing, fit modes, zoom require native img */}
                            <img
                                ref={imgRef}
                                src={src}
                                alt={alt}
                                style={{
                                    ...getImageStyle(),
                                    transition: prefersReducedMotion
                                        ? "none"
                                        : "opacity 0.2s ease-in-out",
                                    imageRendering:
                                        isVerySmallImage && zoomLevel >= 1
                                            ? "pixelated"
                                            : undefined,
                                }}
                                className={cn(
                                    "select-none rounded-lg shadow-md",
                                    !dimensions
                                        ? "max-h-full max-w-full object-contain"
                                        : "cursor-zoom-in",
                                    loading && "opacity-0",
                                    !loading && "opacity-100"
                                )}
                                onLoad={handleLoad}
                                onError={handleError}
                                draggable={false}
                            />
                        </div>
                        {loading && (
                            <div
                                className="bg-muted/30 absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-lg"
                                aria-label="Loading image"
                            >
                                <div className="bg-muted-foreground/10 h-32 w-48 animate-pulse rounded-xl" />
                                <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
