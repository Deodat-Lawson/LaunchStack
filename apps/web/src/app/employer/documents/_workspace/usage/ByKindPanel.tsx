"use client";

/**
 * Chat, embeddings and web search side by side, in the one unit the tab adds
 * up (chat-token equivalents), each with its share, a bar, and its own units
 * underneath ("12.9M tokens embedded", "288 searches · 98 pages read"), then
 * the conversion that turned one into the other. A document's embeddings show
 * as the sliver they cost, not as the millions of tokens they were.
 */

import React from "react";
import { useTranslations } from "next-intl";

import { Progress } from "~/components/ui/progress";
import { AI_USAGE_GROUPS, type AiUsageGroup } from "~/lib/ai-usage";
import type { UsageCounts, UsageRates } from "~/lib/usage/types";
import { cn } from "~/lib/utils";

import { Panel } from "../team/ui";
import { useUsageFormat } from "./format";

export function ByKindPanel({
    totals,
    rates,
    loading = false,
}: {
    totals: UsageCounts;
    rates: UsageRates;
    loading?: boolean;
}) {
    const t = useTranslations("settings.usage.kinds");
    const format = useUsageFormat();
    const total = totals.aiTokens;

    function detail(group: AiUsageGroup): string {
        if (group === "chat") {
            return totals.chatCalls === 0
                ? t("none")
                : t("chatDetail", {
                      input: format.compact(totals.inputTokens),
                      output: format.compact(totals.outputTokens),
                      calls: totals.chatCalls,
                  });
        }
        if (group === "embedding") {
            return totals.embeddedTokens === 0
                ? t("none")
                : t("embeddingDetail", { tokens: format.compact(totals.embeddedTokens) });
        }
        if (totals.searches === 0 && totals.pages === 0) return t("none");
        return totals.pages > 0
            ? t("searchPagesDetail", { searches: totals.searches, pages: totals.pages })
            : t("searchDetail", { searches: totals.searches });
    }

    return (
        <Panel title={t("title")} testId="usage-by-kind">
            <div className={cn("flex flex-col gap-3.5 px-4 pb-4 pt-1", loading && "opacity-60")}>
                <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
                    {AI_USAGE_GROUPS.map(group => {
                        const tokens = totals.aiSplit[group];
                        const share = total > 0 ? (tokens / total) * 100 : 0;
                        return (
                            <li key={group} data-testid={`usage-kind-${group}`}>
                                <div className="flex items-baseline justify-between gap-3">
                                    <span className="text-ink text-[13px] font-medium">
                                        {t(group)}
                                    </span>
                                    <span className="text-ink text-[13px] font-semibold tabular-nums">
                                        {format.compact(tokens)}
                                        <span className="text-ink-3 ml-2 font-normal">
                                            {total > 0 ? format.percent(share) : "—"}
                                        </span>
                                    </span>
                                </div>
                                <Progress
                                    value={share}
                                    aria-label={t(group)}
                                    className="bg-brand/15 mt-1.5 h-1.5"
                                />
                                <div className="text-ink-3 mt-1 text-[12px]">{detail(group)}</div>
                            </li>
                        );
                    })}
                </ul>
                <p className="text-ink-3 m-0 text-[12px] leading-normal">
                    {t("rates", {
                        embedding: format.compact(rates.embeddingPerMillion),
                        search: format.num(rates.perSearch),
                        price: format.usd(rates.chat.perMillion),
                    })}
                </p>
            </div>
        </Panel>
    );
}
