"use client";

import React, { useMemo } from "react";

import type { Rect, Viewport } from "../model/types";

/**
 * Rulers along the top and left edges.
 *
 * Drawn in screen space over the canvas, not inside its transform, so the tick
 * labels stay upright and legibly sized at every zoom level. The step is chosen
 * from a 1–2–5 ladder so ticks land on round numbers whatever the zoom is —
 * a fixed step either disappears when zoomed out or turns solid when zoomed in.
 */

export const RULER_SIZE = 20;

/** Nice round world-units-per-major-tick for the current zoom. */
function chooseStep(zoom: number): number {
    const targetScreenPx = 80;
    const raw = targetScreenPx / zoom;
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    for (const multiple of [1, 2, 5, 10]) {
        const step = magnitude * multiple;
        if (step >= raw) return step;
    }
    return magnitude * 10;
}

interface RulersProps {
    viewport: Viewport;
    size: { w: number; h: number };
    /** Highlighted band showing the current selection's extent. */
    selection: Rect | null;
}

export function Rulers({ viewport, size, selection }: RulersProps) {
    const step = useMemo(() => chooseStep(viewport.zoom), [viewport.zoom]);

    const horizontal = useMemo(() => {
        const ticks: { screen: number; value: number }[] = [];
        if (size.w <= 0) return ticks;
        const worldStart = viewport.x;
        const worldEnd = viewport.x + size.w / viewport.zoom;
        const first = Math.floor(worldStart / step) * step;
        for (let value = first; value <= worldEnd; value += step) {
            ticks.push({ screen: (value - viewport.x) * viewport.zoom, value });
        }
        return ticks;
    }, [size.w, step, viewport.x, viewport.zoom]);

    const vertical = useMemo(() => {
        const ticks: { screen: number; value: number }[] = [];
        if (size.h <= 0) return ticks;
        const worldStart = viewport.y;
        const worldEnd = viewport.y + size.h / viewport.zoom;
        const first = Math.floor(worldStart / step) * step;
        for (let value = first; value <= worldEnd; value += step) {
            ticks.push({ screen: (value - viewport.y) * viewport.zoom, value });
        }
        return ticks;
    }, [size.h, step, viewport.y, viewport.zoom]);

    const band = selection
        ? {
              x: (selection.x - viewport.x) * viewport.zoom,
              y: (selection.y - viewport.y) * viewport.zoom,
              w: selection.w * viewport.zoom,
              h: selection.h * viewport.zoom,
          }
        : null;

    return (
        <div className="pointer-events-none absolute inset-0 z-10" aria-hidden data-export="omit">
            {/* Top */}
            <svg
                width={size.w}
                height={RULER_SIZE}
                className="border-line bg-panel absolute left-0 top-0 border-b"
            >
                {band && band.w > 0 && (
                    <rect
                        x={band.x}
                        y={0}
                        width={band.w}
                        height={RULER_SIZE}
                        fill="var(--accent)"
                        fillOpacity={0.14}
                    />
                )}
                {horizontal.map(tick => (
                    <g key={tick.value}>
                        <line
                            x1={tick.screen}
                            y1={RULER_SIZE - 5}
                            x2={tick.screen}
                            y2={RULER_SIZE}
                            stroke="var(--ink-4)"
                        />
                        <text
                            x={tick.screen + 3}
                            y={11}
                            fontSize={9}
                            fill="var(--ink-3)"
                            className="font-mono"
                        >
                            {Math.round(tick.value)}
                        </text>
                    </g>
                ))}
            </svg>

            {/* Left */}
            <svg
                width={RULER_SIZE}
                height={size.h}
                className="border-line bg-panel absolute left-0 top-0 border-r"
                style={{ marginTop: RULER_SIZE }}
            >
                {band && band.h > 0 && (
                    <rect
                        x={0}
                        y={band.y - RULER_SIZE}
                        width={RULER_SIZE}
                        height={band.h}
                        fill="var(--accent)"
                        fillOpacity={0.14}
                    />
                )}
                {vertical.map(tick => (
                    <g key={tick.value}>
                        <line
                            x1={RULER_SIZE - 5}
                            y1={tick.screen - RULER_SIZE}
                            x2={RULER_SIZE}
                            y2={tick.screen - RULER_SIZE}
                            stroke="var(--ink-4)"
                        />
                        <text
                            // Rotated so the numbers read bottom-to-top, the way
                            // every design tool draws a vertical ruler.
                            transform={`translate(11 ${tick.screen - RULER_SIZE + 3}) rotate(-90)`}
                            fontSize={9}
                            fill="var(--ink-3)"
                            className="font-mono"
                            textAnchor="end"
                        >
                            {Math.round(tick.value)}
                        </text>
                    </g>
                ))}
            </svg>

            {/* Corner */}
            <div
                className="border-line bg-panel absolute left-0 top-0 border-b border-r"
                style={{ width: RULER_SIZE, height: RULER_SIZE }}
            />
        </div>
    );
}
