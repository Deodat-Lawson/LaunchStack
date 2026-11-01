"use client";

/**
 * Day by day, one measure at a time. AI tokens stack by feature (the
 * window's four biggest, then Other) so a jump can be traced to what caused
 * it; every other measure is one series in one colour. One axis always: the
 * measures have different scales, so they take turns rather than share.
 */

import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
    ChartContainer,
    ChartLegend,
    ChartLegendContent,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "~/components/ui/chart";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import type { UsageDay, UsageFeatureRow } from "~/lib/usage/types";
import { cn } from "~/lib/utils";

import { Panel } from "../team/ui";
import {
    OTHER_SERIES,
    SERIES_THEMES,
    SINGLE_SERIES_THEME,
    calendarRows,
    seriesConfig,
    useUsageFormat,
} from "./format";

export const DAILY_MEASURES = [
    "aiTokens",
    "questions",
    "activePeople",
    "filesAdded",
    "docsOpened",
    "costUsd",
] as const;
export type DailyMeasure = (typeof DAILY_MEASURES)[number];

export function DailyChart({
    daily,
    byFeature,
    measures = DAILY_MEASURES,
    loading = false,
    title,
}: {
    daily: UsageDay[];
    byFeature: UsageFeatureRow[];
    /** Which measures to offer; a person's chart leaves out Active people. */
    measures?: readonly DailyMeasure[];
    loading?: boolean;
    title: string;
}) {
    const t = useTranslations("usage.chart");
    const tm = useTranslations("usage.metrics");
    const format = useUsageFormat();
    const [measure, setMeasure] = useState<DailyMeasure>(measures[0] ?? "aiTokens");

    const series = useMemo(
        () => byFeature.slice(0, SERIES_THEMES.length).map(row => row.feature),
        [byFeature]
    );
    const config = useMemo<ChartConfig>(
        () =>
            measure === "aiTokens"
                ? seriesConfig(series, format.feature, t("other"))
                : { [measure]: { label: tm(measure), theme: SINGLE_SERIES_THEME } },
        [measure, series, format, t, tm]
    );
    const rows = useMemo(() => {
        const dates = daily.map(day => day.date);
        if (measure === "aiTokens") {
            return calendarRows(dates, new Map(daily.map(day => [day.date, day.features])), series);
        }
        return daily.map(day => ({ date: day.date, [measure]: day[measure] ?? 0 }));
    }, [daily, measure, series]);
    // Other only when something falls into it: a person who used one feature has no Other.
    const hasOther = measure === "aiTokens" && rows.some(row => Number(row[OTHER_SERIES]) > 0);
    const keys =
        measure === "aiTokens" ? [...series, ...(hasOther ? [OTHER_SERIES] : [])] : [measure];
    const empty = daily.every(
        day => (measure === "aiTokens" ? day.aiTokens : (day[measure] ?? 0)) === 0
    );
    const value = (n: number) => (measure === "costUsd" ? format.usd(n) : format.compact(n));

    return (
        <Panel
            title={title}
            testId="usage-daily-chart"
            action={
                <ToggleGroup
                    type="single"
                    size="sm"
                    value={measure}
                    onValueChange={next => next && setMeasure(next as DailyMeasure)}
                    aria-label={t("measure")}
                    className="@max-md:hidden flex-wrap justify-end"
                >
                    {measures.map(id => (
                        <ToggleGroupItem
                            key={id}
                            value={id}
                            className="data-[state=on]:bg-panel-2 data-[state=on]:text-ink h-7 shrink-0 px-2 text-[12px]"
                        >
                            {tm(id)}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
            }
        >
            {/* On a phone the measures wrap under the heading instead. */}
            <div className="@max-md:flex hidden px-3.5 pb-1">
                <ToggleGroup
                    type="single"
                    size="sm"
                    value={measure}
                    onValueChange={next => next && setMeasure(next as DailyMeasure)}
                    aria-label={t("measure")}
                    className="flex-wrap justify-start"
                >
                    {measures.map(id => (
                        <ToggleGroupItem
                            key={id}
                            value={id}
                            className="data-[state=on]:bg-panel-2 data-[state=on]:text-ink h-7 shrink-0 px-2 text-[12px]"
                        >
                            {tm(id)}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
            </div>
            <div className="px-2 pt-1">
                {empty ? (
                    <div className="text-ink-3 py-14 text-center text-[13px]">{t("nothing")}</div>
                ) : (
                    <ChartContainer
                        config={config}
                        className={cn("h-[240px] w-full", loading && "opacity-60")}
                    >
                        <BarChart data={rows} barCategoryGap={3} margin={{ left: 4, right: 4 }}>
                            <CartesianGrid vertical={false} strokeDasharray="0" />
                            <XAxis
                                dataKey="date"
                                tickLine={false}
                                axisLine={false}
                                minTickGap={24}
                                tickFormatter={(date: string) => format.day(date)}
                            />
                            <YAxis
                                tickLine={false}
                                axisLine={false}
                                width={48}
                                allowDecimals={measure === "costUsd"}
                                tickFormatter={(n: number) => value(n)}
                            />
                            <ChartTooltip
                                cursor={{ fill: "var(--panel-2)" }}
                                content={
                                    <ChartTooltipContent
                                        labelFormatter={(date: unknown) =>
                                            format.longDay(String(date))
                                        }
                                        formatter={(raw, name, item) => (
                                            <div className="flex w-full items-center justify-between gap-3">
                                                <span className="flex items-center gap-1.5">
                                                    <span
                                                        className="size-2.5 shrink-0 rounded-[2px]"
                                                        style={{ background: item.color }}
                                                    />
                                                    <span className="text-ink-2">
                                                        {config[String(name)]?.label ?? name}
                                                    </span>
                                                </span>
                                                <span className="text-ink font-medium tabular-nums">
                                                    {measure === "costUsd"
                                                        ? format.usd(Number(raw))
                                                        : format.num(Number(raw))}
                                                </span>
                                            </div>
                                        )}
                                    />
                                }
                            />
                            {measure === "aiTokens" && (
                                <ChartLegend content={<ChartLegendContent />} />
                            )}
                            {keys.map((key, index) => (
                                <Bar
                                    key={key}
                                    dataKey={key}
                                    stackId="day"
                                    fill={`var(--color-${key})`}
                                    maxBarSize={24}
                                    stroke="var(--panel)"
                                    strokeWidth={1}
                                    radius={index === keys.length - 1 ? [4, 4, 0, 0] : 0}
                                />
                            ))}
                        </BarChart>
                    </ChartContainer>
                )}
            </div>
        </Panel>
    );
}
