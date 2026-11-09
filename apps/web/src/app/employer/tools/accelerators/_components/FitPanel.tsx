"use client";

import { CheckCircle2, ChevronDown, CircleHelp, Info, XCircle } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";

import {
    FIT_DIMENSIONS,
    MIN_FIT_COVERAGE,
    type FitDimensionResult,
    type ProgramFit,
} from "@launchstack/pipelines/accelerators/fit";
import type { ProgramSource } from "@launchstack/pipelines/accelerators/types";

import { Card, CardContent } from "~/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Progress } from "~/components/ui/progress";
import { cn } from "~/lib/utils";

import type { ProgramView } from "../api";
import { ScoreRing } from "./ProgramFacts";

const ELIGIBILITY = {
    eligible: { icon: CheckCircle2, tone: "text-success-ink" },
    unknown: { icon: CircleHelp, tone: "text-ink-2" },
    ineligible: { icon: XCircle, tone: "text-danger" },
} as const;

/**
 * One fit card: the overall score and eligibility at a glance, each area on
 * demand, then when it was assessed and whether it is still current. Coverage,
 * the eligibility reasoning and the not-a-probability caveat sit behind the
 * info button.
 */
export function FitPanel({ view }: { view: ProgramView }) {
    const t = useTranslations("accelerators.fit");
    const td = useTranslations("accelerators.dimensions");
    const headingId = useId();
    const { fit, freshness } = view;
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
        <Card
            role="region"
            aria-labelledby={headingId}
            className="border-line gap-0 py-0 shadow-sm"
        >
            <CardContent className="space-y-4 p-5">
                <div className="flex items-center gap-4">
                    <ScoreRing score={score} label={label} size="lg" />
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
                {fit && <DimensionList fit={fit} sources={view.program.sources} />}
                <Freshness view={view} />
            </CardContent>
        </Card>
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

function DimensionList({ fit, sources }: { fit: ProgramFit; sources: readonly ProgramSource[] }) {
    const td = useTranslations("accelerators.dimensions");
    return (
        <ul className="divide-line divide-y">
            {FIT_DIMENSIONS.map(({ key, weight }) => (
                <DimensionRow
                    key={key}
                    name={td(`names.${key}`)}
                    weight={weight}
                    dimension={fit.dimensions[key]}
                    sources={sources}
                />
            ))}
        </ul>
    );
}

function DimensionRow({
    name,
    weight,
    dimension,
    sources,
}: {
    name: string;
    weight: number;
    dimension: FitDimensionResult;
    sources: readonly ProgramSource[];
}) {
    const td = useTranslations("accelerators.dimensions");
    const format = useFormatter();
    const [open, setOpen] = useState(false);
    const rated = dimension.applicable && dimension.score !== null;
    const cited = sources.filter(source => dimension.evidence.sourceIds.includes(source.id));
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
        <div className="border-line space-y-1.5 border-t pt-3 text-xs leading-relaxed">
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
