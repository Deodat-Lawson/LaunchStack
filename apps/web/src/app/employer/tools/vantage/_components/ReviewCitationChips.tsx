"use client";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import type { WeeklyReviewDto, WeeklyReviewContextDto } from "../api";

export type ReviewSource = { ref: string; title?: string; version?: string; purpose?: string };
export function reviewSources(review: WeeklyReviewDto): ReviewSource[] {
    const sources = new Map<string, ReviewSource>();
    for (const source of review.evidence.inputSnapshot?.sources ?? [])
        if (!sources.has(source.ref)) sources.set(source.ref, source);
    const refs = [
        ...review.report.keyFigures.flatMap(figure => figure.refs),
        ...review.report.topics.flatMap(topic => [
            ...topic.facts.flatMap(fact => fact.refs),
            ...topic.conflicts.flatMap(fact => fact.refs),
            ...(topic.recommendation?.refs ?? []),
        ]),
    ];
    for (const ref of refs) if (!sources.has(ref)) sources.set(ref, { ref });
    return [...sources.values()];
}

/** The ordered report inventory owns numbering; missing metadata never triggers retrieval. */
export function citationMetadata(
    ref: string,
    sources: ReviewSource[],
    documents: WeeklyReviewContextDto["documents"] = []
) {
    const index = sources.findIndex(source => source.ref === ref);
    const source = sources[index];
    const match = /^doc:(\d+)@(.*)$/.exec(ref);
    const document = match ? documents.find(item => item.id === match[1]) : undefined;
    const title = source?.title ?? document?.title;
    const version = source?.version ?? match?.[2];
    return {
        number: index >= 0 ? index + 1 : sources.length + 1,
        title: title ?? ref,
        version,
        hasMetadata: Boolean(title && version),
    };
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
    const inventory = [...sources];
    for (const ref of refs)
        if (!inventory.some(source => source.ref === ref)) inventory.push({ ref });
    return (
        <span className="flex flex-wrap gap-1.5">
            {[...new Set(refs)].map(ref => {
                const source = citationMetadata(ref, inventory, documents);
                const caption = source.hasMetadata
                    ? t("founder.sourceVersion", { title: source.title, version: source.version! })
                    : ref;
                const label = source.hasMetadata
                    ? t("founder.citationLabel", {
                          number: source.number,
                          title: source.title,
                          version: source.version!,
                      })
                    : t("founder.citationRefLabel", { number: source.number, reference: ref });
                return (
                    <Tooltip key={ref}>
                        <TooltipTrigger asChild>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                aria-label={label}
                                className="bg-panel h-7 min-w-7 rounded-md px-1.5 text-[length:var(--fs-small)] font-semibold tabular-nums"
                                onClick={() => onInspect(ref)}
                            >
                                {source.number}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-68 text-[length:var(--fs-small)] font-normal motion-reduce:animate-none">
                            {caption}
                        </TooltipContent>
                    </Tooltip>
                );
            })}
        </span>
    );
}
