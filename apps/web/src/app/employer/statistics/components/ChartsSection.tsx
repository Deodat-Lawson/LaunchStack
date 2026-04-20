"use client";

import React from "react";
import { Card } from "~/app/employer/documents/components/ui/card";
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "~/app/employer/documents/components/ui/chart";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import { Users, MousePointerClick } from "lucide-react";
import type { DashboardData } from "../types";

interface ChartsSectionProps {
    data: DashboardData;
}

const employeeChartConfig: ChartConfig = {
    count: {
        label: "Employees",
        color: "hsl(262, 83%, 58%)",
    },
};

const viewsChartConfig: ChartConfig = {
    count: {
        label: "Views",
        color: "hsl(221, 83%, 53%)",
    },
};

function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ChartsSection({ data }: ChartsSectionProps) {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Employee Trend Chart */}
            <Card className="p-6 border-none shadow-sm">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-1.5 bg-purple-100 dark:bg-purple-900/30 rounded-lg text-purple-600 dark:text-purple-400">
                        <Users className="w-4 h-4" />
                    </div>
                    <h2 className="text-sm font-bold text-foreground uppercase tracking-widest">
                        Employee Growth
                    </h2>
                </div>
                <ChartContainer config={employeeChartConfig} className="h-[250px] w-full">
                    <AreaChart
                        data={data.employeeTrend}
                        margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                    >
                        <defs>
                            <linearGradient id="employeeGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="hsl(262, 83%, 58%)" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="hsl(262, 83%, 58%)" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis
                            dataKey="date"
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={formatDate}
                            tick={{ fontSize: 10 }}
                        />
                        <YAxis
                            tickLine={false}
                            axisLine={false}
                            tick={{ fontSize: 10 }}
                            width={30}
                            allowDecimals={false}
                        />
                        <ChartTooltip
                            content={
                                <ChartTooltipContent
                                    labelFormatter={(value) => formatDate(value as string)}
                                />
                            }
                        />
                        <Area
                            type="monotone"
                            dataKey="count"
                            stroke="hsl(262, 83%, 58%)"
                            strokeWidth={2}
                            fill="url(#employeeGradient)"
                        />
                    </AreaChart>
                </ChartContainer>
            </Card>

            {/* Document Views Trend Chart */}
            <Card className="p-6 border-none shadow-sm">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-1.5 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
                        <MousePointerClick className="w-4 h-4" />
                    </div>
                    <h2 className="text-sm font-bold text-foreground uppercase tracking-widest">
                        Document Views
                    </h2>
                </div>
                <ChartContainer config={viewsChartConfig} className="h-[250px] w-full">
                    <AreaChart
                        data={data.documentViewsTrend}
                        margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                    >
                        <defs>
                            <linearGradient id="viewsGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="hsl(221, 83%, 53%)" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="hsl(221, 83%, 53%)" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis
                            dataKey="date"
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={formatDate}
                            tick={{ fontSize: 10 }}
                        />
                        <YAxis
                            tickLine={false}
                            axisLine={false}
                            tick={{ fontSize: 10 }}
                            width={30}
                        />
                        <ChartTooltip
                            content={
                                <ChartTooltipContent
                                    labelFormatter={(value) => formatDate(value as string)}
                                />
                            }
                        />
                        <Area
                            type="monotone"
                            dataKey="count"
                            stroke="hsl(221, 83%, 53%)"
                            strokeWidth={2}
                            fill="url(#viewsGradient)"
                        />
                    </AreaChart>
                </ChartContainer>
            </Card>
        </div>
    );
}
