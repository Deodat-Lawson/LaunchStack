"use client";

import React, { useMemo } from "react";

import { neutralsFor, type ThemeMode } from "../../model/palette";
import { shapeGeometry } from "../../model/shapes";
import type { ShapeId } from "../../model/types";
import { kindColours } from "./look";

/** The chip a thumbnail is drawn on, px. */
const W = 56;
const H = 36;
/**
 * Set as a style: the kit button sizes every icon inside it to 16px, and a
 * thumbnail is not an icon.
 */
const BOX = { width: W, height: H };

/**
 * Each kind's thumbnail size: the real outline, a touch squatter than the
 * box itself so a 168 × 64 step does not shrink to a sliver.
 */
const SIZE: Partial<Record<ShapeId, { w: number; h: number; r: number }>> = {
    process: { w: 38, h: 20, r: 5 },
    decision: { w: 38, h: 26, r: 0 },
    terminator: { w: 36, h: 17, r: 0 },
    data: { w: 40, h: 19, r: 0 },
    sticky: { w: 24, h: 22, r: 0 },
};

/**
 * A small picture of what a pick makes: the shape's real geometry in the
 * colour it will be, on a chip of this board's paper — so a pale step on a
 * white board, or a deep one on a dark board, shows as it will on the board
 * whatever the menu around it is painted in. "Just the arrow" is the board's
 * own arrow.
 */
export function Thumb({ shape, mode }: { shape: ShapeId | null; mode: ThemeMode }) {
    const size = shape ? (SIZE[shape] ?? SIZE.process!) : null;
    const path = useMemo(
        () => (shape && size ? shapeGeometry(shape, size.w, size.h, size.r).path : null),
        [shape, size]
    );
    const { paper, inkSoft } = neutralsFor(mode);
    const fill = shape ? kindColours(shape, mode).fill : null;

    return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={BOX} aria-hidden>
            <rect
                x={0.5}
                y={0.5}
                width={W - 1}
                height={H - 1}
                rx={7}
                fill={paper}
                stroke="var(--line)"
            />
            {path && size && fill ? (
                <g className="drop-shadow-sm">
                    <path
                        d={path}
                        transform={`translate(${(W - size.w) / 2} ${(H - size.h) / 2})`}
                        fill={fill}
                    />
                </g>
            ) : (
                <g transform="translate(8 3)">
                    <path
                        d="M 4 24 C 16 24, 20 9, 33 9"
                        fill="none"
                        stroke={inkSoft}
                        strokeWidth={2}
                        strokeLinecap="round"
                    />
                    <path d="M 40 9 L 31.5 5 L 33.5 9 L 31.5 13 Z" fill={inkSoft} />
                </g>
            )}
        </svg>
    );
}
