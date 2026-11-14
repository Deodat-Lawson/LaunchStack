"use client";

import { CheckCircle2, ChevronDown, CircleHelp, Info, XCircle } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";

import {
    FIT_DIMENSIONS,
    MIN_FIT_COVERAGE,
    type FitDimensionResult,
    type ProgramFit,
} from "@launchstack/pipelines/accelerators/fit";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Progress } from "~/components/ui/progress";
import { cn } from "~/lib/utils";

import type { ProgramView } from "../api";
import { useAccelerators } from "../_lib/context";
import { ScoreRing } from "./ProgramFacts";

const ELIGIBILITY = {
    eligible: { icon: CheckCircle2, tone: "text-success-ink" },
    unknown: { icon: CircleHelp, tone: "text-ink-2" },
    ineligible: { icon: XCircle, tone: "text-danger" },
} as const;

/** What a grade can cite: one of the Program's sources or an entry of its dossier evidence. */
interface Citation {
    id: string;
    title: string;
    url: string;
}

/**
 * The fit at a glance: overall score and eligibility, each area on demand, then when it
 * was assessed and whether it is still current. Coverage, the eligibility reasoning and
 * the not-a-probability caveat sit behind the info button.
 */
export function FitPanel({ view }: { view: ProgramView }) {
    const t = useTranslations("accelerators.fit");
    const td = useTranslations("accelerators.dimensions");
    const { home } = useAccelerators();
    const headingId = useId();
    const { fit, freshness } = view;
    const evidence = home?.details[view.program.id]?.evidence;
    const citations = useMemo(() => {
        const byId = new Map<string, Citation>();
        for (const item of [...view.program.sources, ...(evidence ?? [])]) {
            if (!byId.has(item.id)) byId.set(item.id, item);
        }
        return [...byId.values()];
    }, [view.program.sources, evidence]);
    const score = fit?.overall.score ?? null;
    const label =
        freshness.status === "not_assessed"
            ? t("unmatched")
            : !fit
              ? t("stale")
              : score === null
                ? td("insufficient")
                : td("overall", { score });
    return (
        <section role="region" aria-labelledby={headingId} className="space-y-4">
            <div className="space-y-4">
                <div className="flex items-center gap-4">
                    <ScoreRing score={score} label={label} size="md" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                            <h2 id={headingId} className="text-ink text-sm font-semibold">
                                {t("title")}
                            </h2>
                            <Popover>
                                <PopoverTrigger
                                    aria-label={t("about")}
                                    className="text-ink-3 hover:text-ink -m-1 rounded-md p-1"
                                >
                                    <Info className="size-4" />
                                </PopoverTrigger>
                                <PopoverContent
                                    align="end"
                                    className="text-ink-2 space-y-2 text-xs leading-relaxed"
                                >
                                    {fit && <p>{fit.eligibility.note}</p>}
                                    {fit && (
                                        <p>
                                            {fit.overall.score === null
                                                ? td("insufficientHint", {
                                                      coverage: fit.overall.coverage,
                                                      minimum: MIN_FIT_COVERAGE,
                                                  })
                                                : td("coverage", {
                                                      coverage: fit.overall.coverage,
                                                  })}
                                        </p>
                                    )}
                                    <p className="text-ink-3">{t("disclaimer")}</p>
                                </PopoverContent>
                            </Popover>
                        </div>
                        {score === null && <p className="text-ink-3 text-xs">{label}</p>}
                        {fit && <Eligibility fit={fit} />}
                    </div>
                </div>
                {fit && <DimensionList fit={fit} citations={citations} />}
                <Freshness view={view} />
            </div>
        </section>
    );
}

function Eligibility({ fit }: { fit: ProgramFit }) {
    const td = useTranslations("accelerators.dimensions");
    const { status } = fit.eligibility;
    const { icon: Icon, tone } = ELIGIBILITY[status];
    return (
        <p className={cn("flex items-center gap-1.5 text-xs font-medium", tone)}>
            <Icon className="size-3.5 shrink-0" />
            {td(`eligibility.${status}`)}
        </p>
    );
}

function DimensionList({ fit, citations }: { fit: ProgramFit; citations: readonly Citation[] }) {
    const td = useTranslations("accelerators.dimensions");
    return (
        <ul className="divide-line divide-y">
            {FIT_DIMENSIONS.map(({ key, weight }) => (
                <DimensionRow
                    key={key}
                    name={td(`names.${key}`)}
                    weight={weight}
                    dimension={fit.dimensions[key]}
                    citations={citations}
                />
            ))}
        </ul>
    );
}

function DimensionRow({
    name,
    weight,
    dimension,
    citations,
}: {
    name: string;
    weight: number;
    dimension: FitDimensionResult;
    citations: readonly Citation[];
}) {
    const td = useTranslations("accelerators.dimensions");
    const ts = useTranslations("accelerators.scoring");
    const format = useFormatter();
    const [open, setOpen] = useState(false);
    const rated = dimension.applicable && dimension.score !== null;
    const cited = citations.filter(source => dimension.evidence.sourceIds.includes(source.id));
    const portfolio = dimension.evidence.portfolioCompanies ?? [];
    return (
        <li>
            <Collapsible open={open} onOpenChange={setOpen}>
                <CollapsibleTrigger className="hover:bg-panel-2 group -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-2 text-left">
                    <span className="text-ink min-w-0 flex-1 text-xs">{name}</span>
                    <span className="w-14 shrink-0">
                        {rated && (
                            <Progress
                                value={dimension.score ?? 0}
                                aria-label={name}
                                className="h-1.5"
                            />
                        )}
                    </span>
                    <span
                        className={cn(
                            "min-w-8 shrink-0 whitespace-nowrap text-right text-xs tabular-nums",
                            rated ? "text-ink font-medium" : "text-ink-3"
                        )}
                    >
                        {rated ? (
                            format.number(dimension.score ?? 0)
                        ) : (
                            <>
                                <span aria-hidden="true">—</span>
                                <span className="sr-only">
                                    {dimension.applicable ? td("unknown") : td("notApplicable")}
                                </span>
                            </>
                        )}
                    </span>
                    <ChevronDown className="text-ink-3 size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-1 pb-2">
                    <p className="text-ink-3 text-xs leading-relaxed">
                        {dimension.note}{" "}
                        <span className="text-ink-3/80">{td("weight", { weight })}</span>
                    </p>
                    {cited.length > 0 && (
                        <p className="text-ink-3 text-xs leading-relaxed">
                            {td("sources")}{" "}
                            {cited.map((source, index) => (
                                <span key={source.id}>
                                    {index > 0 && ", "}
                                    <a
                                        href={source.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-brand-ink underline-offset-2 hover:underline"
                                    >
                                        {source.title}
                                    </a>
                                </span>
                            ))}
                        </p>
                    )}
                    {portfolio.length > 0 && (
                        <div className="text-ink-3 space-y-1 text-xs leading-relaxed">
                            <p>{ts("portfolioMatches")}</p>
                            <ul className="space-y-0.5">
                                {portfolio.map(match => (
                                    <li key={match.companyId} className="flex gap-2">
                                        <span className="text-ink-2 min-w-0 flex-1 truncate">
                                            {match.name}
                                            {match.batch && (
                                                <span className="text-ink-3"> · {match.batch}</span>
                                            )}
                                        </span>
                                        <span className="shrink-0 tabular-nums">
                                            {ts("similarity", {
                                                percent: format.number(match.similarity, {
                                                    style: "percent",
                                                    maximumFractionDigits: 0,
                                                }),
                                            })}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </CollapsibleContent>
            </Collapsible>
        </li>
    );
}

/** When the fit was assessed and, if it no longer matches the inputs, why. */
function Freshness({ view }: { view: ProgramView }) {
    const t = useTranslations("accelerators.fit");
    const format = useFormatter();
    const { freshness } = view;
    if (freshness.status === "not_assessed") {
        return <p className="text-ink-3 text-xs leading-relaxed">{t("unmatchedHint")}</p>;
    }
    return (
        <div className="space-y-1 text-xs leading-relaxed">
            {freshness.status === "out_of_date" && (
                <p role="status" className="text-warn">
                    {t("staleBecause", {
                        reasons: format.list(
                            freshness.reasons.map(reason => t(`staleReasons.${reason}`))
                        ),
                    })}
                </p>
            )}
            <time dateTime={freshness.assessedAt} className="text-ink-3 block">
                {t("checked", {
                    date: format.dateTime(new Date(freshness.assessedAt), {
                        dateStyle: "medium",
                        timeStyle: "short",
                    }),
                })}
            </time>
        </div>
    );
}
