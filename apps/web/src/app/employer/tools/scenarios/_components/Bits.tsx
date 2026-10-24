"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";

import type { ScenarioSummary, Stance } from "~/lib/scenarios/types";
import { cn } from "~/lib/utils";

import {
    STANCE_BG,
    isLive,
    progressLabel,
    stanceLabel,
    type ScenarioWordsT,
} from "~/lib/scenarios/words";

/** A run's state as a dot and a word: "Round 3 of 8", "Done", "Failed". */
export function StatusPill({
    run,
    className,
}: {
    run: Pick<ScenarioSummary, "status" | "stage" | "round" | "rounds" | "agents">;
    className?: string;
}) {
    const t = useTranslations("scenarios.words");
    const live = isLive(run.status);
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap text-xs",
                live ? "text-brand-ink" : run.status === "failed" ? "text-danger" : "text-ink-2",
                className
            )}
            data-status={run.status}
        >
            <span
                aria-hidden
                className={cn(
                    "size-[7px] shrink-0 rounded-full",
                    run.status === "done" && "bg-success",
                    live && "bg-brand animate-pulse motion-reduce:animate-none",
                    run.status === "failed" && "bg-danger",
                    run.status === "cancelled" && "bg-ink-4"
                )}
            />
            {progressLabel(t, run)}
        </span>
    );
}

export function StanceDot({ stance, className }: { stance: Stance; className?: string }) {
    return (
        <span
            aria-hidden
            className={cn(
                "inline-block size-2 shrink-0 rounded-full",
                STANCE_BG[stance],
                className
            )}
        />
    );
}

/**
 * Where someone stood after each round, as a small line: up is supportive,
 * down is critical, with the start and the end marked in their colours.
 */
export function StanceTrail({
    history,
    width = 72,
    height = 18,
}: {
    history: Stance[];
    width?: number;
    height?: number;
}) {
    const t = useTranslations("scenarios.words");
    if (history.length === 0) return null;
    const pad = 3;
    const x = (i: number) =>
        history.length === 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (history.length - 1);
    const y = (s: Stance) => pad + ((2 - s) * (height - 2 * pad)) / 4;
    const points = history.map((s, i) => `${x(i)},${y(s)}`).join(" ");
    const first = history[0]!;
    const last = history[history.length - 1]!;
    return (
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={t("stanceByRound", {
                stances: history
                    .map(s => stanceLabel(t, s).toLowerCase())
                    .join(t("list.separator")),
            })}
            className="shrink-0 overflow-visible"
        >
            <line
                x1={pad}
                x2={width - pad}
                y1={y(0)}
                y2={y(0)}
                stroke="var(--line)"
                strokeDasharray="2 2"
            />
            <polyline
                points={points}
                fill="none"
                stroke="var(--ink-3)"
                strokeWidth={1.5}
                strokeLinejoin="round"
            />
            <circle cx={x(0)} cy={y(first)} r={2.5} className={stanceFill(first)} />
            <circle
                cx={x(history.length - 1)}
                cy={y(last)}
                r={3}
                className={stanceFill(last)}
                stroke="var(--panel)"
                strokeWidth={1}
            />
        </svg>
    );
}

function stanceFill(s: Stance): string {
    return {
        [-2]: "fill-danger",
        [-1]: "fill-danger/60",
        [0]: "fill-ink-4",
        [1]: "fill-info/60",
        [2]: "fill-info",
    }[s];
}

/**
 * A change of mind in a few words, with the arrow in the direction's colour:
 * "Turned critical", "Softened to critical" (less critical than before),
 * "Warmed to supportive", "Cooled to neutral".
 */
export function Shift({ from, to, className }: { from: Stance; to: Stance; className?: string }) {
    const t = useTranslations("scenarios.words");
    const warmer = to > from;
    const key = warmer
        ? to > 0
            ? "shift.warmed"
            : "shift.softened"
        : to < 0
          ? "shift.turned"
          : "shift.cooled";
    const Icon = warmer ? TrendingUp : TrendingDown;
    return (
        <span
            className={cn(
                "text-ink inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium",
                className
            )}
        >
            <Icon
                className={cn("size-3.5 shrink-0", warmer ? "text-info" : "text-danger")}
                aria-hidden
            />
            {t(key, { stance: stanceLabel(t, to).toLowerCase() })}
        </span>
    );
}

/** "Neutral → Critical", or one word when it did not move. */
export function stanceMove(t: ScenarioWordsT, from: Stance, to: Stance): string {
    return from === to
        ? stanceLabel(t, to)
        : t("stanceMove", { from: stanceLabel(t, from), to: stanceLabel(t, to) });
}
