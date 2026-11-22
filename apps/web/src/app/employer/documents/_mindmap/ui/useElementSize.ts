"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";

export interface Size {
    w: number;
    h: number;
}

/**
 * Track an element's box. The canvas needs real pixel dimensions to build its
 * viewBox and to fit content, and those change with panel toggles, window
 * resizes and the presentation mode — a one-shot measurement is never enough.
 *
 * The size must never lag the layout, because the viewBox is built from it:
 * while the two disagree the whole board is drawn scaled and shifted. Two
 * paths keep them together:
 *
 * - every render is followed by a measurement in a layout effect, so a
 *   change made by the same commit (a selection opening the inspector, which
 *   narrows the canvas) is picked up before paint *and* before the next
 *   input event — the second click of a quick double-click on a connector
 *   used to land while the viewBox was still the old one, on whatever had
 *   moved under it;
 * - anything else that resizes the element (a window resize, a panel
 *   animating) reaches the ResizeObserver, whose update is committed
 *   synchronously inside its callback, after layout and before paint.
 */
export function useElementSize(ref: RefObject<Element | null>): Size {
    const [size, setSize] = useState<Size>({ w: 0, h: 0 });
    // Compared here rather than in a state updater: even an updater that
    // returns the same object costs the component a render, and the canvas
    // measures after every one of its renders.
    const current = useRef(size);

    const measure = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const prev = current.current;
        if (Math.abs(prev.w - rect.width) < 0.5 && Math.abs(prev.h - rect.height) < 0.5) return;
        current.current = { w: rect.width, h: rect.height };
        setSize(current.current);
    }, [ref]);

    useLayoutEffect(measure);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const observer = new ResizeObserver(() => flushSync(measure));
        observer.observe(el);
        return () => observer.disconnect();
    }, [ref, measure]);

    return size;
}
