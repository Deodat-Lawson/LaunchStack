"use client";

import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type PointerEvent as ReactPointerEvent,
} from "react";

import { cn } from "~/lib/utils";

/**
 * The sidebar's width, which its right edge drags.
 *
 * Pixels rather than a share of the window, unlike the panes beside it: the
 * sidebar holds a list of names, and a list reads the same at any window
 * width, so widening the window should widen the panes and not the list.
 */
export const RAIL_WIDTH = { min: 220, initial: 280, max: 520 } as const;

const STORAGE_KEY = "workspace.railWidth.v1";

/** A keyboard nudge: 16px, or 64px with Shift. */
const KEY_STEP = 16;
const KEY_STEP_LARGE = 64;

export function clampRailWidth(px: number): number {
    return Math.round(Math.min(RAIL_WIDTH.max, Math.max(RAIL_WIDTH.min, px)));
}

/**
 * The width, remembered on this device. `preview` moves it while a drag is
 * under way; `commit` settles it and saves it.
 */
export function useRailWidth() {
    const [width, setWidth] = useState<number>(RAIL_WIDTH.initial);

    useEffect(() => {
        try {
            const saved = Number(localStorage.getItem(STORAGE_KEY));
            if (Number.isFinite(saved) && saved > 0) setWidth(clampRailWidth(saved));
        } catch {
            // Private mode / blocked storage — the default width it is.
        }
    }, []);

    const preview = useCallback((px: number) => setWidth(clampRailWidth(px)), []);
    const commit = useCallback((px: number) => {
        const next = clampRailWidth(px);
        setWidth(next);
        try {
            localStorage.setItem(STORAGE_KEY, String(next));
        } catch {
            // Quota / private mode — the width holds for this visit only.
        }
    }, []);

    return { width, preview, commit };
}

export interface RailResizeHandleProps {
    width: number;
    onPreview: (px: number) => void;
    onCommit: (px: number) => void;
}

/**
 * The sidebar's right edge, as something to drag. It sits in the flex row
 * right after the sidebar with no width of its own, and reaches a few pixels
 * either side of the border so it is not a one-pixel target.
 *
 * A window splitter in ARIA's terms: focusable, arrow keys move it, Home and
 * End go to the limits, Enter (or a double-click) puts it back.
 */
export function RailResizeHandle({ width, onPreview, onCommit }: RailResizeHandleProps) {
    const drag = useRef<{ startX: number; startWidth: number; latest: number } | null>(null);
    const [dragging, setDragging] = useState(false);

    const start = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = { startX: event.clientX, startWidth: width, latest: width };
        setDragging(true);
    };

    const move = (event: ReactPointerEvent<HTMLDivElement>) => {
        const current = drag.current;
        if (!current) return;
        current.latest = clampRailWidth(current.startWidth + event.clientX - current.startX);
        onPreview(current.latest);
    };

    const end = () => {
        const current = drag.current;
        if (!current) return;
        drag.current = null;
        setDragging(false);
        onCommit(current.latest);
    };

    const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
        const next =
            event.key === "ArrowLeft"
                ? width - step
                : event.key === "ArrowRight"
                  ? width + step
                  : event.key === "Home"
                    ? RAIL_WIDTH.min
                    : event.key === "End"
                      ? RAIL_WIDTH.max
                      : event.key === "Enter"
                        ? RAIL_WIDTH.initial
                        : null;
        if (next === null) return;
        event.preventDefault();
        onCommit(next);
    };

    return (
        <div className="relative z-20 w-0 shrink-0">
            <div
                role="separator"
                tabIndex={0}
                aria-orientation="vertical"
                aria-label="Resize the sidebar"
                aria-valuemin={RAIL_WIDTH.min}
                aria-valuemax={RAIL_WIDTH.max}
                aria-valuenow={width}
                title="Drag to resize · double-click to reset"
                data-rail-resize
                className="group absolute inset-y-0 -left-1 flex w-2 cursor-col-resize touch-none justify-center outline-none"
                onPointerDown={start}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
                onLostPointerCapture={end}
                onKeyDown={onKeyDown}
                onDoubleClick={() => onCommit(RAIL_WIDTH.initial)}
            >
                <span
                    aria-hidden
                    className={cn(
                        "group-hover:bg-brand-hi group-focus-visible:bg-brand h-full w-0.5 transition-colors",
                        dragging ? "bg-brand" : "bg-transparent"
                    )}
                />
            </div>
            {/* Nothing under the pointer — a document's frame above all —
                may take it from the drag. */}
            {dragging && <div aria-hidden className="fixed inset-0 z-50 cursor-col-resize" />}
        </div>
    );
}
