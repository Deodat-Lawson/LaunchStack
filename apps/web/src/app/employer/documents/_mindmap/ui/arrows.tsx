"use client";

import React from "react";

import { toDeg } from "../model/geometry";
import type { ArrowId, Point } from "../model/types";

/**
 * Arrowheads are drawn as real geometry rather than SVG `<marker>` elements.
 *
 * Markers cannot inherit the stroke colour of the line that uses them without
 * `context-stroke`, which Safari still does not support, and a marker per
 * colour × shape combination would balloon the defs. Explicit paths also
 * survive the SVG export untouched.
 */

export interface ArrowProps {
    /** Tip position, in world coordinates. */
    at: Point;
    /** Unit vector pointing *out* of the line at this end. */
    direction: Point;
    kind: ArrowId;
    color: string;
    strokeWidth: number;
}

/** How far the line should stop short so it does not poke through the head. */
export function arrowInset(kind: ArrowId, strokeWidth: number): number {
    const s = Math.max(strokeWidth, 1);
    switch (kind) {
        case "none":
        case "arrow-open":
        case "crowfoot-one":
        case "crowfoot-many":
        case "crowfoot-one-many":
        case "crowfoot-zero-many":
        case "crowfoot-zero-one":
            return 0;
        case "circle":
        case "circle-hollow":
            return s * 2.6;
        case "diamond":
        case "diamond-hollow":
            return s * 6;
        case "bar":
            return 0;
        default:
            return s * 4.4;
    }
}

export function ArrowHead({ at, direction, kind, color, strokeWidth }: ArrowProps) {
    if (kind === "none") return null;

    const s = Math.max(strokeWidth, 1);
    const angle = toDeg(Math.atan2(direction.y, direction.x));
    // Local frame: the tip sits at the origin and the line runs off to +x.
    const transform = `translate(${at.x} ${at.y}) rotate(${angle})`;
    const stroke = color;
    const thin = Math.max(s, 1.2);

    const shape = (() => {
        switch (kind) {
            case "arrow":
                return (
                    <path
                        d={`M 0 0 L ${s * 4.6} ${s * 2.1} L ${s * 3.6} 0 L ${s * 4.6} ${-s * 2.1} Z`}
                        fill={stroke}
                        stroke="none"
                    />
                );
            case "triangle-hollow":
                return (
                    <path
                        d={`M 0 0 L ${s * 4.8} ${s * 2.3} L ${s * 4.8} ${-s * 2.3} Z`}
                        fill="var(--panel)"
                        stroke={stroke}
                        strokeWidth={thin}
                        strokeLinejoin="round"
                    />
                );
            case "arrow-open":
                return (
                    <path
                        d={`M ${s * 4.6} ${s * 2.4} L 0 0 L ${s * 4.6} ${-s * 2.4}`}
                        fill="none"
                        stroke={stroke}
                        strokeWidth={thin}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                );
            case "diamond":
            case "diamond-hollow":
                return (
                    <path
                        d={`M 0 0 L ${s * 3} ${s * 2} L ${s * 6} 0 L ${s * 3} ${-s * 2} Z`}
                        fill={kind === "diamond" ? stroke : "var(--panel)"}
                        stroke={stroke}
                        strokeWidth={thin}
                        strokeLinejoin="round"
                    />
                );
            case "circle":
            case "circle-hollow":
                return (
                    <circle
                        cx={s * 2.6}
                        cy={0}
                        r={s * 2.6}
                        fill={kind === "circle" ? stroke : "var(--panel)"}
                        stroke={stroke}
                        strokeWidth={thin}
                    />
                );
            case "bar":
                return (
                    <path
                        d={`M 0 ${s * 3} L 0 ${-s * 3}`}
                        stroke={stroke}
                        strokeWidth={thin}
                        strokeLinecap="round"
                    />
                );
            case "crowfoot-one":
                return (
                    <path
                        d={`M ${s * 5} ${s * 3.2} L ${s * 5} ${-s * 3.2}`}
                        stroke={stroke}
                        strokeWidth={thin}
                        strokeLinecap="round"
                    />
                );
            case "crowfoot-many":
                return (
                    <path
                        d={`M ${s * 6} ${s * 3.6} L 0 0 L ${s * 6} ${-s * 3.6} M 0 0 L ${s * 6} 0`}
                        fill="none"
                        stroke={stroke}
                        strokeWidth={thin}
                        strokeLinecap="round"
                    />
                );
            case "crowfoot-one-many":
                return (
                    <g fill="none" stroke={stroke} strokeWidth={thin} strokeLinecap="round">
                        <path d={`M ${s * 6} ${s * 3.6} L 0 0 L ${s * 6} ${-s * 3.6}`} />
                        <path d={`M 0 0 L ${s * 9} 0`} />
                        <path d={`M ${s * 8} ${s * 3.2} L ${s * 8} ${-s * 3.2}`} />
                    </g>
                );
            case "crowfoot-zero-one":
                return (
                    <g fill="none" stroke={stroke} strokeWidth={thin} strokeLinecap="round">
                        <circle cx={s * 3} cy={0} r={s * 2.4} fill="var(--panel)" />
                        <path d={`M ${s * 8} ${s * 3.2} L ${s * 8} ${-s * 3.2}`} />
                    </g>
                );
            case "crowfoot-zero-many":
                return (
                    <g fill="none" stroke={stroke} strokeWidth={thin} strokeLinecap="round">
                        <path d={`M ${s * 6} ${s * 3.6} L 0 0 L ${s * 6} ${-s * 3.6}`} />
                        <circle cx={s * 8.6} cy={0} r={s * 2.4} fill="var(--panel)" />
                        <path d={`M 0 0 L ${s * 6} 0`} />
                    </g>
                );
            default:
                return null;
        }
    })();

    return <g transform={transform}>{shape}</g>;
}

export interface ArrowOption {
    id: ArrowId;
    label: string;
}

export const ARROW_OPTIONS: readonly ArrowOption[] = [
    { id: "none", label: "None" },
    { id: "arrow", label: "Filled arrow" },
    { id: "arrow-open", label: "Open arrow" },
    { id: "triangle-hollow", label: "Hollow triangle" },
    { id: "diamond", label: "Filled diamond" },
    { id: "diamond-hollow", label: "Hollow diamond" },
    { id: "circle", label: "Filled circle" },
    { id: "circle-hollow", label: "Hollow circle" },
    { id: "bar", label: "Bar" },
    { id: "crowfoot-one", label: "ERD — one" },
    { id: "crowfoot-many", label: "ERD — many" },
    { id: "crowfoot-one-many", label: "ERD — one or many" },
    { id: "crowfoot-zero-one", label: "ERD — zero or one" },
    { id: "crowfoot-zero-many", label: "ERD — zero or many" },
];
