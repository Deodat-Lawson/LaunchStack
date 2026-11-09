"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

import type { ProgramView, SourcedNarrative } from "../api";

/** A 0–100 score as a ring; an unknown score is an empty ring, never zero. */
export function ScoreRing({
    score,
    label,
    size = "md",
}: {
    score: number | null;
    label: string;
    size?: "sm" | "md" | "lg";
}) {
    const format = useFormatter();
    return (
        <div
            role="img"
            aria-label={label}
            className={cn(
                "relative flex shrink-0 items-center justify-center",
                size === "sm" && "size-10 text-xs",
                size === "md" && "size-12 text-sm",
                size === "lg" && "size-20 text-2xl"
            )}
        >
            <svg
                aria-hidden="true"
                viewBox="0 0 64 64"
                className="absolute inset-0 size-full -rotate-90"
                fill="none"
                strokeWidth={size === "lg" ? 5 : 4}
            >
                <circle cx="32" cy="32" r="28" className="stroke-line" />
                {score !== null && (
                    <circle
                        cx="32"
                        cy="32"
                        r="28"
                        pathLength="100"
                        strokeDasharray={`${score} 100`}
                        strokeLinecap="round"
                        className="stroke-brand"
                    />
                )}
            </svg>
            <span aria-hidden="true" className="text-ink font-semibold tabular-nums">
                {score === null ? "—" : format.number(score)}
            </span>
        </div>
    );
}

/** The saved AI match result as a ring or a badge. */
export function FitStatus({ view, ring = false }: { view: ProgramView; ring?: boolean }) {
    const t = useTranslations("accelerators.fit");
    const score = view.fit?.assessment.score ?? null;
    const label = !view.fit
        ? t("unmatched")
        : score === null
          ? t("unknown")
          : t("score", { score });
    if (ring) return <ScoreRing score={score} label={label} />;
    return (
        <div className="flex flex-wrap items-center gap-2">
            <Badge
                variant="outline"
                className={cn(score !== null && "border-brand/30 bg-brand-soft text-brand-ink")}
            >
                {label}
            </Badge>
            {view.fitStale && (
                <Badge variant="outline" className="border-warn/40 text-warn">
                    {t("stale")}
                </Badge>
            )}
        </div>
    );
}

export function Narrative({ title, narrative }: { title: string; narrative: SourcedNarrative }) {
    const t = useTranslations("accelerators.program");
    const text = narrative.text.replace(/^AI-written (?:synthesis|interpretation)\b[^:]*:\s*/i, "");
    return (
        <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-ink text-sm font-semibold">{title}</h3>
                {narrative.interpretation && (
                    <Badge role="note" variant="outline" className="text-ink-3 font-normal">
                        {t("interpretation")}
                    </Badge>
                )}
            </div>
            <p className="text-ink-2 whitespace-pre-wrap break-words text-sm leading-relaxed">
                {text}
            </p>
        </section>
    );
}

export function Notice({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
    return (
        <div
            role={danger ? "alert" : "status"}
            className={cn(
                "border-line bg-panel-2 text-ink-2 rounded-lg border p-3 text-sm leading-relaxed",
                danger && "border-danger/30 bg-danger/5 text-danger"
            )}
        >
            {children}
        </div>
    );
}
