"use client";

import { ExternalLink } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

import type { ProgramSource, ProgramView, SourcedNarrative } from "../api";

export function SourceLinks({ ids, sources }: { ids: string[]; sources: ProgramSource[] }) {
    const t = useTranslations("accelerators.program");
    return (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {sources
                .filter(source => ids.includes(source.id))
                .map(source => (
                    <a
                        key={source.id}
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand inline-flex items-center gap-1 underline underline-offset-4"
                    >
                        {t("sourceLink", { title: source.title })}
                        <ExternalLink className="size-3 shrink-0" />
                    </a>
                ))}
        </div>
    );
}

export function Narrative({
    title,
    narrative,
    sources,
}: {
    title: string;
    narrative: SourcedNarrative;
    sources: ProgramSource[];
}) {
    const t = useTranslations("accelerators.program");
    return (
        <section className="space-y-3">
            <h2 className="text-ink text-base font-semibold">{title}</h2>
            <p className="text-ink-2 whitespace-pre-wrap text-sm leading-relaxed">
                {narrative.text}
            </p>
            <p className="text-ink-3 text-xs">
                {t(narrative.interpretation ? "interpretation" : "sourceSummary")}
            </p>
            <SourceLinks ids={narrative.sourceIds} sources={sources} />
        </section>
    );
}

export function FitStatus({ view }: { view: ProgramView }) {
    const t = useTranslations("accelerators.fit");
    return (
        <div className="flex flex-wrap items-center gap-2">
            <Badge
                variant="outline"
                className={cn(
                    view.fit?.assessment.score != null &&
                        "border-brand/30 bg-brand-soft text-brand-ink"
                )}
            >
                {!view.fit
                    ? t("unmatched")
                    : view.fit.assessment.score == null
                      ? t("unknown")
                      : t("score", { score: view.fit.assessment.score })}
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
                    <SourceLinks ids={fit.assessment.sourceIds} sources={view.program.sources} />
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
