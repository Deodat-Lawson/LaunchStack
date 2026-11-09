"use client";

import { CheckCircle2, ChevronDown, CircleHelp, Info, XCircle } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Progress } from "~/components/ui/progress";
import { cn } from "~/lib/utils";

import type { ProgramView } from "../api";
import { FIT_DIMENSIONS, MIN_FIT_COVERAGE, summarizeFit, type IllustrativeFit } from "../_lib/demo";
import { ScoreRing } from "./ProgramFacts";

const ELIGIBILITY = {
    eligible: { icon: CheckCircle2, tone: "text-success-ink" },
    unknown: { icon: CircleHelp, tone: "text-ink-2" },
    ineligible: { icon: XCircle, tone: "text-danger" },
} as const;

/**
 * One fit card: the score and eligibility at a glance, each dimension on
 * demand, then the saved AI match notes. Coverage, the eligibility reasoning
 * and the not-a-probability caveat sit behind the info button. Without an
 * illustrative fit the saved AI match is the score.
 */
export function FitPanel({
    view,
    illustrative,
}: {
    view: ProgramView;
    illustrative?: IllustrativeFit;
}) {
    const t = useTranslations("accelerators.fit");
    const td = useTranslations("accelerators.dimensions");
    const headingId = useId();
    const saved = view.fit;
    const summary = illustrative ? summarizeFit(illustrative) : null;
    const score = summary ? summary.overall : (saved?.assessment.score ?? null);
    const label = summary
        ? summary.overall === null
            ? td("insufficient")
            : td("overall", { score: summary.overall })
        : !saved
          ? t("unmatched")
          : score === null
            ? t("unknown")
            : t("score", { score });
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
                                    {illustrative?.eligibilityNote && (
                                        <p>{illustrative.eligibilityNote}</p>
                                    )}
                                    {summary && (
                                        <p>
                                            {summary.overall === null
                                                ? td("insufficientHint", {
                                                      coverage: summary.coverage,
                                                      minimum: MIN_FIT_COVERAGE,
                                                  })
                                                : td("coverage", { coverage: summary.coverage })}
                                        </p>
                                    )}
                                    <p className="text-ink-3">{t("disclaimer")}</p>
                                </PopoverContent>
                            </Popover>
                        </div>
                        {score === null && <p className="text-ink-3 text-xs">{label}</p>}
                        {illustrative && <Eligibility fit={illustrative} />}
                    </div>
                </div>
                {illustrative && <DimensionList fit={illustrative} />}
                {illustrative ? (
                    <Collapsible className="border-line border-t pt-1">
                        <CollapsibleTrigger className="text-ink hover:bg-panel-2 group -mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-xs">
                            {t("aiNotes")}
                            <span className="flex items-center gap-2">
                                {(!saved || view.fitStale) && (
                                    <span
                                        className={cn(
                                            "text-xs",
                                            saved ? "text-warn" : "text-ink-3"
                                        )}
                                    >
                                        {saved ? t("stale") : t("unmatched")}
                                    </span>
                                )}
                                <ChevronDown className="text-ink-3 size-3.5 transition-transform group-data-[state=open]:rotate-180" />
                            </span>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pb-1 pt-2">
                            <SavedAssessment view={view} />
                        </CollapsibleContent>
                    </Collapsible>
                ) : (
                    <SavedAssessment view={view} />
                )}
            </CardContent>
        </Card>
    );
}

function Eligibility({ fit }: { fit: IllustrativeFit }) {
    const td = useTranslations("accelerators.dimensions");
    const { icon: Icon, tone } = ELIGIBILITY[fit.eligibility];
    return (
        <p className={cn("flex items-center gap-1.5 text-xs font-medium", tone)}>
            <Icon className="size-3.5 shrink-0" />
            {td(`eligibility.${fit.eligibility}`)}
        </p>
    );
}

function DimensionList({ fit }: { fit: IllustrativeFit }) {
    const td = useTranslations("accelerators.dimensions");
    return (
        <ul className="divide-line divide-y">
            {FIT_DIMENSIONS.map(({ key, weight }) => (
                <DimensionRow
                    key={key}
                    name={td(`names.${key}`)}
                    weight={weight}
                    dimension={fit.dimensions[key]}
                />
            ))}
        </ul>
    );
}

function DimensionRow({
    name,
    weight,
    dimension,
}: {
    name: string;
    weight: number;
    dimension: IllustrativeFit["dimensions"][keyof IllustrativeFit["dimensions"]];
}) {
    const td = useTranslations("accelerators.dimensions");
    const [open, setOpen] = useState(false);
    const rated = dimension.applicable && dimension.score !== null;
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
                            dimension.score
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
                <CollapsibleContent>
                    <p className="text-ink-3 pb-2 text-xs leading-relaxed">
                        {dimension.note}{" "}
                        <span className="text-ink-3/80">{td("weight", { weight })}</span>
                    </p>
                </CollapsibleContent>
            </Collapsible>
        </li>
    );
}

/** The saved AI match: matched time, stale warning, reasons, concerns, unknowns and evidence. */
function SavedAssessment({ view }: { view: ProgramView }) {
    const t = useTranslations("accelerators.fit");
    const format = useFormatter();
    const fit = view.fit;
    if (!fit) return <p className="text-ink-3 text-xs leading-relaxed">{t("unmatchedHint")}</p>;
    return (
        <div className="space-y-3 break-words">
            {view.fitStale && (
                <p role="status" className="text-warn text-xs leading-relaxed">
                    {t("staleHint")}
                </p>
            )}
            <time dateTime={fit.checkedAt} className="text-ink-3 block text-xs">
                {t("checked", {
                    date: format.dateTime(new Date(fit.checkedAt), {
                        dateStyle: "medium",
                        timeStyle: "short",
                    }),
                })}
            </time>
            {(["reasons", "concerns", "unknowns"] as const).map(
                key =>
                    fit.assessment[key].length > 0 && (
                        <div key={key} className="space-y-1">
                            <h3 className="text-ink text-xs font-medium">{t(key)}</h3>
                            <ul className="text-ink-2 list-disc space-y-1 pl-4 text-xs leading-relaxed">
                                {fit.assessment[key].map((text, index) => (
                                    <li key={index}>{text}</li>
                                ))}
                            </ul>
                        </div>
                    )
            )}
            {fit.assessment.companyEvidenceIds.length > 0 && (
                <p className="text-ink-3 text-xs leading-relaxed">
                    {t("evidence", {
                        ids: format.list(
                            fit.assessment.companyEvidenceIds.map(id => format.number(id))
                        ),
                    })}
                </p>
            )}
        </div>
    );
}

/** Small status line for the saved AI match in list rows. */
export function StaleBadge({ view }: { view: ProgramView }) {
    const t = useTranslations("accelerators.fit");
    return view.fitStale ? (
        <Badge variant="outline" className="border-warn/40 text-warn">
            {t("stale")}
        </Badge>
    ) : null;
}
