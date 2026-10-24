"use client";

/**
 * Usage and costs.
 *
 * Body only. The ledger already existed; this is its surface: a hero
 * balance, burn per day stacked by service, the same numbers as a table,
 * chat usage by route where the ledger has it, and the two settings the
 * numbers exist to inform. Cost is an estimate from a price the workspace
 * sets — the ledger counts unified tokens and knows nothing about invoices.
 *
 * Series colours are design tokens; dark mode uses darker steps of the same
 * hues, validated against the dark surface rather than flipped.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
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
import { useTimeFormat } from "./people/format";
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
    byRoute: { route: string; tokens: number; calls: number }[];
    recent: {
        id: number;
        type: string;
        amount: number;
        balanceAfter: number;
        service: string | null;
        description: string | null;
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

/** Ledger service ids → their names in `settings.usage.services`. */
const SERVICE_KEYS = {
    llm_chat: "llmChat",
    embedding: "embedding",
    ocr: "ocr",
    transcription: "transcription",
    rerank: "rerank",
    ner: "ner",
    distribution_research: "distributionResearch",
    scenario_simulation: "scenarioSimulation",
    other: "other",
} as const;

/** Ledger entry types (`token_transactions.type`) → `settings.usage.types`. */
const TYPE_KEYS = ["grant", "purchase", "debit", "refund", "adjustment"] as const;

type UsageT = ReturnType<typeof useTranslations<"settings.usage">>;

function serviceLabel(t: UsageT, service: string | null): string | undefined {
    const key = service ? (SERVICE_KEYS as Record<string, string | undefined>)[service] : undefined;
    return key
        ? t(`services.${key as (typeof SERVICE_KEYS)[keyof typeof SERVICE_KEYS]}`)
        : undefined;
}

function typeLabel(t: UsageT, type: string): string {
    return (TYPE_KEYS as readonly string[]).includes(type)
        ? t(`types.${type as (typeof TYPE_KEYS)[number]}`)
        : type;
}

function chartConfig(t: UsageT): ChartConfig {
    return {
        llm_chat: {
            label: t("services.llmChat"),
            theme: { light: "var(--accent)", dark: "oklch(from var(--accent-2) 0.62 c h)" },
        },
        embedding: {
            label: t("services.embedding"),
            theme: { light: "var(--hue-teal)", dark: "oklch(from var(--hue-teal) 0.62 c h)" },
        },
        ocr: {
            label: t("services.ocr"),
            theme: { light: "var(--warn)", dark: "oklch(from var(--warn) 0.66 c h)" },
        },
        transcription: {
            label: t("services.transcription"),
            theme: { light: "var(--info)", dark: "oklch(from var(--info) 0.6 c h)" },
        },
        other: { label: t("services.other"), color: "var(--ink-4)" },
    };
}

function compact(n: number, locale: string): string {
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toLocaleString(locale);
}

function money(value: number, locale: string): string {
    return value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function UsageSection({ onActions }: SettingsSectionProps) {
    const t = useTranslations("settings.usage");
    const tc = useTranslations("common");
    const locale = useLocale();
    const time = useTimeFormat();
    const CHART_CONFIG = useMemo(() => chartConfig(t), [t]);
    const num = (n: number) => n.toLocaleString(locale);
    const [days, setDays] = useState<(typeof RANGES)[number]>(30);
    const [overview, setOverview] = useState<UsageOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/settings/usage?days=${days}`);
            const body = (await res.json().catch(() => ({}))) as UsageOverview & { error?: string };
            if (!res.ok)
                throw new Error(body.error ?? t("loadFailedStatus", { status: res.status }));
            setOverview(body);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : t("loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [days, t]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    usePublishedActions(
        onActions,
        {
            primaryLabel: tc("actions.refresh"),
            primaryBusyLabel: t("refreshing"),
            onPrimary: refresh,
            busy: loading,
        },
        [refresh, loading, t, tc]
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
                    {t("lowBalance", { threshold: num(overview.lowBalanceThreshold) })}
                </StatusNote>
            )}

            <Section title={t("balance.title")}>
                <div className="grid gap-3.5 md:grid-cols-3">
                    <Card padding={16}>
                        <div className="text-ink-3 text-[12px]">{t("balance.remaining")}</div>
                        <div
                            className={cn(
                                "mt-1 text-[36px] font-semibold leading-none tracking-tight",
                                low ? "text-danger" : "text-ink"
                            )}
                        >
                            {overview ? compact(overview.balanceTokens, locale) : "…"}
                        </div>
                        {overview && (
                            <div className="text-ink-3 mt-2 text-[12px]">
                                {t("balance.exactly", { value: num(overview.balanceTokens) })}
                            </div>
                        )}
                    </Card>
                    <Card padding={16}>
                        <div className="text-ink-3 text-[12px]">
                            {t("balance.usedInLast", { days })}
                        </div>
                        <div className="text-ink mt-1 text-[28px] font-semibold leading-none tracking-tight">
                            {overview ? compact(windowTotal, locale) : "…"}
                        </div>
                        {overview?.estimatedCost !== null &&
                        overview?.estimatedCost !== undefined ? (
                            <div className="text-ink-3 mt-2 text-[12px]">
                                {t("balance.estimate", {
                                    cost: money(overview.estimatedCost, locale),
                                    price: String(overview.pricePerMillionTokens),
                                })}
                            </div>
                        ) : (
                            <div className="text-ink-3 mt-2 text-[12px]">
                                {t("balance.setPrice")}
                            </div>
                        )}
                    </Card>
                    <Card padding={16}>
                        <div className="text-ink-3 text-[12px]">{t("balance.lifetime")}</div>
                        <dl className="text-ink-2 mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12.5px]">
                            <dt className="text-ink-3">{t("balance.used")}</dt>
                            <dd className="m-0 tabular-nums">
                                {overview ? compact(overview.lifetime.used, locale) : "…"}
                            </dd>
                            <dt className="text-ink-3">{t("balance.granted")}</dt>
                            <dd className="m-0 tabular-nums">
                                {overview ? compact(overview.lifetime.granted, locale) : "…"}
                            </dd>
                            <dt className="text-ink-3">{t("balance.purchased")}</dt>
                            <dd className="m-0 tabular-nums">
                                {overview ? compact(overview.lifetime.purchased, locale) : "…"}
                            </dd>
                        </dl>
                    </Card>
                </div>
            </Section>

            <Section title={t("burn.title")} description={t("burn.description")}>
                <div className="mb-3 flex items-center gap-1.5">
                    {RANGES.map(range => (
                        <Button
                            key={range}
                            size="sm"
                            variant={range === days ? "default" : "outline"}
                            onClick={() => setDays(range)}
                        >
                            {t("burn.lastDays", { days: range })}
                        </Button>
                    ))}
                </div>
                <Card>
                    {chartData.length === 0 ? (
                        <StatusNote tone="muted" style={{ marginBottom: 0 }}>
                            {tc("status.loading")}
                        </StatusNote>
                    ) : windowTotal === 0 ? (
                        <div className="text-ink-3 py-8 text-center text-[13px]">
                            {t("burn.nothing")}
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
                                        new Date(value).toLocaleDateString(locale, {
                                            month: "short",
                                            day: "numeric",
                                        })
                                    }
                                />
                                <YAxis
                                    tickLine={false}
                                    axisLine={false}
                                    width={44}
                                    tickFormatter={(value: number) => compact(value, locale)}
                                />
                                <ChartTooltip
                                    cursor={{ fill: "var(--panel-2)" }}
                                    content={
                                        <ChartTooltipContent
                                            labelFormatter={(value: unknown) =>
                                                new Date(String(value)).toLocaleDateString(locale, {
                                                    dateStyle: "medium",
                                                })
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

            <Section title={t("byService.title")} description={t("byService.description")}>
                <Card padding={0}>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t("byService.service")}</TableHead>
                                <TableHead className="text-right">
                                    {t("byService.operations")}
                                </TableHead>
                                <TableHead className="text-right">{t("tokens")}</TableHead>
                                <TableHead className="text-right">{t("byService.share")}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {(overview?.byService ?? []).map(row => (
                                <TableRow key={row.service}>
                                    <TableCell className="text-ink">
                                        {serviceLabel(t, row.service) ?? row.service}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                        {num(row.operations)}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                        {num(row.tokens)}
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
                                        {t("byService.empty")}
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </Card>
            </Section>

            {overview && overview.byRoute.length > 0 && (
                <Section title={t("byRoute.title")} description={t("byRoute.description")}>
                    <Card padding={0}>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t("byRoute.route")}</TableHead>
                                    <TableHead className="text-right">
                                        {t("byRoute.calls")}
                                    </TableHead>
                                    <TableHead className="text-right">{t("tokens")}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {overview.byRoute.map(row => (
                                    <TableRow key={row.route}>
                                        <TableCell className="text-ink capitalize">
                                            {row.route}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {num(row.calls)}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {num(row.tokens)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </Card>
                </Section>
            )}

            <Section title={t("pricing.title")} description={t("pricing.description")}>
                <Card>
                    <SectionRows section="usage" />
                </Card>
            </Section>

            {overview && overview.recent.length > 0 && (
                <Section title={t("recent.title")} description={t("recent.description")}>
                    <Card padding={0}>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t("recent.when")}</TableHead>
                                    <TableHead>{t("recent.what")}</TableHead>
                                    <TableHead className="text-right">
                                        {t("recent.amount")}
                                    </TableHead>
                                    <TableHead className="text-right">
                                        {t("recent.balanceAfter")}
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {overview.recent.map(row => (
                                    <TableRow key={row.id}>
                                        <TableCell className="text-ink-3 whitespace-nowrap">
                                            {time.relative(row.createdAt)}
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-ink">
                                                {row.description ??
                                                    serviceLabel(t, row.service) ??
                                                    typeLabel(t, row.type)}
                                            </span>
                                            {row.type !== "debit" && (
                                                <Badge variant="secondary" className="ml-2">
                                                    {typeLabel(t, row.type)}
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
                                            {num(row.amount)}
                                        </TableCell>
                                        <TableCell className="text-ink-3 text-right tabular-nums">
                                            {num(row.balanceAfter)}
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
