"use client";

/**
 * Your own numbers, for everyone in the workspace: the days you were active
 * and your streak, what you asked, added and opened, the AI that took and
 * what it cost, each beside the workspace median — a middle, never a name —
 * then day by day, where your AI use went, and this month's limit.
 */

import React, { useMemo } from "react";
import { Flame } from "lucide-react";
import { useTranslations } from "next-intl";

import { PageHeader } from "~/components/tools/PageHeader";
import { csvFileName, downloadCsv, toCsv } from "~/lib/usage/csv";
import { isoDay } from "~/lib/usage/range";
import { MIN_MEMBERS_FOR_MEDIAN, type UsageMe, type UsageMedian } from "~/lib/usage/types";
import { cn } from "~/lib/utils";

import { AiAllowanceBody } from "../settings/AiAllowanceCard";
import { LoadingRows, Panel } from "../team/ui";
import { ByKindPanel } from "./ByKindPanel";
import { DailyChart } from "./DailyChart";
import { FeatureTable } from "./FeatureTable";
import { useUsageFilters, useUsageLoad, windowQuery } from "./data";
import { useUsageFormat } from "./format";
import { LoadFailed, StatTile, TileGrid, WindowBar, useWindowLabel } from "./ui";

type Compared = keyof UsageMedian;

export function YouScreen() {
    const t = useTranslations("usage.you");
    const tm = useTranslations("usage.metrics");
    const format = useUsageFormat();
    const { choice } = useUsageFilters();
    const query = useMemo(() => windowQuery(choice), [choice]);
    const load = useUsageLoad<UsageMe>("/api/usage/me", query);
    const me = load.data;
    const data = me?.summary;
    const range = useWindowLabel(data?.window);

    // With two members the median is their average, and yours would give the
    // other person's away; the route sends it from three.
    const median = me && me.members >= MIN_MEMBERS_FOR_MEDIAN ? me.median : null;
    const compared = median !== null;
    // The current streak runs to today; a window that ends earlier shows its longest run instead.
    const endsToday = data?.window.to === isoDay(new Date());

    /** "Workspace median 12 · you're above" — the comparison under a tile. */
    const versus = (key: Compared, yours: number) => {
        if (!median) return undefined;
        const middle = median[key];
        const where = yours > middle ? "above" : yours < middle ? "below" : "at";
        return (
            <span className="inline-flex items-center gap-1">
                {t("median", { value: format.compact(middle) })}
                <span
                    className={cn(
                        "rounded px-1 text-[10.5px] font-medium",
                        where === "above" ? "bg-brand/10 text-brand-ink" : "bg-panel-2 text-ink-2"
                    )}
                    data-testid={`usage-you-${key}-${where}`}
                >
                    {t(`where.${where}`)}
                </span>
            </span>
        );
    };

    const exportDaily = () => {
        if (!data) return;
        const csv = toCsv(
            [
                "date",
                "questions",
                "files_added",
                "documents_opened",
                "ai_requests",
                "ai_usage_chat_token_equivalents",
                "ai_chat_input_tokens",
                "ai_chat_output_tokens",
                "ai_embedded_tokens",
                "ai_web_searches",
                "ai_pages_read",
                "estimated_cost_usd",
            ],
            data.daily.map(day => [
                day.date,
                day.questions,
                day.filesAdded,
                day.docsOpened,
                day.aiCalls,
                day.aiTokens,
                day.inputTokens,
                day.outputTokens,
                day.embeddedTokens,
                day.searches,
                day.pages,
                day.costUsd,
            ])
        );
        downloadCsv(csvFileName("mine", data.window), csv);
    };

    return (
        <div className="mx-auto flex max-w-[1180px] flex-col gap-5" data-testid="usage-you">
            <PageHeader
                title={t("title")}
                sub={me ? (compared ? t("sub", { range, members: me.members }) : range) : " "}
                actions={<WindowBar onExport={exportDaily} exportDisabled={!data} />}
            />

            {load.failed !== null && !me ? (
                <LoadFailed status={load.failed} onRetry={load.reload} />
            ) : !me || !data ? (
                <LoadingRows flush rows={6} />
            ) : (
                <>
                    <TileGrid className={load.loading ? "opacity-60" : undefined}>
                        <StatTile
                            testId="usage-you-active"
                            label={tm("activeDays")}
                            value={t("activeDaysOf", {
                                active: format.num(data.totals.activeDays),
                                days: format.num(data.window.days),
                            })}
                            sub={versus("activeDays", data.totals.activeDays)}
                        />
                        <StatTile
                            testId="usage-you-questions"
                            label={tm("questions")}
                            value={format.compact(data.totals.questions)}
                            sub={versus("questions", data.totals.questions)}
                        />
                        <StatTile
                            testId="usage-you-files"
                            label={tm("filesAdded")}
                            value={format.compact(data.totals.filesAdded)}
                            sub={versus("filesAdded", data.totals.filesAdded)}
                        />
                        <StatTile
                            testId="usage-you-docs"
                            label={tm("docsOpened")}
                            value={format.compact(data.totals.docsOpened)}
                            sub={versus("docsOpened", data.totals.docsOpened)}
                        />
                        <StatTile
                            testId="usage-you-tokens"
                            label={tm("aiTokens")}
                            value={format.compact(data.totals.aiTokens)}
                            sub={versus("aiTokens", data.totals.aiTokens)}
                        />
                        <StatTile
                            testId="usage-you-streak"
                            label={endsToday ? t("streak") : t("longestStreak")}
                            value={t("streakDays", {
                                days: endsToday ? me.streak.current : me.streak.longest,
                            })}
                            sub={
                                endsToday
                                    ? t("longest", { days: me.streak.longest })
                                    : t("inThisWindow")
                            }
                        />
                    </TileGrid>
                    <ByKindPanel totals={data.totals} rates={data.rates} />

                    {endsToday && me.streak.current >= 3 && (
                        <p className="text-ink-2 m-0 flex items-center gap-1.5 text-[12.5px]">
                            <Flame className="text-warn size-3.5" aria-hidden />
                            {t("onAStreak", { days: me.streak.current })}
                        </p>
                    )}

                    <DailyChart
                        title={t("daily")}
                        daily={data.daily}
                        byFeature={data.byFeature}
                        measures={["aiTokens", "questions", "filesAdded", "docsOpened", "costUsd"]}
                        loading={load.loading}
                    />

                    <div className="@max-lg:grid-cols-1 grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start gap-5">
                        <FeatureTable
                            title={t("byFeature")}
                            rows={data.byFeature}
                            showPeople={false}
                        />
                        <div className="flex min-w-0 flex-col gap-5">
                            <Panel title={t("costTitle")} testId="usage-you-cost">
                                <div className="px-3.5 pb-2">
                                    <div className="text-ink text-[22px] font-semibold tabular-nums leading-tight">
                                        {format.usd(data.totals.costUsd)}
                                    </div>
                                    <p className="text-ink-3 m-0 mt-1 text-[12.5px] leading-normal">
                                        {data.totals.costUsd === null
                                            ? t("costUnpriced")
                                            : t("costBody", { calls: data.totals.aiCalls })}
                                    </p>
                                </div>
                            </Panel>
                            <Panel title={t("allowanceTitle")} testId="usage-you-allowance">
                                <div className="px-3.5 pb-2">
                                    <AiAllowanceBody />
                                </div>
                            </Panel>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
