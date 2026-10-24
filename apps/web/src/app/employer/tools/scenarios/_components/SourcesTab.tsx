"use client";

import { ExternalLink, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, useEffect, useState } from "react";

import { SourceLink } from "~/components/tools/Cite";
import { SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import type { ScenarioDetail, ScenarioSources } from "~/lib/scenarios/types";
import { cn } from "~/lib/utils";

import { isLive, joinLabels, sourceKindLabel, type ScenarioWordsT } from "~/lib/scenarios/words";

type SourcesT = ReturnType<typeof useTranslations<"scenarios.sources">>;

/** "2 files, a search of your files and the company profile". */
function usedWords(t: SourcesT, tw: ScenarioWordsT, used: ScenarioSources): string {
    const parts = [
        used.documentIds.length > 0 && t("used.files", { count: used.documentIds.length }),
        used.searchFiles && t("used.search"),
        used.prospects && t("used.prospects"),
        used.brandComments && t("used.comments"),
        used.companyProfile && t("used.profile"),
        used.notes.trim() && t("used.notes"),
    ].filter((x): x is string => Boolean(x));
    return parts.length ? joinLabels(tw, parts) : t("used.nothing");
}

/**
 * The evidence the people were built from, numbered as they cite it (E1…),
 * with the brief everyone knew. A file this viewer cannot open stays in the
 * list, but says so instead of what it is.
 */
export function SourcesTab({
    run,
    focusSource,
}: {
    run: ScenarioDetail;
    focusSource: string | null;
}) {
    const t = useTranslations("scenarios.sources");
    const tw = useTranslations("scenarios.words");
    const [highlight, setHighlight] = useState<string | null>(focusSource);
    useEffect(() => {
        if (!focusSource) return;
        setHighlight(focusSource);
        document
            .getElementById(`scenario-source-${focusSource}`)
            ?.scrollIntoView({ block: "center" });
        const timer = window.setTimeout(() => setHighlight(null), 2600);
        return () => window.clearTimeout(timer);
    }, [focusSource]);

    const citedBy = (id: string) => run.people.filter(p => p.sources.includes(id)).length;
    const jump = (id: string) => {
        setHighlight(id);
        document.getElementById(`scenario-source-${id}`)?.scrollIntoView({ block: "center" });
    };

    if (run.sources.length === 0) {
        return isLive(run.status) && run.stage === "gathering" ? (
            <div className="flex flex-col gap-3">
                <p className="text-ink-3 text-[13px]">{t("gathering")}</p>
                <SkeletonRows rows={3} height={56} />
            </div>
        ) : (
            <p className="text-ink-3 text-[13px]">
                {t("none", { used: usedWords(t, tw, run.sourcesUsed) })}
            </p>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            {run.brief && (
                <section className="max-w-[80ch]">
                    <SectionHeading title={t("brief")} />
                    <p className="text-ink-2 text-[13.5px] leading-relaxed">
                        {run.brief.split(/(\[E\d+\])/g).map((part, i) => {
                            const m = /^\[(E\d+)\]$/.exec(part);
                            if (!m) return <Fragment key={i}>{part}</Fragment>;
                            return (
                                <button
                                    key={i}
                                    type="button"
                                    onClick={() => jump(m[1]!)}
                                    className="text-brand-ink focus-visible:ring-brand/50 rounded-sm align-super font-mono text-[10px] leading-none outline-none focus-visible:ring-2"
                                    aria-label={t("sourceAria", { id: m[1]! })}
                                >
                                    {m[1]}
                                </button>
                            );
                        })}
                    </p>
                </section>
            )}
            <section>
                <SectionHeading
                    title={t("title")}
                    aside={t("builtFrom", { used: usedWords(t, tw, run.sourcesUsed) })}
                />
                <ol className="border-line bg-panel overflow-hidden rounded-lg border">
                    {run.sources.map(source => {
                        const n = citedBy(source.id);
                        return (
                            <li
                                key={source.id}
                                id={`scenario-source-${source.id}`}
                                className={cn(
                                    "border-line-2 grid grid-cols-[36px_minmax(0,1fr)] gap-2 border-t px-4 py-3 transition-colors first:border-t-0",
                                    highlight === source.id && "bg-brand-soft"
                                )}
                            >
                                <span className="text-ink-3 pt-0.5 font-mono text-[11px] tabular-nums">
                                    {source.id}
                                </span>
                                <div className="min-w-0">
                                    <div className="text-ink-3 text-xs">
                                        {n > 0
                                            ? t("kindCited", {
                                                  kind: sourceKindLabel(tw, source.kind),
                                                  count: n,
                                              })
                                            : sourceKindLabel(tw, source.kind)}
                                    </div>
                                    {source.redacted ? (
                                        <div className="text-ink-2 mt-0.5 inline-flex items-center gap-1.5 text-[13px]">
                                            <Lock className="size-3.5" aria-hidden />
                                            {t("redacted")}
                                        </div>
                                    ) : (
                                        <>
                                            <div className="mt-0.5 text-[13px]">
                                                {source.href ? (
                                                    <SourceLink
                                                        href={source.href}
                                                        className="text-ink hover:text-brand-ink inline-flex items-center gap-1 font-medium"
                                                    >
                                                        {source.label}
                                                        <ExternalLink
                                                            className="size-3"
                                                            aria-hidden
                                                        />
                                                    </SourceLink>
                                                ) : (
                                                    <span className="text-ink font-medium">
                                                        {source.label}
                                                    </span>
                                                )}
                                            </div>
                                            {source.excerpt && (
                                                <p className="text-ink-2 mt-1 text-xs leading-relaxed">
                                                    “{source.excerpt}”
                                                </p>
                                            )}
                                        </>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ol>
            </section>
        </div>
    );
}
