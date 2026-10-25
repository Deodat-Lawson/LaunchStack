"use client";

import React, { useMemo } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Card } from "~/components/ui/card";
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "~/components/ui/chart";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import type { DashboardData, TrendDataPoint } from "../types";

interface ChartsSectionProps {
    data: DashboardData;
}

/** Axis text in muted ink, never the series colour. */
const TICK = { fontSize: 11, fill: "var(--ink-3)" };

interface TrendChartProps {
    title: string;
    points: TrendDataPoint[];
    config: ChartConfig;
    integerTicks?: boolean;
}

function TrendChart({ title, points, config, integerTicks = false }: TrendChartProps) {
    const format = useFormatter();
    const formatDate = (dateString: string): string =>
        format.dateTime(new Date(dateString), { month: "short", day: "numeric" });

    return (
        <Card className="border-line @max-sm:p-4 min-w-0 gap-4 rounded-[14px] p-5 shadow-none">
            <h3 className="text-ink m-0 text-sm font-semibold">{title}</h3>
            <ChartContainer config={config} className="@max-sm:h-[200px] h-[240px] w-full">
                <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--line)" />
                    <XAxis
                        dataKey="date"
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={formatDate}
                        tick={TICK}
                        minTickGap={16}
                    />
                    <YAxis
                        tickLine={false}
                        axisLine={false}
                        tick={TICK}
                        tickFormatter={(value: number) => format.number(value)}
                        width={30}
                        allowDecimals={!integerTicks}
                    />
                    <ChartTooltip
                        cursor={{ stroke: "var(--line)" }}
                        content={
                            <ChartTooltipContent
                                labelFormatter={value => formatDate(value as string)}
                            />
                        }
                    />
                    <Area
                        type="monotone"
                        dataKey="count"
                        stroke="var(--color-count)"
                        strokeWidth={2}
                        fill="var(--color-count)"
                        fillOpacity={0.12}
                    />
                </AreaChart>
            </ChartContainer>
        </Card>
    );
}

export function ChartsSection({ data }: ChartsSectionProps) {
    const t = useTranslations("statistics.charts");

    // Views wear the info hue wherever they are charted (the document sheet too).
    const employeeChartConfig: ChartConfig = useMemo(
        () => ({ count: { label: t("employeesSeries"), color: "var(--accent)" } }),
        [t]
    );
    const viewsChartConfig: ChartConfig = useMemo(
        () => ({ count: { label: t("viewsSeries"), color: "var(--info)" } }),
        [t]
    );

    return (
        <div className="@max-lg:grid-cols-1 grid grid-cols-2 gap-3">
            <TrendChart
                title={t("employeeGrowth")}
                points={data.employeeTrend}
                config={employeeChartConfig}
                integerTicks
            />
            <TrendChart
                title={t("documentViews")}
                points={data.documentViewsTrend}
                config={viewsChartConfig}
            />
        </div>
    );
}
