"use client";

import { useEffect, useRef, useState } from "react";

/**
 * How fast streamed text is revealed. Providers send an answer in uneven
 * bursts (some send it all at once after thinking); the reader should see it
 * flow at a steady pace instead. The pace follows the backlog: a big burst
 * reveals quickly, a trickle reveals as it arrives, and the reveal never lags
 * a live stream by more than about LAG_S.
 */
export const REVEAL = {
    /** Seconds of backlog the reveal aims to carry. */
    LAG_S: 0.5,
    /** Characters per second, at least. */
    MIN_CPS: 120,
    /** Characters per second, at most. */
    MAX_CPS: 1500,
    /** A partly shown word is finished when its end is this close. */
    WORD_REACH: 12,
} as const;

/** Length of the common prefix: a final answer that differs rewinds only to here. */
export function commonPrefixLength(a: string, b: string): number {
    const limit = Math.min(a.length, b.length);
    let i = 0;
    while (i < limit && a.charCodeAt(i) === b.charCodeAt(i)) i++;
    return i;
}

/**
 * How much of `target` to show after `elapsedS` seconds, given `shown`
 * characters already on screen. Ends on a word boundary when one is near, and
 * never splits a surrogate pair.
 */
export function nextRevealLength(target: string, shown: number, elapsedS: number): number {
    const backlog = target.length - shown;
    if (backlog <= 0) return target.length;
    const cps = Math.min(REVEAL.MAX_CPS, Math.max(REVEAL.MIN_CPS, backlog / REVEAL.LAG_S));
    let next = Math.min(target.length, shown + Math.max(1, Math.round(cps * elapsedS)));
    if (next < target.length) {
        const rest = target.slice(next, next + REVEAL.WORD_REACH);
        const boundary = rest.search(/\s/);
        if (boundary >= 0) next += boundary;
    }
    const code = target.charCodeAt(next - 1);
    if (next < target.length && code >= 0xd800 && code <= 0xdbff) next += 1;
    return next;
}

/**
 * Close what a half-revealed Markdown answer leaves open, so the reader never
 * sees a stray `**`, a fence swallowing the rest of the page, or a dangling
 * link. Only the display is patched; the answer text itself is untouched.
 */
export function closeOpenMarkdown(partial: string): string {
    let text = partial;
    const fences = text.match(/^ {0,3}(```|~~~)/gm) ?? [];
    if (fences.length % 2 === 1) return `${text}\n${fences[fences.length - 1]!.trim()}`;
    text = withoutPartialTable(text);
    // A link or image whose target hasn't arrived reads as its text for now.
    text = text.replace(/!?\[([^\]\n]*)\]\([^)\n]*$/, "$1").replace(/!?\[([^\]\n]*)$/, "$1");
    const lastBlock = text.slice(text.lastIndexOf("\n\n") + 1);
    const withoutCode = lastBlock.replace(/`[^`\n]*`/g, "");
    if ((withoutCode.match(/`/g) ?? []).length % 2 === 1) text += "`";
    if ((withoutCode.match(/\*\*/g) ?? []).length % 2 === 1) text += "**";
    return text;
}

const TABLE_ROW = /^\s*\|/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}/;

/**
 * A table shows row by row: a row still arriving is held back, and so is a
 * header until its divider line has arrived (before that it's just pipes).
 */
function withoutPartialTable(text: string): string {
    const lines = text.split("\n");
    const last = lines[lines.length - 1] ?? "";
    if (TABLE_ROW.test(last) && !last.trimEnd().endsWith("|")) lines.pop();
    let start = lines.length;
    while (start > 0 && TABLE_ROW.test(lines[start - 1]!)) start--;
    const rows = lines.length - start;
    if (rows > 0 && (rows < 2 || !TABLE_DIVIDER.test(lines[start + 1]!))) lines.splice(start);
    return lines.join("\n");
}

function prefersReducedMotion(): boolean {
    return (
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
}

/**
 * The part of `target` to render now. While `live` (the answer is streaming)
 * text is revealed at a steady pace; once the stream ends the reveal finishes
 * what it started rather than jumping. Text that was never live (a stored
 * chat) shows whole, and so does everything under reduced motion.
 */
export function useSmoothText(target: string, live: boolean): { text: string; revealing: boolean } {
    const animated = useRef(live);
    if (live) animated.current = true;
    const [reduced] = useState(prefersReducedMotion);
    const shown = useRef(live ? 0 : target.length);
    const previous = useRef(target);
    if (previous.current !== target) {
        // A final answer that differs from the streamed one rewinds only to what both share.
        const kept = commonPrefixLength(previous.current.slice(0, shown.current), target);
        shown.current = Math.min(shown.current, kept);
        previous.current = target;
    }
    const latest = useRef(target);
    latest.current = target;
    const [, repaint] = useState(0);
    const behind = animated.current && !reduced && shown.current < target.length;

    useEffect(() => {
        if (!behind) return;
        let frame = 0;
        let last = performance.now();
        let painted = last;
        const tick = (now: number) => {
            const current = latest.current;
            shown.current = nextRevealLength(
                current,
                shown.current,
                Math.min(0.1, (now - last) / 1000)
            );
            last = now;
            // ~30 renders a second reads as smooth and keeps Markdown cheap.
            if (shown.current >= current.length || now - painted >= 33) {
                painted = now;
                repaint(n => n + 1);
            }
            if (shown.current < current.length) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [behind, target]);

    if (!animated.current || reduced) return { text: target, revealing: false };
    return { text: target.slice(0, shown.current), revealing: shown.current < target.length };
}
