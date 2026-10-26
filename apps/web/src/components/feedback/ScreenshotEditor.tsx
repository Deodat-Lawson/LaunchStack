"use client";

/**
 * Mark up a screenshot before it is sent: draw a box round the problem, or
 * black out something that shouldn't leave the screen (a customer's name, a
 * figure). Boxes are kept in the image's own proportions while drawing and
 * burned into a new PNG at full resolution on Done — what the team receives
 * is exactly what the reporter saw here, with nothing hidden underneath.
 */

import React, { useEffect, useRef, useState } from "react";
import { Eraser, Square, SquareDashed, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";

type Tool = "highlight" | "redact";

interface Box {
    tool: Tool;
    /** 0–1, in the image's coordinates. */
    x: number;
    y: number;
    w: number;
    h: number;
}

function normalise(a: { x: number; y: number }, b: { x: number; y: number }, tool: Tool): Box {
    return {
        tool,
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w: Math.abs(a.x - b.x),
        h: Math.abs(a.y - b.y),
    };
}

/**
 * A design token as a colour the canvas accepts. Tokens can be oklch(), which
 * not every canvas parses; when it is refused the assignment is a no-op, so
 * the sentinel survives and the fallback is used instead.
 */
function canvasColor(ctx: CanvasRenderingContext2D, token: string, fallback: string): string {
    const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    ctx.fillStyle = "rgba(1, 2, 3, 0.5)";
    const sentinel = ctx.fillStyle;
    if (value) ctx.fillStyle = value;
    return value && ctx.fillStyle !== sentinel ? value : fallback;
}

export function ScreenshotEditor({
    src,
    onCancel,
    onDone,
}: {
    src: string;
    onCancel: () => void;
    onDone: (blob: Blob) => void;
}) {
    const t = useTranslations("feedback.editor");
    const [tool, setTool] = useState<Tool>("highlight");
    const [boxes, setBoxes] = useState<Box[]>([]);
    const [drawing, setDrawing] = useState<Box | null>(null);
    const [saving, setSaving] = useState(false);
    const start = useRef<{ x: number; y: number } | null>(null);
    const surface = useRef<HTMLDivElement>(null);
    const image = useRef<HTMLImageElement>(null);

    const point = (event: React.PointerEvent) => {
        const rect = surface.current!.getBoundingClientRect();
        return {
            x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
            y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
        };
    };

    const onPointerDown = (event: React.PointerEvent) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = point(event);
        setDrawing(normalise(start.current, start.current, tool));
    };
    const onPointerMove = (event: React.PointerEvent) => {
        if (!start.current) return;
        setDrawing(normalise(start.current, point(event), tool));
    };
    const onPointerUp = (event: React.PointerEvent) => {
        if (!start.current) return;
        const box = normalise(start.current, point(event), tool);
        start.current = null;
        setDrawing(null);
        const rect = surface.current!.getBoundingClientRect();
        // A click, not a drag: nothing to keep.
        if (box.w * rect.width < 6 || box.h * rect.height < 6) return;
        setBoxes(current => [...current, box]);
    };

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
                event.preventDefault();
                setBoxes(current => current.slice(0, -1));
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    const save = async () => {
        const img = image.current;
        if (!img) return;
        setSaving(true);
        try {
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("no 2d context");
            ctx.drawImage(img, 0, 0);
            // Named colours only as a last resort, for a canvas that can't
            // parse the token: a redaction must be opaque whatever happens.
            const highlight = canvasColor(ctx, "--danger", "red");
            const redact = canvasColor(ctx, "--ink", "black");
            const line = Math.max(3, Math.round(canvas.width / 320));
            for (const box of boxes) {
                const x = box.x * canvas.width;
                const y = box.y * canvas.height;
                const w = box.w * canvas.width;
                const h = box.h * canvas.height;
                if (box.tool === "redact") {
                    ctx.fillStyle = redact;
                    ctx.fillRect(x, y, w, h);
                } else {
                    ctx.strokeStyle = highlight;
                    ctx.lineWidth = line;
                    ctx.strokeRect(x, y, w, h);
                }
            }
            const blob = await new Promise<Blob | null>(resolve =>
                canvas.toBlob(resolve, "image/png")
            );
            if (blob) onDone(blob);
        } finally {
            setSaving(false);
        }
    };

    const shown = drawing ? [...boxes, drawing] : boxes;

    return (
        <div className="flex min-w-0 flex-col gap-3" data-testid="feedback-editor">
            <div className="flex flex-wrap items-center gap-2">
                <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={tool}
                    onValueChange={value => value && setTool(value as Tool)}
                    aria-label={t("tool")}
                >
                    <ToggleGroupItem value="highlight" className="shrink-0 gap-1.5 px-2.5">
                        <SquareDashed aria-hidden />
                        {t("highlight")}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="redact" className="shrink-0 gap-1.5 px-2.5">
                        <Square aria-hidden className="fill-current" />
                        {t("redact")}
                    </ToggleGroupItem>
                </ToggleGroup>
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={boxes.length === 0}
                    onClick={() => setBoxes(current => current.slice(0, -1))}
                >
                    <Undo2 aria-hidden />
                    {t("undo")}
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={boxes.length === 0}
                    onClick={() => setBoxes([])}
                >
                    <Eraser aria-hidden />
                    {t("clear")}
                </Button>
                <span className="text-ink-3 @max-sm:basis-full ml-auto text-xs">
                    {t(tool === "redact" ? "redactHint" : "highlightHint")}
                </span>
            </div>
            <div className="bg-panel-2 border-line flex max-h-[62vh] justify-center overflow-auto rounded-md border p-2">
                <div
                    ref={surface}
                    className="relative cursor-crosshair touch-none select-none"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={() => {
                        start.current = null;
                        setDrawing(null);
                    }}
                >
                    {/* eslint-disable-next-line @next/next/no-img-element -- an object URL, not an optimisable asset */}
                    <img
                        ref={image}
                        src={src}
                        alt={t("imageAlt")}
                        draggable={false}
                        className="block max-h-[58vh] w-auto max-w-full"
                    />
                    {shown.map((box, i) => (
                        <div
                            key={i}
                            aria-hidden
                            className={cn(
                                "pointer-events-none absolute",
                                box.tool === "redact"
                                    ? "bg-ink"
                                    : "border-danger rounded-[2px] border-[3px]"
                            )}
                            style={{
                                left: `${box.x * 100}%`,
                                top: `${box.y * 100}%`,
                                width: `${box.w * 100}%`,
                                height: `${box.h * 100}%`,
                            }}
                        />
                    ))}
                </div>
            </div>
            <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={onCancel} disabled={saving}>
                    {t("cancel")}
                </Button>
                <Button
                    onClick={() => void save()}
                    disabled={saving}
                    data-testid="feedback-editor-done"
                >
                    {t("done")}
                </Button>
            </div>
        </div>
    );
}
