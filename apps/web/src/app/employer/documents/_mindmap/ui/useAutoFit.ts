"use client";

import { useCallback, useEffect, useRef } from "react";

import { fitToScreen } from "../model/commands";
import type { EditorStore } from "../model/store";
import type { Viewport } from "../model/types";

/**
 * Keep a board framed while the stage is still settling, and stop the moment
 * the person moves it.
 *
 * Both surfaces that draw a board had the same bug, written twice: frame once
 * on the first measurement over 40px, latch a ref, never look again. That is
 * wrong because neither surface is at its final size when it mounts — the
 * preview opens while its panel animates, and the editor opens with the left
 * and right panels sliding in. A stage measured mid-animation is narrow, and
 * the fit computed against it is what produced a board at 8% in the preview
 * and at 5% when a template was opened in the editor.
 *
 * Refitting on every resize alone would be worse: it would yank the board back
 * under someone who had just panned somewhere. Telling the two apart needs no
 * state in the store — remember the viewport our own framing produced, and
 * stand down as soon as the live one no longer matches it.
 *
 * Returns `frame`, which refits *and* re-arms tracking. Give it to anything
 * that means "frame this now": a Fit control, a page change, entering
 * presentation. Asking to fit is also asking to follow along again.
 */
export interface Size {
    w: number;
    h: number;
}

/** Viewports are floats; only a difference a person could have caused counts. */
function sameViewport(a: Viewport, b: Viewport): boolean {
    return (
        Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.zoom - b.zoom) < 0.001
    );
}

/** Below this the stage is mid-layout, and fitting to it produces nonsense. */
const MIN_USABLE_STAGE = 40;

export function useAutoFit(store: EditorStore, stageSize: Size): (size?: Size) => void {
    const framedViewport = useRef<Viewport | null>(null);
    // Read inside the effect without making the effect depend on every resize
    // tick's identity.
    const latestSize = useRef(stageSize);
    latestSize.current = stageSize;

    const frame = useCallback(
        (size?: Size) => {
            const target = size ?? latestSize.current;
            if (target.w < MIN_USABLE_STAGE || target.h < MIN_USABLE_STAGE) return;
            fitToScreen(store, target);
            framedViewport.current = store.getState().viewport;
        },
        [store]
    );

    useEffect(() => {
        const framed = framedViewport.current;
        // Once the board has been moved by hand, the stage is theirs.
        if (framed && !sameViewport(framed, store.getState().viewport)) return;
        frame(stageSize);
    }, [stageSize, frame, store]);

    return frame;
}
