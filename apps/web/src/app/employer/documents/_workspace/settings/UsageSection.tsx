"use client";

/**
 * Usage and costs.
 *
 * Body only. Two meters on one window. The balance: a hero figure, burn per
 * day stacked by service and the same numbers as a table — what the features
 * that debit have charged, in unified tokens. The models: every AI model call
 * the workspace made, from every feature, with the provider's own input,
 * output and cached counts and a cost from the price the operator declared
 * per model (or the workspace's own price, for models without one). Routes
 * are shown, never model ids. Then the two settings the numbers inform.
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
import { isAiFeature, isAiUsageRoute } from "~/lib/ai-usage";
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

/** `ModelUsageTotals` in ~/server/settings/usage. */
interface ModelTotals {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedInputTokens: number;
    costUsd: number;
    pricedCalls: number;
}

interface ModelUsage {
    totals: ModelTotals;
    daily: { date: string; features: Record<string, number>; total: number }[];
    byFeature: (ModelTotals & { feature: string })[];
    byRoute: (ModelTotals & { route: string })[];
    workspaceOwnedCalls: number;
    estimatedCostUsd: number | null;
}

interface UsageOverview {
    days: number;
    balanceTokens: number;
    lifetime: { purchased: number; granted: number; used: number };
    daily: UsageDay[];
    byService: { service: string; tokens: number; operations: number }[];
    recent: {
        id: number;
        type: string;
        amount: number;
        balanceAfter: number;
        service: string | null;
        description: string | null;
        /** The description as message data (`settings.server.ledger`), when the app wrote it. */
        descriptionCopy?: { key: LedgerKey; values?: Record<string, string> } | null;
        createdAt: string;
    }[];
    pricePerMillionTokens: number;
    lowBalanceThreshold: number;
    estimatedCost: number | null;
    models: ModelUsage;
}

/** `LedgerKey` in ~/server/settings/usage — the ledger descriptions the page can word. */
type LedgerKey =
    | "grant"
    | "serviceUsage"
    | "chatQuery"
    | "transcribe"
    | "ner"
    | "embed"
    | "ocr"
    | "distribution"
    | "proposalsRewrite"
    | "proposalsReview"
    | "scenarioInterview"
    | "scenarioUnit"
    | "scenarioRound";

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

/** The four series colours, in rank order; anything past them is Other. */
const SERIES_THEMES = [
    { light: "var(--accent)", dark: "oklch(from var(--accent-2) 0.62 c h)" },
    { light: "var(--hue-teal)", dark: "oklch(from var(--hue-teal) 0.62 c h)" },
    { light: "var(--warn)", dark: "oklch(from var(--warn) 0.66 c h)" },
    { light: "var(--info)", dark: "oklch(from var(--info) 0.6 c h)" },
] as const;

function chartConfig(t: UsageT): ChartConfig {
    return {
        llm_chat: { label: t("services.llmChat"), theme: SERIES_THEMES[0] },
        embedding: { label: t("services.embedding"), theme: SERIES_THEMES[1] },
        ocr: { label: t("services.ocr"), theme: SERIES_THEMES[2] },
        transcription: { label: t("services.transcription"), theme: SERIES_THEMES[3] },
        other: { label: t("services.other"), color: "var(--ink-4)" },
    };
}

function featureLabel(t: UsageT, feature: string): string {
    return isAiFeature(feature) ? t(`models.features.${feature}`) : feature;
}

function routeLabel(t: UsageT, route: string): string {
    return isAiUsageRoute(route) ? t(`models.routes.${route}`) : route;
}

/**
 * The model chart's series: the window's four biggest features by tokens, in
 * that order, coloured by rank. Everything else folds into Other.
 */
function modelSeries(models: ModelUsage): string[] {
    return models.byFeature.slice(0, SERIES_THEMES.length).map(row => row.feature);
}

function modelChartConfig(t: UsageT, series: string[]): ChartConfig {
    const config: ChartConfig = {};
    series.forEach((feature, index) => {
        config[feature] = { label: featureLabel(t, feature), theme: SERIES_THEMES[index]! };
    });
    config[OTHER] = { label: t("services.other"), color: "var(--ink-4)" };
    return config;
}

function compact(n: number, locale: string): string {
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toLocaleString(locale);
}

function money(value: number, locale: string): string {
    return value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Dollars; sub-cent amounts keep enough digits to be more than "0.00". */
function usd(value: number, locale: string): string {
    return value.toLocaleString(locale, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: value > 0 && value < 1 ? 4 : 2,
    });
}

/** One zero-filled row per day of the window, so the axis is a calendar. */
function calendarRows(
    days: number,
    byDate: Map<string, Record<string, number>>,
    series: readonly string[]
): Array<Record<string, number | string>> {
    const rows: Array<Record<string, number | string>> = [];
    for (let i = days - 1; i >= 0; i--) {
        const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
        const row: Record<string, number | string> = { date };
        let other = 0;
        for (const [key, tokens] of Object.entries(byDate.get(date) ?? {})) {
            if (series.includes(key)) row[key] = tokens;
            else other += tokens;
        }
        for (const key of series) row[key] ??= 0;
        row[OTHER] = other;
        rows.push(row);
    }
    return rows;
}

export function UsageSection({ onActions }: SettingsSectionProps) {
    const t = useTranslations("settings.usage");
    const tLedger = useTranslations("settings.server.ledger");
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
        const byDate = new Map(overview.daily.map(day => [day.date, day.services]));
        return calendarRows(overview.days, byDate, SERIES);
    }, [overview]);

    const models = overview?.models;
    const series = useMemo(() => (models ? modelSeries(models) : []), [models]);
    const MODEL_CHART_CONFIG = useMemo(() => modelChartConfig(t, series), [t, series]);
    const modelChartData = useMemo(() => {
        if (!overview) return [];
        const byDate = new Map(overview.models.daily.map(day => [day.date, day.features]));
        return calendarRows(overview.days, byDate, series);
    }, [overview, series]);

    const windowTotal = overview?.byService.reduce((sum, s) => sum + s.tokens, 0) ?? 0;
    const low = overview ? overview.balanceTokens < overview.lowBalanceThreshold : false;
    const modelTokens = models ? models.totals.inputTokens + models.totals.outputTokens : 0;

    return (
        <>
            {error && <StatusNote tone="danger">{error}</StatusNote>}
            {overview && low && (
                <StatusNote tone="warn">
                    {t("lowBalance", { threshold: num(overview.lowBalanceThreshold) })}
                </StatusNote>
            )}

            {/* One window for every figure on the page. */}
            <div className="mb-5 flex items-center gap-1.5">
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

            <Section title={t("models.title")} description={t("models.description")}>
                {models && models.workspaceOwnedCalls > 0 && (
                    <StatusNote tone="muted">
                        {t("models.ownEndpoint", { calls: num(models.workspaceOwnedCalls) })}
                    </StatusNote>
                )}
                <div className="grid gap-3.5 md:grid-cols-3">
                    <Card padding={16}>
                        <div className="text-ink-3 text-[12px]">{t("models.tokens", { days })}</div>
                        <div className="text-ink mt-1 text-[28px] font-semibold leading-none tracking-tight">
                            {models ? compact(modelTokens, locale) : "…"}
                        </div>
                        {models && (
                            <div className="text-ink-3 mt-2 text-[12px]">
                                {t("models.split", {
                                    input: compact(models.totals.inputTokens, locale),
                                    output: compact(models.totals.outputTokens, locale),
                                    calls: num(models.totals.calls),
                                })}
                            </div>
                        )}
                    </Card>
                    <Card padding={16}>
                        <div className="text-ink-3 text-[12px]">{t("models.cost")}</div>
                        <div className="text-ink mt-1 text-[28px] font-semibold leading-none tracking-tight">
                            {!models
                                ? "…"
                                : models.estimatedCostUsd === null
                                  ? "—"
                                  : usd(models.estimatedCostUsd, locale)}
                        </div>
                        {models && models.totals.calls > 0 && (
                            <div className="text-ink-3 mt-2 text-[12px]">
                                {models.estimatedCostUsd === null
                                    ? t("models.costNone")
                                    : models.totals.pricedCalls === models.totals.calls
                                      ? t("models.costPriced")
                                      : overview && overview.pricePerMillionTokens > 0
                                        ? t("models.costFallback", {
                                              price: String(overview.pricePerMillionTokens),
                                          })
                                        : t("models.costPartial", {
                                              priced: num(models.totals.pricedCalls),
                                              calls: num(models.totals.calls),
                                          })}
                            </div>
                        )}
                    </Card>
                    <Card padding={16}>
                        <div className="text-ink-3 text-[12px]">{t("models.efficiency")}</div>
                        <dl className="text-ink-2 mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12.5px]">
                            <dt className="text-ink-3">{t("models.cached")}</dt>
                            <dd className="m-0 tabular-nums">
                                {!models
                                    ? "…"
                                    : models.totals.inputTokens > 0
                                      ? `${Math.round((models.totals.cachedInputTokens / models.totals.inputTokens) * 100)}%`
                                      : "—"}
                            </dd>
                            <dt className="text-ink-3">{t("models.reasoning")}</dt>
                            <dd className="m-0 tabular-nums">
                                {models ? compact(models.totals.reasoningTokens, locale) : "…"}
                            </dd>
                        </dl>
                    </Card>
                </div>

                <Card className="mt-3.5">
                    {modelChartData.length === 0 ? (
                        <StatusNote tone="muted" style={{ marginBottom: 0 }}>
                            {tc("status.loading")}
                        </StatusNote>
                    ) : modelTokens === 0 ? (
                        <div className="text-ink-3 py-8 text-center text-[13px]">
                            {t("models.nothing")}
                        </div>
                    ) : (
                        <ChartContainer
                            config={MODEL_CHART_CONFIG}
                            className={cn("h-[240px] w-full", loading && "opacity-60")}
                        >
                            <BarChart
                                data={modelChartData}
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
                                {[...series, OTHER].map((key, index, all) => (
                                    <Bar
                                        key={key}
                                        dataKey={key}
                                        stackId="tokens"
                                        fill={`var(--color-${key})`}
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

                {models && models.byFeature.length > 0 && (
                    <Card padding={0} className="mt-3.5">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t("models.feature")}</TableHead>
                                    <TableHead className="text-right">
                                        {t("models.calls")}
                                    </TableHead>
                                    <TableHead className="text-right">
                                        {t("models.input")}
                                    </TableHead>
                                    <TableHead className="text-right">
                                        {t("models.output")}
                                    </TableHead>
                                    <TableHead className="text-right">
                                        {t("models.costColumn")}
                                    </TableHead>
                                    <TableHead className="text-right">
                                        {t("byService.share")}
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {models.byFeature.map(row => (
                                    <TableRow key={row.feature}>
                                        <TableCell className="text-ink">
                                            {featureLabel(t, row.feature)}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {num(row.calls)}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {num(row.inputTokens)}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {num(row.outputTokens)}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {row.pricedCalls > 0 ? usd(row.costUsd, locale) : "—"}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {modelTokens > 0
                                                ? `${Math.round(((row.inputTokens + row.outputTokens) / modelTokens) * 100)}%`
                                                : "—"}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </Card>
                )}

                {models && models.byRoute.length > 0 && (
                    <Card padding={0} className="mt-3.5">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t("models.route")}</TableHead>
                                    <TableHead className="text-right">
                                        {t("models.calls")}
                                    </TableHead>
                                    <TableHead className="text-right">
                                        {t("models.input")}
                                    </TableHead>
                                    <TableHead className="text-right">
                                        {t("models.output")}
                                    </TableHead>
                                    <TableHead className="text-right">
                                        {t("models.costColumn")}
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {models.byRoute.map(row => (
                                    <TableRow key={row.route}>
                                        <TableCell className="text-ink">
                                            {routeLabel(t, row.route)}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {num(row.calls)}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {num(row.inputTokens)}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {num(row.outputTokens)}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {row.pricedCalls > 0 ? usd(row.costUsd, locale) : "—"}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </Card>
                )}
            </Section>

            <Section title={t("burn.title")} description={t("burn.description")}>
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
                                                {(row.descriptionCopy
                                                    ? tLedger(
                                                          row.descriptionCopy.key,
                                                          row.descriptionCopy.values
                                                      )
                                                    : row.description) ??
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
                                                row.amount < 0 ? "text-ink" : "text-success-ink"
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
