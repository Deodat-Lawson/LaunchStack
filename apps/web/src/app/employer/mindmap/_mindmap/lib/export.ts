"use client";

import { pageBounds } from "../model/doc";
import { expandRect } from "../model/geometry";
import { serializeDoc, toMarkdownOutline, toMermaid } from "../model/serialize";
import type { DiagramPage, MindmapDoc, Rect } from "../model/types";

/**
 * Export.
 *
 * SVG is produced by cloning the live canvas element rather than re-rendering
 * the document through a second, string-building renderer. There is then no
 * possibility of the export disagreeing with what the user is looking at, and
 * every future shape works in export for free. Editor chrome is stripped by
 * marking it in the DOM (`data-export="omit"`), not by guessing at class names.
 */

export const OMIT_ATTR = "data-export";

export interface SvgExportOptions {
    /** World rect to export. Defaults to the page's content bounds. */
    bounds?: Rect;
    /** Margin in world units around the bounds. */
    padding?: number;
    /** Paint a solid background rather than leaving it transparent. */
    background?: string | null;
}

/**
 * Clone the canvas SVG into a standalone, self-contained document string.
 *
 * Design tokens are resolved to literal colours: a `var(--panel)` in the export
 * would render as nothing outside the app, and the file has to open in Figma,
 * a browser, or an email client.
 */
export function exportSvg(source: SVGSVGElement, options: SvgExportOptions = {}): string {
    const clone = source.cloneNode(true) as SVGSVGElement;

    for (const el of Array.from(clone.querySelectorAll(`[${OMIT_ATTR}="omit"]`))) {
        el.remove();
    }
    // Interaction-only geometry: transparent hit paths and handles.
    for (const el of Array.from(
        clone.querySelectorAll("[data-handle], [data-port], [data-endpoint], [data-waypoint]")
    )) {
        el.remove();
    }
    for (const el of Array.from(
        clone.querySelectorAll('[stroke="transparent"], [fill="transparent"]')
    )) {
        if (el.getAttribute("stroke") === "transparent") el.setAttribute("stroke", "none");
        if (el.getAttribute("fill") === "transparent") el.setAttribute("fill", "none");
    }

    resolveCssVariables(clone, source);

    const bounds = options.bounds ?? readViewBox(source);
    const padded = expandRect(bounds, options.padding ?? 32);
    clone.setAttribute("viewBox", `${padded.x} ${padded.y} ${padded.w} ${padded.h}`);
    clone.setAttribute("width", String(Math.round(padded.w)));
    clone.setAttribute("height", String(Math.round(padded.h)));
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    clone.removeAttribute("style");

    if (options.background) {
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", String(padded.x));
        rect.setAttribute("y", String(padded.y));
        rect.setAttribute("width", String(padded.w));
        rect.setAttribute("height", String(padded.h));
        rect.setAttribute("fill", options.background);
        clone.insertBefore(rect, clone.firstChild);
    }

    return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

const COLOR_ATTRS = ["fill", "stroke", "stop-color", "flood-color", "color"] as const;

/**
 * Replace every `var(--token)` reference with the computed value from the live
 * document, so the exported file needs no stylesheet.
 */
function resolveCssVariables(clone: SVGSVGElement, source: SVGSVGElement): void {
    const computed = getComputedStyle(source);
    const cache = new Map<string, string>();

    const resolve = (value: string): string => {
        if (!value.includes("var(")) return value;
        const cached = cache.get(value);
        if (cached !== undefined) return cached;
        // Handles `var(--x)` and `var(--x, fallback)`; nested vars resolve
        // because the computed style already flattened them.
        const out = value.replace(
            /var\(\s*(--[\w-]+)\s*(?:,([^)]*))?\)/g,
            (_, name: string, fallback?: string) => {
                const resolved = computed.getPropertyValue(name).trim();
                return resolved || (fallback ?? "").trim() || "none";
            }
        );
        cache.set(value, out);
        return out;
    };

    const walk = (el: Element) => {
        for (const attr of COLOR_ATTRS) {
            const value = el.getAttribute(attr);
            if (value) el.setAttribute(attr, resolve(value));
        }
        const style = el.getAttribute("style");
        if (style?.includes("var(")) el.setAttribute("style", resolve(style));
        const fontFamily = el.getAttribute("font-family");
        if (fontFamily?.includes("var(")) {
            el.setAttribute("font-family", resolve(fontFamily) || "sans-serif");
        }
        for (const child of Array.from(el.children)) walk(child);
    };

    walk(clone);
}

function readViewBox(svg: SVGSVGElement): Rect {
    const raw = svg.getAttribute("viewBox") ?? "0 0 800 600";
    const [x, y, w, h] = raw.split(/\s+/).map(Number);
    return { x: x ?? 0, y: y ?? 0, w: w ?? 800, h: h ?? 600 };
}

// ---------------------------------------------------------------------------
// Raster
// ---------------------------------------------------------------------------

/**
 * Rasterise an SVG string. `scale` multiplies the natural size, so 2 gives a
 * retina-sharp PNG.
 */
export async function svgToPngBlob(svg: string, scale = 2): Promise<Blob> {
    const image = await loadSvgImage(svg);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is unavailable in this browser");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            blob => (blob ? resolve(blob) : reject(new Error("Failed to encode PNG"))),
            "image/png"
        );
    });
}

/** Small PNG data URI for the document list's card. */
export async function svgToThumbnail(svg: string, maxWidth = 480): Promise<string> {
    const image = await loadSvgImage(svg);
    const scale = Math.min(1, maxWidth / Math.max(image.width, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is unavailable in this browser");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png", 0.8);
}

/** btoa only accepts latin-1, so UTF-8 has to be widened byte by byte first. */
function toBase64(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
    // A data: URL rather than a blob: URL — Safari taints the canvas for blob
    // URLs carrying SVG, which makes toDataURL throw.
    const encoded = `data:image/svg+xml;base64,${toBase64(svg)}`;
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Failed to rasterise the diagram"));
        image.src = encoded;
    });
}

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------

export function downloadBlob(filename: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoking immediately can cancel the download in Firefox.
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(filename: string, text: string, mime: string): void {
    downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}

export function safeFilename(title: string, extension: string): string {
    const base =
        title
            .trim()
            .replace(/[^\w\s-]/g, "")
            .replace(/\s+/g, "-")
            .slice(0, 80) || "mindmap";
    return `${base}.${extension}`;
}

// ---------------------------------------------------------------------------
// Format entry points
// ---------------------------------------------------------------------------

export type ExportFormat = "png" | "svg" | "pdf" | "json" | "markdown" | "mermaid";

/**
 * A one-page PDF sized to the diagram.
 *
 * The page is the drawing, not a letter-sized sheet with the drawing floating
 * on it: a diagram has no natural paper size, and shrinking a wide flowchart
 * onto A4 is what makes exported diagrams unreadable. `pdf-lib` is already a
 * dependency, and it is imported dynamically so the ~300 kB only loads for
 * someone who actually asks for a PDF.
 */
/**
 * pdf-lib's bundled `.d.ts` files do not surface `PDFPage`'s draw methods in
 * this project: `PDFPageOptions.d.ts` resolves but contributes no exports, so
 * every member typed against it (`drawImage`, `drawText`, …) disappears from
 * `PDFPage`. `api/document-generator/export/route.ts` papers over the same gap
 * with `any`; declaring the one method we call keeps this call site checked.
 */
interface DrawablePdfPage {
    drawImage(
        image: unknown,
        options: { x: number; y: number; width: number; height: number }
    ): void;
}

export async function svgToPdfBlob(svg: string, scale = 2): Promise<Blob> {
    const { PDFDocument } = await import("pdf-lib");
    const png = await svgToPngBlob(svg, scale);

    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(new Uint8Array(await png.arrayBuffer()));
    // Back down to CSS pixels so the PDF measures the same as the canvas did.
    const width = image.width / scale;
    const height = image.height / scale;
    const page = pdf.addPage([width, height]) as unknown as DrawablePdfPage;
    page.drawImage(image, { x: 0, y: 0, width, height });

    // Copy into a fresh ArrayBuffer: `save()` returns a view whose buffer type
    // is wider than `BlobPart` accepts.
    const saved = await pdf.save();
    const buffer = new ArrayBuffer(saved.byteLength);
    new Uint8Array(buffer).set(saved);
    return new Blob([buffer], { type: "application/pdf" });
}

export interface ExportRequest {
    format: ExportFormat;
    doc: MindmapDoc;
    page: DiagramPage;
    svgElement: SVGSVGElement | null;
    /** Export just the current selection's bounds. */
    bounds?: Rect;
    scale?: number;
    transparent?: boolean;
}

export async function runExport(request: ExportRequest): Promise<void> {
    const { doc, page, format } = request;

    if (format === "json") {
        downloadText(
            safeFilename(doc.title, "mindmap.json"),
            serializeDoc(doc),
            "application/json"
        );
        return;
    }
    if (format === "markdown") {
        downloadText(safeFilename(doc.title, "md"), toMarkdownOutline(doc), "text/markdown");
        return;
    }
    if (format === "mermaid") {
        downloadText(safeFilename(doc.title, "mmd"), toMermaid(doc, page.id), "text/plain");
        return;
    }

    if (!request.svgElement) throw new Error("The canvas is not ready yet");
    const bounds = request.bounds ?? pageBounds(page) ?? undefined;
    const svg = exportSvg(request.svgElement, {
        bounds,
        background: request.transparent ? null : page.background.color,
    });

    if (format === "svg") {
        downloadText(safeFilename(doc.title, "svg"), svg, "image/svg+xml");
        return;
    }
    if (format === "pdf") {
        downloadBlob(safeFilename(doc.title, "pdf"), await svgToPdfBlob(svg, request.scale ?? 2));
        return;
    }
    const blob = await svgToPngBlob(svg, request.scale ?? 2);
    downloadBlob(safeFilename(doc.title, "png"), blob);
}

/** Copy the current page to the clipboard as an image, where supported. */
export async function copyPageAsImage(svgElement: SVGSVGElement, page: DiagramPage): Promise<void> {
    const svg = exportSvg(svgElement, {
        bounds: pageBounds(page) ?? undefined,
        background: page.background.color,
    });
    const blob = await svgToPngBlob(svg, 2);
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
        throw new Error("This browser cannot copy images to the clipboard");
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}
