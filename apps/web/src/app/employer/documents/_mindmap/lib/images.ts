"use client";

/**
 * Bringing bitmaps onto the canvas.
 *
 * Images are stored inside the document as data URIs rather than as links to
 * uploaded files. That is the only form that survives export: an SVG loaded
 * through `<img>` — which is how PNG rasterising works — cannot fetch external
 * resources at all, so a linked image would silently vanish from every
 * exported PNG and SVG.
 *
 * The cost is document size, so everything is downscaled and re-encoded on the
 * way in.
 */

/** Longest edge kept, in pixels. Beyond this, canvas images stop earning bytes. */
export const MAX_IMAGE_DIMENSION = 1600;
/** JPEG quality used when re-encoding photographs. */
const JPEG_QUALITY = 0.86;

export interface LoadedImage {
    src: string;
    width: number;
    height: number;
}

export function isImageFile(file: File): boolean {
    return file.type.startsWith("image/");
}

/**
 * Read an image file, downscale it if oversized, and return a data URI with its
 * natural dimensions. PNG and SVG keep their format (transparency, vectors);
 * everything else is re-encoded as JPEG.
 */
export async function loadImageFile(file: File): Promise<LoadedImage> {
    if (file.type === "image/svg+xml") {
        const text = await file.text();
        const src = `data:image/svg+xml;base64,${toBase64(text)}`;
        const size = await naturalSize(src);
        return { src, ...size };
    }

    const original = await readAsDataUrl(file);
    const size = await naturalSize(original);
    const longest = Math.max(size.width, size.height);
    if (longest <= MAX_IMAGE_DIMENSION) return { src: original, ...size };

    const scale = MAX_IMAGE_DIMENSION / longest;
    const width = Math.round(size.width * scale);
    const height = Math.round(size.height * scale);

    const image = await loadImage(original);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { src: original, ...size };
    ctx.drawImage(image, 0, 0, width, height);

    const keepAlpha = file.type === "image/png" || file.type === "image/gif";
    const src = keepAlpha
        ? canvas.toDataURL("image/png")
        : canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return { src, width, height };
}

/** Fit an image's natural size into a sensible on-canvas box. */
export function fitImageBox(
    natural: { width: number; height: number },
    maxEdge = 420
): { w: number; h: number } {
    const longest = Math.max(natural.width, natural.height, 1);
    const scale = Math.min(1, maxEdge / longest);
    return {
        w: Math.max(Math.round(natural.width * scale), 16),
        h: Math.max(Math.round(natural.height * scale), 16),
    };
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            // `readAsDataURL` always yields a string; the union with ArrayBuffer
            // exists for the other read modes.
            const result = reader.result;
            if (typeof result === "string") resolve(result);
            else reject(new Error(`Could not read ${file.name}`));
        };
        reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
        reader.readAsDataURL(file);
    });
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("That file is not a readable image"));
        image.src = src;
    });
}

async function naturalSize(src: string): Promise<{ width: number; height: number }> {
    try {
        const image = await loadImage(src);
        // An SVG with no intrinsic size reports 0; fall back to a sane default
        // rather than creating a zero-area shape.
        return {
            width: image.naturalWidth || 320,
            height: image.naturalHeight || 240,
        };
    } catch {
        return { width: 320, height: 240 };
    }
}

function toBase64(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}
