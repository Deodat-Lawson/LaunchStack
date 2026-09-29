"use client";

/**
 * Position and zoom a new profile photo before it is saved — the step every
 * profile editor puts between picking a file and using it.
 *
 * The crop happens here, in the browser: the canvas output is a square PNG
 * of the stored size, so the upload is small whatever the original was, and
 * anything the browser can display (Safari opens HEIC) can become a photo.
 * The server re-encodes what arrives anyway; it never trusts these bytes.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Slider } from "~/components/ui/slider";
import {
    CROP_MAX_ZOOM,
    INITIAL_CROP,
    clampCrop,
    cropLayout,
    cropSourceRect,
    zoomCrop,
    type CropState,
    type ImageSize,
} from "~/lib/profile/crop";
import { PROFILE_PHOTO } from "~/lib/profile/fields";

import { StatusNote } from "./ui";

const VIEWPORT = 280;
const KEY_STEP = 12;

export function ProfilePhotoDialog({
    file,
    title,
    description,
    onClose,
    onSave,
}: {
    /** The picked file; the dialog is open while this is set. */
    file: File | null;
    title: string;
    description: string;
    onClose: () => void;
    /** Receives the cropped square. Throw to keep the dialog open with the message. */
    onSave: (square: Blob) => Promise<void>;
}) {
    const [src, setSrc] = useState<string | null>(null);
    const [size, setSize] = useState<ImageSize | null>(null);
    const [crop, setCrop] = useState<CropState>(INITIAL_CROP);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const imageRef = useRef<HTMLImageElement>(null);
    const drag = useRef<{ x: number; y: number; from: CropState } | null>(null);

    useEffect(() => {
        if (!file) return;
        const url = URL.createObjectURL(file);
        setSrc(url);
        setSize(null);
        setCrop(INITIAL_CROP);
        setError(null);
        return () => URL.revokeObjectURL(url);
    }, [file]);

    const update = useCallback(
        (next: CropState) => {
            if (size) setCrop(clampCrop(next, size, VIEWPORT));
        },
        [size]
    );

    const zoomTo = (zoom: number) => {
        if (size) setCrop(current => zoomCrop(current, zoom, size, VIEWPORT));
    };

    const onKeyDown = (event: React.KeyboardEvent) => {
        const moves: Record<string, [number, number]> = {
            ArrowLeft: [KEY_STEP, 0],
            ArrowRight: [-KEY_STEP, 0],
            ArrowUp: [0, KEY_STEP],
            ArrowDown: [0, -KEY_STEP],
        };
        const move = moves[event.key];
        if (move) {
            event.preventDefault();
            update({ ...crop, offsetX: crop.offsetX + move[0], offsetY: crop.offsetY + move[1] });
        } else if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            zoomTo(crop.zoom + 0.2);
        } else if (event.key === "-") {
            event.preventDefault();
            zoomTo(crop.zoom - 0.2);
        }
    };

    const save = async () => {
        const image = imageRef.current;
        if (!image || !size) return;
        setSaving(true);
        setError(null);
        try {
            const rect = cropSourceRect(crop, size, VIEWPORT);
            const canvas = document.createElement("canvas");
            canvas.width = PROFILE_PHOTO.outputSize;
            canvas.height = PROFILE_PHOTO.outputSize;
            const context = canvas.getContext("2d");
            if (!context) throw new Error("Your browser couldn't prepare the photo.");
            context.imageSmoothingQuality = "high";
            context.drawImage(
                image,
                rect.x,
                rect.y,
                rect.size,
                rect.size,
                0,
                0,
                canvas.width,
                canvas.height
            );
            const square = await new Promise<Blob | null>(resolve =>
                canvas.toBlob(resolve, "image/png")
            );
            if (!square) throw new Error("Your browser couldn't prepare the photo.");
            await onSave(square);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not save the photo.");
        } finally {
            setSaving(false);
        }
    };

    const layout = size ? cropLayout(crop, size, VIEWPORT) : null;

    return (
        <Dialog open={file !== null} onOpenChange={open => !open && !saving && onClose()}>
            <DialogContent className="sm:max-w-[380px]">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>

                <div
                    role="group"
                    tabIndex={0}
                    aria-label="Photo position. Drag or use the arrow keys to move it, plus and minus to zoom."
                    className="bg-panel-2 focus-visible:ring-brand/50 relative mx-auto cursor-grab touch-none select-none overflow-hidden rounded-lg outline-none focus-visible:ring-[3px] active:cursor-grabbing"
                    style={{ width: VIEWPORT, height: VIEWPORT }}
                    onKeyDown={onKeyDown}
                    onPointerDown={event => {
                        event.currentTarget.setPointerCapture(event.pointerId);
                        drag.current = { x: event.clientX, y: event.clientY, from: crop };
                    }}
                    onPointerMove={event => {
                        const start = drag.current;
                        if (!start) return;
                        update({
                            ...start.from,
                            offsetX: start.from.offsetX + event.clientX - start.x,
                            offsetY: start.from.offsetY + event.clientY - start.y,
                        });
                    }}
                    onPointerUp={() => {
                        drag.current = null;
                    }}
                    onPointerCancel={() => {
                        drag.current = null;
                    }}
                    onWheel={event => zoomTo(crop.zoom * (1 - event.deltaY * 0.0015))}
                >
                    {src && (
                        // eslint-disable-next-line @next/next/no-img-element -- a local blob URL, positioned by the crop
                        <img
                            ref={imageRef}
                            src={src}
                            alt=""
                            draggable={false}
                            onLoad={event =>
                                setSize({
                                    width: event.currentTarget.naturalWidth,
                                    height: event.currentTarget.naturalHeight,
                                })
                            }
                            onError={() =>
                                setError(
                                    `Your browser can't open that file. Try a ${PROFILE_PHOTO.acceptLabel}.`
                                )
                            }
                            className="pointer-events-none absolute max-w-none"
                            style={
                                layout
                                    ? {
                                          left: layout.left,
                                          top: layout.top,
                                          width: layout.width,
                                          height: layout.height,
                                      }
                                    : { opacity: 0 }
                            }
                        />
                    )}
                    {/* Everything outside the circle is what gets cut. */}
                    <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_var(--scrim)]" />
                </div>

                <div className="flex items-center gap-3 px-2">
                    <ZoomOut className="text-ink-3 size-4 shrink-0" aria-hidden />
                    <Slider
                        aria-label="Zoom"
                        min={1}
                        max={CROP_MAX_ZOOM}
                        step={0.01}
                        value={[crop.zoom]}
                        disabled={!size}
                        onValueChange={([zoom]) => zoom !== undefined && zoomTo(zoom)}
                    />
                    <ZoomIn className="text-ink-3 size-4 shrink-0" aria-hidden />
                </div>

                {error && (
                    <StatusNote tone="danger" style={{ marginBottom: 0 }}>
                        {error}
                    </StatusNote>
                )}

                <DialogFooter>
                    <Button variant="ghost" onClick={onClose} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={() => void save()} disabled={!size || saving}>
                        {saving ? "Saving…" : "Save photo"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
