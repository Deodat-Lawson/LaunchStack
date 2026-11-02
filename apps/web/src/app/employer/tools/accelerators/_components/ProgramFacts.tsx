"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

import type { ProgramView, SourcedNarrative } from "../api";

export function Narrative({ title, narrative }: { title: string; narrative: SourcedNarrative }) {
    const t = useTranslations("accelerators.program");
    const text = narrative.text.replace(/^AI-written (?:synthesis|interpretation)\b[^:]*:\s*/i, "");
    return (
        <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-ink text-base font-semibold">{title}</h2>
                {narrative.interpretation && (
                    <Badge role="note" variant="outline" className="text-ink-3 font-normal">
                        {t("interpretation")}
                    </Badge>
                )}
            </div>
            <p className="text-ink-2 whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
        </section>
    );
}

export function FitStatus({ view, ring = false }: { view: ProgramView; ring?: boolean }) {
    const t = useTranslations("accelerators.fit");
    const format = useFormatter();
    const score = view.fit?.assessment.score;
    const label = !view.fit ? t("unmatched") : score == null ? t("unknown") : t("score", { score });
    if (ring) {
        return (
            <div className="flex w-36 shrink-0 items-center gap-2">
                <div
                    role="img"
                    aria-label={label}
                    className="relative flex size-12 shrink-0 items-center justify-center"
                >
                    <svg
                        aria-hidden="true"
                        viewBox="0 0 64 64"
                        className="absolute inset-0 size-full -rotate-90"
                        fill="none"
                        strokeWidth="4"
                    >
                        <circle cx="32" cy="32" r="28" className="stroke-line" />
                        {score != null && (
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
                    <span
                        aria-hidden="true"
                        className="text-ink text-sm font-semibold tabular-nums"
                    >
                        {score == null ? "—" : format.number(score)}
                    </span>
                </div>
                <div className="space-y-0.5 text-xs">
                    <p className="text-ink-3">{score == null ? label : t("title")}</p>
                    {view.fitStale && <p className="text-warn">{t("stale")}</p>}
                </div>
            </div>
        );
    }
    return (
        <div className="flex flex-wrap items-center gap-2">
            <Badge
                variant="outline"
                className={cn(
                    view.fit?.assessment.score != null &&
                        "border-brand/30 bg-brand-soft text-brand-ink"
                )}
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

export function FitDetails({ view }: { view: ProgramView }) {
    const t = useTranslations("accelerators.fit");
    const format = useFormatter();
    const fit = view.fit;
    return (
        <section className="border-line bg-panel space-y-4 rounded-xl border p-5">
            <h2 className="text-ink text-base font-semibold">{t("title")}</h2>
            <FitStatus view={view} />
            {!fit && <p className="text-ink-3 text-sm">{t("unmatchedHint")}</p>}
            {view.fitStale && <p className="text-warn text-sm">{t("staleHint")}</p>}
            {fit && (
                <>
                    <p className="text-ink-3 text-xs">
                        {t("checked", {
                            date: format.dateTime(new Date(fit.checkedAt), {
                                dateStyle: "medium",
                                timeStyle: "short",
                            }),
                        })}
                    </p>
                    {(["reasons", "concerns", "unknowns"] as const).map(
                        key =>
                            fit.assessment[key].length > 0 && (
                                <div key={key} className="space-y-1.5">
                                    <h3 className="text-ink text-sm font-medium">{t(key)}</h3>
                                    <ul className="text-ink-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">
                                        {fit.assessment[key].map((text, index) => (
                                            <li key={index}>{text}</li>
                                        ))}
                                    </ul>
                                </div>
                            )
                    )}
                    {fit.assessment.companyEvidenceIds.length > 0 && (
                        <p className="text-ink-3 text-xs">
                            {t("evidence", {
                                ids: format.list(
                                    fit.assessment.companyEvidenceIds.map(id => format.number(id))
                                ),
                            })}
                        </p>
                    )}
                </>
            )}
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
