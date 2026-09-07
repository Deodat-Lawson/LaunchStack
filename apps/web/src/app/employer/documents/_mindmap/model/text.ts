/**
 * Text measurement and wrapping.
 *
 * SVG has no automatic line breaking, so shape labels are laid out here and
 * rendered as one `<tspan>` per line. The same routine drives auto-sizing
 * ("fit shape to text") and the export path, so what you measure is what gets
 * drawn.
 *
 * In the browser a shared offscreen 2D context gives real metrics; under Jest
 * (no canvas) it falls back to a width table that is accurate enough for
 * layout tests to be meaningful.
 */

import type { FontFamily, TextStyle } from "./types";

export interface TextLine {
    text: string;
    width: number;
}

export interface LayoutTextResult {
    lines: TextLine[];
    width: number;
    height: number;
    lineHeight: number;
}

const FONT_STACK: Record<FontFamily, string> = {
    sans: "var(--font-sans)",
    serif: "var(--font-serif)",
    mono: "var(--font-mono)",
};

export function fontFamilyCss(family: FontFamily): string {
    return FONT_STACK[family];
}

/** CSS `font` shorthand for a style, used for both canvas metrics and SVG. */
function fontShorthand(style: TextStyle): string {
    const weight = style.bold ? "700" : "400";
    const italic = style.italic ? "italic " : "";
    const family =
        style.family === "mono"
            ? "ui-monospace, monospace"
            : style.family === "serif"
              ? "Georgia, serif"
              : "system-ui, sans-serif";
    return `${italic}${weight} ${style.size}px ${family}`;
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

let ctx: CanvasRenderingContext2D | null = null;
/**
 * Separate from `ctx` on purpose: "we already tried and got nothing" has to be
 * distinguishable from "we have not tried yet". Keying the memo on the value
 * alone means a null/undefined result is never cached, and text measurement —
 * which runs for every label on every render — allocates a fresh canvas each
 * time it is called.
 */
let contextResolved = false;

function measureContext(): CanvasRenderingContext2D | null {
    if (contextResolved) return ctx;
    contextResolved = true;
    if (typeof document === "undefined") return ctx;
    try {
        ctx = document.createElement("canvas").getContext("2d") ?? null;
    } catch {
        ctx = null;
    }
    return ctx;
}

/** Rough per-character advance as a multiple of font size, by family. */
const FALLBACK_RATIO: Record<FontFamily, number> = { sans: 0.52, serif: 0.5, mono: 0.6 };
const NARROW = new Set([..."iljtfIr.,;:'!|()[]{}`"]);
const WIDE = new Set([..."mwMW@%"]);

function fallbackWidth(text: string, style: TextStyle): number {
    const base = style.size * FALLBACK_RATIO[style.family];
    let total = 0;
    for (const ch of text) {
        if (ch === " ") total += base * 0.5;
        else if (NARROW.has(ch)) total += base * 0.5;
        else if (WIDE.has(ch)) total += base * 1.5;
        else total += base;
    }
    return total * (style.bold ? 1.05 : 1);
}

export function measureText(text: string, style: TextStyle): number {
    if (!text) return 0;
    const c = measureContext();
    if (!c) return fallbackWidth(text, style);
    c.font = fontShorthand(style);
    return c.measureText(text).width;
}

// ---------------------------------------------------------------------------
// Wrapping
// ---------------------------------------------------------------------------

/**
 * Greedy word wrap with hard-break fallback for words longer than the box.
 * Explicit newlines in the source are always honoured.
 */
export function wrapText(text: string, style: TextStyle, maxWidth: number): TextLine[] {
    const lines: TextLine[] = [];
    const paragraphs = text.split("\n");

    for (const paragraph of paragraphs) {
        if (paragraph === "") {
            lines.push({ text: "", width: 0 });
            continue;
        }
        if (maxWidth <= 0) {
            lines.push({ text: paragraph, width: measureText(paragraph, style) });
            continue;
        }

        // Whitespace runs are kept as their own tokens so a line break lands
        // *between* words and the trailing run is dropped, not measured.
        const tokens = paragraph.split(/(\s+)/).filter(t => t !== "");
        let current = "";

        const flush = () => {
            const text = current.replace(/\s+$/, "");
            lines.push({ text, width: measureText(text, style) });
            current = "";
        };

        for (const token of tokens) {
            const isSpace = /^\s+$/.test(token);
            if (isSpace && current === "") continue; // no leading indent on a wrapped line
            const candidate = current + token;
            if (measureText(candidate, style) <= maxWidth) {
                current = candidate;
                continue;
            }
            if (isSpace) {
                // The break falls in the gap: end the line, swallow the space.
                flush();
                continue;
            }
            if (current !== "") flush();
            if (measureText(token, style) <= maxWidth) {
                current = token;
                continue;
            }
            // A single word wider than the box — break it character-wise.
            let chunk = "";
            for (const ch of token) {
                const next = chunk + ch;
                if (measureText(next, style) > maxWidth && chunk !== "") {
                    lines.push({ text: chunk, width: measureText(chunk, style) });
                    chunk = ch;
                } else {
                    chunk = next;
                }
            }
            current = chunk;
        }
        if (current !== "") flush();
    }

    // A trailing empty paragraph keeps the caret line visible while editing.
    return lines.length > 0 ? lines : [{ text: "", width: 0 }];
}

export function layoutText(text: string, style: TextStyle, maxWidth: number): LayoutTextResult {
    const lines = wrapText(text, style, maxWidth);
    const lineHeight = style.size * style.lineHeight;
    return {
        lines,
        width: lines.reduce((m, l) => Math.max(m, l.width), 0),
        height: lines.length * lineHeight,
        lineHeight,
    };
}

/**
 * Box a shape needs so `text` fits without wrapping more than `maxLines`.
 * Returns content size; callers add the shape's own padding.
 */
export function preferredTextSize(
    text: string,
    style: TextStyle,
    maxWidth: number
): { w: number; h: number } {
    const laid = layoutText(text, style, maxWidth);
    return { w: Math.ceil(laid.width), h: Math.ceil(laid.height) };
}

/** Baseline offset of the first line for a given vertical alignment. */
export function firstBaseline(
    boxHeight: number,
    laid: LayoutTextResult,
    valign: TextStyle["valign"]
): number {
    const ascent = laid.lineHeight * 0.78;
    if (valign === "top") return ascent;
    if (valign === "bottom") return boxHeight - laid.height + ascent;
    return (boxHeight - laid.height) / 2 + ascent;
}
