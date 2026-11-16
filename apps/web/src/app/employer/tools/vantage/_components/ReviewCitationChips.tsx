"use client";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import type { WeeklyReviewDto, WeeklyReviewContextDto } from "../api";

export type ReviewSource = { ref: string; title: string; version: string; purpose?: string };
export function reviewSources(review: WeeklyReviewDto): ReviewSource[] {
    return review.evidence.inputSnapshot?.sources ?? [];
}
export function ReviewCitationChips({
    refs,
    sources,
    documents = [],
    onInspect,
}: {
    refs: string[];
    sources: ReviewSource[];
    documents?: WeeklyReviewContextDto["documents"];
    onInspect: (ref: string) => void;
}) {
    const t = useTranslations("vantage.weeklyReview");
    return (
        <span className="flex flex-wrap gap-1.5">
            {refs.map(ref => {
                const source = sources.find(item => item.ref === ref);
                const match = /^doc:(\d+)@(.*)$/.exec(ref);
                const document = match ? documents.find(item => item.id === match[1]) : undefined;
                const label = source
                    ? t("founder.sourceVersion", { title: source.title, version: source.version })
                    : document
                      ? t("founder.sourceVersion", { title: document.title, version: match![2]! })
                      : ref;
                return (
                    <Button
                        key={ref}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-auto max-w-full whitespace-normal px-2 py-1 text-left text-xs"
                        onClick={() => onInspect(ref)}
                    >
                        {label}
                    </Button>
                );
            })}
        </span>
    );
}
