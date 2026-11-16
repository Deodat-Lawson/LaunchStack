"use client";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { ReviewCitationChips, reviewSources } from "./ReviewCitationChips";
import type { WeeklyReviewContextDto, WeeklyReviewDto } from "../api";
export function ReportSources({
    review,
    context,
    onInspect,
}: {
    review: WeeklyReviewDto;
    context: WeeklyReviewContextDto | null;
    onInspect: (ref: string) => void;
}) {
    const t = useTranslations("vantage.weeklyReview");
    const sources = reviewSources(review);
    const selected = new Set(
        sources.map(source => /^doc:(\d+)@/.exec(source.ref)?.[1]).filter(Boolean)
    );
    for (const proof of review.evidence.inputSnapshot?.scopedEvidence ?? [])
        selected.add(proof.documentId);
    const others = context?.documents.filter(document => !selected.has(document.id)) ?? [];
    return (
        <Collapsible className="border-line rounded-lg border p-4">
            <CollapsibleTrigger asChild>
                <Button variant="ghost" className="gap-2">
                    <ChevronDown className="size-4" aria-hidden="true" />
                    {t("founder.sourcesUsed")}
                </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-3">
                <ReviewCitationChips
                    refs={sources.map(source => source.ref)}
                    sources={sources}
                    documents={context?.documents}
                    onInspect={onInspect}
                />
                {(review.evidence.inputSnapshot?.scopedEvidence ?? []).map(proof => {
                    const title =
                        context?.documents.find(document => document.id === proof.documentId)
                            ?.title ??
                        sources.find(source => proof.units?.some(unit => unit.ref === source.ref))
                            ?.title ??
                        t("founder.unknownSource");
                    return (
                        <section
                            key={proof.documentId + proof.scopeHash}
                            className="space-y-2 text-sm"
                        >
                            <h3 className="font-medium">
                                {t("founder.sourceVersion", {
                                    title,
                                    version: proof.parentVersion,
                                })}
                            </h3>
                            <p>{t(proof.coverage.state)}</p>
                            <p>{proof.coverage.qualification}</p>
                            <p>
                                {t("coverageUnits", {
                                    included: proof.coverage.includedUnits,
                                    required: proof.coverage.requiredUnits,
                                })}
                            </p>
                            {proof.coverage.state === "relevant_spans_reviewed" ? (
                                <p>{t("configuredSpansOnly")}</p>
                            ) : null}
                            <p>
                                {t(
                                    proof.coverage.originalCompleteness === "unknown"
                                        ? "originalCompletenessUnknown"
                                        : "founder.originalComplete"
                                )}
                            </p>
                        </section>
                    );
                })}
                {others.length ? (
                    <div>
                        <h3 className="text-ink-2 mb-2 text-sm">{t("founder.otherReadable")}</h3>
                        <ul className="text-ink-2 list-inside list-disc text-sm">
                            {others.map(document => (
                                <li key={document.id}>{document.title}</li>
                            ))}
                        </ul>
                    </div>
                ) : null}
            </CollapsibleContent>
        </Collapsible>
    );
}
