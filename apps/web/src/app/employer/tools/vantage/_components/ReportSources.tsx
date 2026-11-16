"use client";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { citationMetadata, ReviewCitationChips, reviewSources } from "./ReviewCitationChips";
import styles from "./review-layout.module.css";
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
        <Collapsible className="bg-panel border-line rounded-xl border p-4">
            <CollapsibleTrigger asChild>
                <Button
                    variant="ghost"
                    className="gap-2 text-[length:var(--fs-small)] font-semibold"
                >
                    <ChevronDown className="size-4" aria-hidden="true" />
                    {t("founder.sourcesUsed")}
                </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className={styles.accordionContent}>
                <div className="space-y-4 pt-3 text-[length:var(--fs-small)]">
                    <ol className="space-y-2">
                        {sources.map(source => {
                            const metadata = citationMetadata(
                                source.ref,
                                sources,
                                context?.documents
                            );
                            return (
                                <li key={source.ref} className="flex items-start gap-3">
                                    <ReviewCitationChips
                                        refs={[source.ref]}
                                        sources={sources}
                                        documents={context?.documents}
                                        onInspect={onInspect}
                                    />
                                    <span className="text-ink-2 min-w-0 break-words py-1">
                                        {metadata.hasMetadata
                                            ? t("founder.sourceVersion", {
                                                  title: metadata.title,
                                                  version: metadata.version!,
                                              })
                                            : source.ref}
                                    </span>
                                </li>
                            );
                        })}
                    </ol>
                    {(review.evidence.inputSnapshot?.scopedEvidence ?? []).map(proof => {
                        const title =
                            context?.documents.find(document => document.id === proof.documentId)
                                ?.title ??
                            sources.find(source =>
                                proof.units?.some(unit => unit.ref === source.ref)
                            )?.title ??
                            t("founder.unknownSource");
                        return (
                            <section key={proof.documentId + proof.scopeHash} className="space-y-2">
                                <h3 className="font-semibold">
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
                            <h3 className="text-ink-2 mb-2">{t("founder.otherReadable")}</h3>
                            <ul className="text-ink-2 list-inside list-disc space-y-1">
                                {others.map(document => (
                                    <li key={document.id}>{document.title}</li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}
