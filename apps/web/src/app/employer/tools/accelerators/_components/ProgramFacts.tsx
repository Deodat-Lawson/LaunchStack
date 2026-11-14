"use client";

import Image from "next/image";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

import type { CatalogueProgram, ProgramView, SourcedNarrative } from "../api";

/** The scraper's placeholder when no logo could be verified as the Program's own. */
const NO_LOGO = "/accelerators/logos/none.png";

/** The Program's verified logo, or its initial on a tile when none was verified. */
export function ProgramLogo({
    program,
    size,
}: {
    program: CatalogueProgram;
    size: "sm" | "md" | "lg";
}) {
    const box = { sm: "size-9 rounded-md", md: "size-12 rounded-lg", lg: "size-16 rounded-xl" }[
        size
    ];
    if (program.logo.path === NO_LOGO) {
        return (
            <span
                aria-hidden="true"
                className={cn(
                    "bg-brand-soft text-brand-ink flex shrink-0 items-center justify-center font-semibold",
                    box,
                    size === "sm" ? "text-sm" : size === "md" ? "text-lg" : "text-2xl"
                )}
            >
                {program.name.trim().charAt(0).toUpperCase()}
            </span>
        );
    }
    const pixels = { sm: 36, md: 48, lg: 64 }[size];
    return (
        <Image
            src={program.logo.path}
            alt=""
            width={pixels}
            height={pixels}
            className={cn(
                "shrink-0 bg-[var(--paper-panel)] object-contain",
                box,
                size === "sm" ? "p-0.5" : "p-1"
            )}
        />
    );
}

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

/**
 * The saved fit as a ring or a badge. An out-of-date result keeps its previous
 * score beside a warning; one saved under an older rubric has no score to keep.
 */
export function FitStatus({ view, ring = false }: { view: ProgramView; ring?: boolean }) {
    const t = useTranslations("accelerators.fit");
    const score = view.fit?.overall.score ?? null;
    const stale = view.freshness.status === "out_of_date";
    const label =
        view.freshness.status === "not_assessed"
            ? t("unmatched")
            : !view.fit
              ? t("stale")
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
            {stale && view.fit && (
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
