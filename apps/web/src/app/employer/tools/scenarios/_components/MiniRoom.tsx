"use client";

import { useMemo } from "react";

import type { ScenarioOutcome } from "~/lib/scenarios/types";
import { cn } from "~/lib/utils";

import { seatLayout } from "../_lib/room";

/** The drawing's own width; the SVG scales to its box. */
const W = 300;

const SIDE_FILL = {
    critical: "fill-danger",
    neutral: "fill-ink-4/40",
    supportive: "fill-info",
} as const;

/**
 * A small Room as a drawing: one dot per seat, coloured by the side each
 * person ended on (critical left, supportive right), or empty seats while
 * there is no outcome yet. `tone="brand"` tints the empty seats, for a run
 * that is still going or a form choosing the size.
 */
export function MiniRoom({
    seats,
    outcome,
    tone = "outline",
    label,
    className,
}: {
    seats: number;
    outcome?: ScenarioOutcome | null;
    tone?: "outline" | "brand";
    label: string;
    className?: string;
}) {
    const layout = useMemo(
        () =>
            seatLayout(Math.max(1, seats), W, {
                maxSize: seats <= 12 ? 28 : 22,
                maxRadius: 150,
                inset: 3,
                top: 3,
                floor: 0.05,
                gap: 3,
            }),
        [seats]
    );
    const sides = useMemo(() => {
        if (!outcome) return [];
        return [
            ...Array<keyof ScenarioOutcome>(outcome.critical).fill("critical"),
            ...Array<keyof ScenarioOutcome>(outcome.neutral).fill("neutral"),
            ...Array<keyof ScenarioOutcome>(outcome.supportive).fill("supportive"),
        ];
    }, [outcome]);
    const r = layout.size / 2;
    return (
        <svg
            viewBox={`0 0 ${W} ${layout.height}`}
            role="img"
            aria-label={label}
            className={cn("block h-auto w-full", className)}
        >
            {layout.seats.map((seat, i) => {
                const side = sides[i];
                return side ? (
                    <circle key={i} cx={seat.x} cy={seat.y} r={r - 1} className={SIDE_FILL[side]} />
                ) : (
                    <circle
                        key={i}
                        cx={seat.x}
                        cy={seat.y}
                        r={r - 1.5}
                        strokeWidth={1.25}
                        className={
                            tone === "brand"
                                ? "fill-brand-soft stroke-brand/40"
                                : "fill-panel-2 stroke-line"
                        }
                    />
                );
            })}
        </svg>
    );
}
