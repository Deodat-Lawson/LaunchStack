"use client";

import { useEffect, useState, type RefObject } from "react";

export interface Size {
    w: number;
    h: number;
}

/**
 * Track an element's box. The canvas needs real pixel dimensions to build its
 * viewBox and to fit content, and those change with panel toggles, window
 * resizes and the presentation mode — a one-shot measurement is never enough.
 */
export function useElementSize(ref: RefObject<Element | null>): Size {
    const [size, setSize] = useState<Size>({ w: 0, h: 0 });

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        const measure = () => {
            const rect = el.getBoundingClientRect();
            setSize(prev =>
                Math.abs(prev.w - rect.width) < 0.5 && Math.abs(prev.h - rect.height) < 0.5
                    ? prev
                    : { w: rect.width, h: rect.height }
            );
        };

        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [ref]);

    return size;
}
