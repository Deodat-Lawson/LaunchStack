"use client";

/**
 * Usage and costs.
 *
 * Body only. The ledger already existed; this is its surface: a hero
 * balance, burn per day stacked by service, the same numbers as a table,
 * model attribution where the ledger has it, and the two settings the
 * numbers exist to inform. Cost is an estimate from a price the workspace
 * sets — the ledger counts unified tokens and knows nothing about invoices.
 *
 * Series colours are design tokens; dark mode uses darker steps of the same
 * hues, validated against the dark surface rather than flipped.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, Section } from "~/components/layout/page-shell";
import {
    ChartContainer,
    ChartLegend,
    ChartLegendContent,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "~/components/ui/chart";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import { cn } from "~/lib/utils";

import { usePublishedActions, type SettingsSectionProps } from "./contract";
import { relativeTime } from "./people/format";
import { SectionRows } from "./SettingRow";
import { StatusNote } from "./ui";

interface UsageDay {
    date: string;
    services: Record<string, number>;
    total: number;
}

interface UsageOverview {
    days: number;
    balanceTokens: number;
    lifetime: { purchased: number; granted: number; used: number };
    daily: UsageDay[];
    byService: { service: string; tokens: number; operations: number }[];
    byModel: { model: string; tokens: number; calls: number }[];
    recent: {
        id: number;
        type: string;
        amount: number;
        balanceAfter: number;
        service: string | null;
        description: string | null;
        model: string | null;
        createdAt: string;
    }[];
    pricePerMillionTokens: number;
    lowBalanceThreshold: number;
    estimatedCost: number | null;
}

const RANGES = [7, 30, 90] as const;

/** Fixed order; anything past the fourth folds into Other. Never cycled. */
const SERIES = ["llm_chat", "embedding", "ocr", "transcription"] as const;
const OTHER = "other";

const SERVICE_LABEL: Record<string, string> = {
    llm_chat: "Chat",
    embedding: "Embeddings",
    ocr: "OCR",
    transcription: "Transcription",
    rerank: "Reranking",
    ner: "Entity extraction",
    distribution_research: "Distribution research",
    other: "Other",
};

const CHART_CONFIG: ChartConfig = {
    llm_chat: {
        label: "Chat",
        theme: { light: "var(--accent)", dark: "oklch(from var(--accent-2) 0.62 c h)" },
    },
    embedding: {
        label: "Embeddings",
        theme: { light: "var(--hue-teal)", dark: "oklch(from var(--hue-teal) 0.62 c h)" },
    },
    ocr: {
        label: "OCR",
        theme: { light: "var(--warn)", dark: "oklch(from var(--warn) 0.66 c h)" },
    },
    transcription: {
        label: "Transcription",
        theme: { light: "var(--info)", dark: "oklch(from var(--info) 0.6 c h)" },
    },
    other: { label: "Other", color: "var(--ink-4)" },
};

function compact(n: number): string {
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toLocaleString();
}

function money(value: number): string {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function UsageSection({ onActions }: SettingsSectionProps) {
    const [days, setDays] = useState<(typeof RANGES)[number]>(30);
    const [overview, setOverview] = useState<UsageOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/settings/usage?days=${days}`);
            const body = (await res.json().catch(() => ({}))) as UsageOverview & { error?: string };
            if (!res.ok) throw new Error(body.error ?? `Could not load usage (${res.status}).`);
            setOverview(body);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not load usage.");
        } finally {
            setLoading(false);
        }
    }, [days]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    usePublishedActions(
        onActions,
        {
            primaryLabel: "Refresh",
            primaryBusyLabel: "Refreshing…",
            onPrimary: refresh,
            busy: loading,
        },
        [refresh, loading]
    );

    // One row per day in the window, zero-filled so the axis is a calendar
    // rather than a list of days that happened to have usage.
    const chartData = useMemo(() => {
        if (!overview) return [];
        const byDate = new Map(overview.daily.map(day => [day.date, day]));
        const rows: Array<Record<string, number | string>> = [];
        for (let i = overview.days - 1; i >= 0; i--) {
            const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
            const day = byDate.get(date);
            const row: Record<string, number | string> = { date };
            let other = 0;
            for (const [service, tokens] of Object.entries(day?.services ?? {})) {
                if ((SERIES as readonly string[]).includes(service)) row[service] = tokens;
                else other += tokens;
            }
            for (const series of SERIES) row[series] ??= 0;
            row[OTHER] = other;
            rows.push(row);
        }
        return rows;
    }, [overview]);

    const windowTotal = overview?.byService.reduce((sum, s) => sum + s.tokens, 0) ?? 0;
    const low = overview ? overview.balanceTokens < overview.lowBalanceThreshold : false;

    return (
        <>
            {error && <StatusNote tone="danger">{error}</StatusNote>}
            {overview && low && (
                <StatusNote tone="warn">
                    The balance is below the low-balance warning of{" "}
                    {overview.lowBalanceThreshold.toLocaleString()} tokens.
                </StatusNote>
            )}

            <Section title="Balance">
                <div className="grid gap-3.5 md:grid-cols-3">
                    <Card padding={16}>
                        <div className="text-ink-3 text-[12px]">Tokens remaining</div>
                        <div
                            className={cn(
                                "mt-1 text-[36px] font-semibold leading-none tracking-tight",
                                low ? "text-danger" : "text-ink"
                            )}
                        >
                            {overview ? compact(overview.balanceTokens) : "…"}
                        </div>
                        {overview && (
                            <div className="text-ink-3 mt-2 text-[12px]">
                                {overview.balanceTokens.toLocaleString()} exactly
                            </div>
                        )}
                    </Card>
                    <Card padding={16}>
                        <div className="text-ink-3 text-[12px]">Used in the last {days} days</div>
                        <div className="text-ink mt-1 text-[28px] font-semibold leading-none tracking-tight">
                            {overview ? compact(windowTotal) : "…"}
                        </div>
                        {overview?.estimatedCost !== null &&
                        overview?.estimatedCost !== undefined ? (
                            <div className="text-ink-3 mt-2 text-[12px]">
                                ≈ {money(overview.estimatedCost)} at{" "}
                                {overview.pricePerMillionTokens} per 1M
                            </div>
                        ) : (
                            <div className="text-ink-3 mt-2 text-[12px]">
                                Set a price below to estimate spend.
                            </div>
                        )}
                    </Card>
                    <Card padding={16}>
                        <div className="text-ink-3 text-[12px]">Lifetime</div>
                        <dl className="text-ink-2 mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12.5px]">
                            <dt className="text-ink-3">Used</dt>
                            <dd className="m-0 tabular-nums">
                                {overview ? compact(overview.lifetime.used) : "…"}
                            </dd>
                            <dt className="text-ink-3">Granted</dt>
                            <dd className="m-0 tabular-nums">
                                {overview ? compact(overview.lifetime.granted) : "…"}
                            </dd>
                            <dt className="text-ink-3">Purchased</dt>
                            <dd className="m-0 tabular-nums">
                                {overview ? compact(overview.lifetime.purchased) : "…"}
                            </dd>
                        </dl>
                    </Card>
                </div>
            </Section>

            <Section
                title="Burn by day"
                description="Tokens drawn from the balance, by what drew them. Hover a day for the breakdown; the table below carries the same numbers."
            >
                <div className="mb-3 flex items-center gap-1.5">
                    {RANGES.map(range => (
                        <Button
                            key={range}
                            size="sm"
                            variant={range === days ? "default" : "outline"}
                            onClick={() => setDays(range)}
                        >
                            Last {range} days
                        </Button>
                    ))}
                </div>
                <Card>
                    {chartData.length === 0 ? (
                        <StatusNote tone="muted" style={{ marginBottom: 0 }}>
                            Loading…
                        </StatusNote>
                    ) : windowTotal === 0 ? (
                        <div className="text-ink-3 py-8 text-center text-[13px]">
                            Nothing drew on the balance in this window.
                        </div>
                    ) : (
                        <ChartContainer
                            config={CHART_CONFIG}
                            className={cn("h-[240px] w-full", loading && "opacity-60")}
                        >
                            <BarChart
                                data={chartData}
                                barCategoryGap={4}
                                margin={{ left: 4, right: 4 }}
                            >
                                <CartesianGrid vertical={false} strokeDasharray="0" />
                                <XAxis
                                    dataKey="date"
                                    tickLine={false}
                                    axisLine={false}
                                    minTickGap={24}
                                    tickFormatter={(value: string) =>
                                        new Date(value).toLocaleDateString(undefined, {
                                            month: "short",
                                            day: "numeric",
                                        })
                                    }
                                />
                                <YAxis
                                    tickLine={false}
                                    axisLine={false}
                                    width={44}
                                    tickFormatter={(value: number) => compact(value)}
                                />
                                <ChartTooltip
                                    cursor={{ fill: "var(--panel-2)" }}
                                    content={
                                        <ChartTooltipContent
                                            labelFormatter={(value: unknown) =>
                                                new Date(String(value)).toLocaleDateString(
                                                    undefined,
                                                    {
                                                        dateStyle: "medium",
                                                    }
                                                )
                                            }
                                        />
                                    }
                                />
                                <ChartLegend content={<ChartLegendContent />} />
                                {[...SERIES, OTHER].map((series, index, all) => (
                                    <Bar
                                        key={series}
                                        dataKey={series}
                                        stackId="tokens"
                                        fill={`var(--color-${series})`}
                                        maxBarSize={24}
                                        stroke="var(--panel)"
                                        strokeWidth={1}
                                        radius={index === all.length - 1 ? [4, 4, 0, 0] : 0}
                                    />
                                ))}
                            </BarChart>
                        </ChartContainer>
                    )}
                </Card>
            </Section>

            <Section title="By service" description="Same window, totalled.">
                <Card padding={0}>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Service</TableHead>
                                <TableHead className="text-right">Operations</TableHead>
                                <TableHead className="text-right">Tokens</TableHead>
                                <TableHead className="text-right">Share</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {(overview?.byService ?? []).map(row => (
                                <TableRow key={row.service}>
                                    <TableCell className="text-ink">
                                        {SERVICE_LABEL[row.service] ?? row.service}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                        {row.operations.toLocaleString()}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                        {row.tokens.toLocaleString()}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                        {windowTotal > 0
                                            ? `${Math.round((row.tokens / windowTotal) * 100)}%`
                                            : "—"}
                                    </TableCell>
                                </TableRow>
                            ))}
                            {overview && overview.byService.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-ink-3 text-center">
                                        Nothing in this window.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </Card>
            </Section>

            {overview && overview.byModel.length > 0 && (
                <Section
                    title="By model"
                    description="Only chat debits record a model, so this covers Ask and meetings, not embeddings or OCR."
                >
                    <Card padding={0}>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Model</TableHead>
                                    <TableHead className="text-right">Calls</TableHead>
                                    <TableHead className="text-right">Tokens</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {overview.byModel.map(row => (
                                    <TableRow key={row.model}>
                                        <TableCell className="mono text-ink text-[12px]">
                                            {row.model}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {row.calls.toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {row.tokens.toLocaleString()}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </Card>
                </Section>
            )}

            <Section
                title="Pricing and warnings"
                description="The numbers above exist to inform these two."
            >
                <Card>
                    <SectionRows section="usage" />
                </Card>
            </Section>

            {overview && overview.recent.length > 0 && (
                <Section
                    title="Recent ledger entries"
                    description="The last forty movements on the balance."
                >
                    <Card padding={0}>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>When</TableHead>
                                    <TableHead>What</TableHead>
                                    <TableHead className="text-right">Amount</TableHead>
                                    <TableHead className="text-right">Balance after</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {overview.recent.map(row => (
                                    <TableRow key={row.id}>
                                        <TableCell className="text-ink-3 whitespace-nowrap">
                                            {relativeTime(row.createdAt)}
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-ink">
                                                {row.description ??
                                                    SERVICE_LABEL[row.service ?? ""] ??
                                                    row.type}
                                            </span>
                                            {row.model && (
                                                <span className="mono text-ink-3 ml-2 text-[11px]">
                                                    {row.model}
                                                </span>
                                            )}
                                            {row.type !== "debit" && (
                                                <Badge variant="secondary" className="ml-2">
                                                    {row.type}
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell
                                            className={cn(
                                                "text-right tabular-nums",
                                                row.amount < 0 ? "text-ink" : "text-success"
                                            )}
                                        >
                                            {row.amount > 0 ? "+" : ""}
                                            {row.amount.toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-ink-3 text-right tabular-nums">
                                            {row.balanceAfter.toLocaleString()}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </Card>
                </Section>
            )}
        </>
    );
}
