"use client";

import { useTranslations } from "next-intl";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { cn } from "~/lib/utils";

import type { SalesStage } from "../api";
import { useGrowthFormat } from "../../_lib/format";
import { FUNNEL_STAGES, stageTone } from "../_lib/stages";

/**
 * One row whose segment widths are the counts, so it needs no legend and no
 * axis. Accent for stages in motion, ok for won, neutral for lead. Empty
 * stages keep a sliver so the sequence stays readable.
 */
export function FunnelBar({
    counts,
    hrefFor,
    className,
}: {
    counts: Array<{ stage: SalesStage; count: number }>;
    hrefFor?: (stage: SalesStage) => string;
    className?: string;
}) {
    const t = useTranslations("growth.prospects.funnel");
    const ts = useTranslations("growth.prospects.stages");
    const { joinList } = useGrowthFormat();
    const byStage = new Map(counts.map(c => [c.stage, c.count]));
    const total = FUNNEL_STAGES.reduce((sum, s) => sum + (byStage.get(s) ?? 0), 0);
    return (
        <div className={className}>
            <div
                className="border-line bg-panel flex h-8 overflow-hidden rounded-md border"
                role="img"
                aria-label={joinList(
                    FUNNEL_STAGES.map(s =>
                        t("segment", { stage: ts(s), count: byStage.get(s) ?? 0 })
                    )
                )}
            >
                {FUNNEL_STAGES.map((stage, i) => {
                    const count = byStage.get(stage) ?? 0;
                    const tone = stageTone(stage);
                    const grow = total === 0 ? 1 : Math.max(count, total * 0.035);
                    const inner = (
                        <span
                            className={cn(
                                "flex h-full items-center justify-center text-xs font-medium tabular-nums transition-colors",
                                tone === "active" && "bg-brand-soft text-brand-ink",
                                tone === "won" && "bg-success-soft text-success",
                                (tone === "quiet" || tone === "info") && "bg-panel-2 text-ink",
                                hrefFor && "hover:brightness-95"
                            )}
                        >
                            {count}
                        </span>
                    );
                    return (
                        <div
                            key={stage}
                            className={cn(
                                "min-w-0",
                                i < FUNNEL_STAGES.length - 1 && "border-line border-r"
                            )}
                            style={{ flex: `${grow} 1 0` }}
                            title={t("title", { stage: ts(stage), count })}
                        >
                            {hrefFor ? (
                                <ToolLink href={hrefFor(stage)} className="block h-full">
                                    {inner}
                                </ToolLink>
                            ) : (
                                inner
                            )}
                        </div>
                    );
                })}
            </div>
            <div className="text-ink-3 mt-1.5 flex text-[11.5px]">
                {FUNNEL_STAGES.map(stage => {
                    const count = byStage.get(stage) ?? 0;
                    const grow = total === 0 ? 1 : Math.max(count, total * 0.035);
                    return (
                        <span
                            key={stage}
                            className="min-w-0 truncate px-0.5 text-center"
                            style={{ flex: `${grow} 1 0` }}
                        >
                            {ts(stage)}
                        </span>
                    );
                })}
            </div>
        </div>
    );
}
