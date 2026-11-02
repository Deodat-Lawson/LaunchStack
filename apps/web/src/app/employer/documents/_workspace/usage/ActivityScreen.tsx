"use client";

/**
 * Every AI call the workspace made, the way Cursor's usage page lists its
 * events — here one row per day, person, feature and route, because calls
 * are counted by the day (`ai_usage_daily`), not stored one by one. Newest
 * first, narrowed by person and feature; the person and feature live in the
 * screen's query (`?person=8&feature=ask`), so Back, Forward and "Copy link"
 * keep them.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { ProfileAvatar } from "~/components/ProfileAvatar";
import { useToolNav, useToolSearchParams } from "~/components/tool-app/nav";
import { PageHeader } from "~/components/tools/PageHeader";
import { Button } from "~/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import { AI_FEATURES, isAiFeature } from "~/lib/ai-usage";
import { csvFileName, downloadCsv, toCsv } from "~/lib/usage/csv";
import type { UsageActivity, UsageActivityRow, UsagePeople } from "~/lib/usage/types";
import { cn } from "~/lib/utils";

import { EmptyLine, LoadingRows } from "../team/ui";
import { useUsageFilters, useUsageLoad, windowQuery } from "./data";
import { useUsageFormat } from "./format";
import { LoadFailed, WindowBar, useWindowLabel } from "./ui";

const PAGE = 100;
/** The route's largest page, used when exporting everything. */
const EXPORT_PAGE = 500;
const EVERYONE = "everyone";
const ALL_FEATURES = "all";

export function ActivityScreen() {
    const t = useTranslations("usage.activity");
    const format = useUsageFormat();
    const { navigate } = useToolNav();
    const params = useToolSearchParams();
    const { choice } = useUsageFilters();

    const personParam = params.get("person");
    const person = personParam && /^\d+$/.test(personParam) ? Number(personParam) : null;
    const featureParam = params.get("feature");
    const feature = featureParam && isAiFeature(featureParam) ? featureParam : null;

    const setFilter = (next: { person?: string | null; feature?: string | null }) => {
        const search = new URLSearchParams(params);
        for (const [key, value] of Object.entries(next)) {
            if (value === undefined) continue;
            if (value === null) search.delete(key);
            else search.set(key, value);
        }
        const text = search.toString();
        navigate(text ? `?${text}` : "?", { replace: true });
    };

    const query = useMemo(() => {
        const q = windowQuery(choice);
        if (person !== null) q.set("person", String(person));
        if (feature) q.set("feature", feature);
        return q;
    }, [choice, person, feature]);
    const firstPage = useMemo(() => {
        const q = new URLSearchParams(query);
        q.set("limit", String(PAGE));
        return q;
    }, [query]);
    const load = useUsageLoad<UsageActivity>("/api/usage/activity", firstPage);
    const people = useUsageLoad<UsagePeople>("/api/usage/people", windowQuery(choice));
    const range = useWindowLabel(load.data?.window);

    // Pages after the first, fetched on "Show more"; dropped when the filters change.
    const [more, setMore] = useState<UsageActivityRow[]>([]);
    const [moreBusy, setMoreBusy] = useState(false);
    const [exporting, setExporting] = useState(false);
    const key = query.toString();
    useEffect(() => setMore([]), [key]);

    const rows = useMemo(() => [...(load.data?.rows ?? []), ...more], [load.data, more]);
    const total = load.data?.total ?? 0;

    const fetchPage = useCallback(
        async (offset: number, limit: number): Promise<UsageActivity> => {
            const q = new URLSearchParams(query);
            q.set("offset", String(offset));
            q.set("limit", String(limit));
            const res = await fetch(`/api/usage/activity?${q.toString()}`, { cache: "no-store" });
            if (!res.ok) throw new Error(String(res.status));
            return (await res.json()) as UsageActivity;
        },
        [query]
    );

    const showMore = async () => {
        setMoreBusy(true);
        try {
            const page = await fetchPage(rows.length, PAGE);
            setMore(prev => [...prev, ...page.rows]);
        } catch (error) {
            console.warn("[usage] activity page failed:", error);
        } finally {
            setMoreBusy(false);
        }
    };

    const personName = (row: UsageActivityRow) =>
        row.person === null
            ? t("unattributed")
            : row.person === "former"
              ? t("former")
              : row.person.displayName;

    const exportAll = async () => {
        if (!load.data) return;
        setExporting(true);
        try {
            const all: UsageActivityRow[] = [];
            for (let offset = 0; offset < total || offset === 0; offset += EXPORT_PAGE) {
                const page = await fetchPage(offset, EXPORT_PAGE);
                all.push(...page.rows);
                if (page.rows.length < EXPORT_PAGE) break;
            }
            const csv = toCsv(
                [
                    "date",
                    "person",
                    "feature",
                    "route",
                    "kind",
                    "own_endpoint",
                    "requests_or_pages",
                    "ai_usage_chat_token_equivalents",
                    "input_tokens",
                    "output_tokens",
                    "cached_input_tokens",
                    "reasoning_tokens",
                    "estimated_cost_usd",
                ],
                all.map(row => [
                    row.date,
                    personName(row),
                    format.feature(row.feature),
                    row.kind === "chat" ? format.route(row.route || "default") : "",
                    row.kind,
                    row.owner === "workspace" ? "yes" : "no",
                    row.calls,
                    row.aiTokens,
                    row.inputTokens,
                    row.outputTokens,
                    row.cachedInputTokens,
                    row.reasoningTokens,
                    row.costUsd,
                ])
            );
            downloadCsv(csvFileName("activity", load.data.window), csv);
        } catch (error) {
            console.warn("[usage] activity export failed:", error);
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="mx-auto flex max-w-[1180px] flex-col gap-5" data-testid="usage-activity">
            <PageHeader
                title={t("title")}
                sub={load.data ? t("sub", { range }) : " "}
                actions={
                    <>
                        <Select
                            value={person === null ? EVERYONE : String(person)}
                            onValueChange={v => setFilter({ person: v === EVERYONE ? null : v })}
                        >
                            <SelectTrigger
                                className="@max-md:w-full h-8 w-44 text-[12.5px]"
                                aria-label={t("whose")}
                                data-testid="usage-activity-person"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={EVERYONE}>{t("everyone")}</SelectItem>
                                {(people.data?.people ?? []).map(p => (
                                    <SelectItem key={p.memberId} value={String(p.memberId)}>
                                        {p.displayName}
                                    </SelectItem>
                                ))}
                                {/* A link may name someone the list hasn't loaded yet. */}
                                {person !== null &&
                                    !people.data?.people.some(p => p.memberId === person) && (
                                        <SelectItem value={String(person)}>
                                            {t("someone")}
                                        </SelectItem>
                                    )}
                            </SelectContent>
                        </Select>
                        <Select
                            value={feature ?? ALL_FEATURES}
                            onValueChange={v =>
                                setFilter({ feature: v === ALL_FEATURES ? null : v })
                            }
                        >
                            <SelectTrigger
                                className="@max-md:w-full h-8 w-44 text-[12.5px]"
                                aria-label={t("featureLabel")}
                                data-testid="usage-activity-feature"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL_FEATURES}>{t("allFeatures")}</SelectItem>
                                {AI_FEATURES.map(id => (
                                    <SelectItem key={id} value={id}>
                                        {format.feature(id)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <WindowBar
                            onExport={() => void exportAll()}
                            exportDisabled={!load.data || exporting}
                        />
                    </>
                }
            />

            {load.failed !== null && !load.data ? (
                <LoadFailed status={load.failed} onRetry={load.reload} />
            ) : !load.data ? (
                <LoadingRows flush rows={8} />
            ) : (
                <section
                    className={cn(
                        "border-line bg-panel min-w-0 overflow-hidden rounded-lg border",
                        load.loading && "opacity-60"
                    )}
                >
                    {rows.length === 0 ? (
                        <EmptyLine>
                            {person !== null || feature ? t("emptyFiltered") : t("empty")}
                        </EmptyLine>
                    ) : (
                        <>
                            <Table className="text-[12.5px]" data-testid="usage-activity-table">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>{t("date")}</TableHead>
                                        <TableHead>{t("person")}</TableHead>
                                        <TableHead>{t("feature")}</TableHead>
                                        <TableHead className="@max-md:hidden">
                                            {t("route")}
                                        </TableHead>
                                        <TableHead className="text-right">{t("calls")}</TableHead>
                                        <TableHead className="text-right">{t("usage")}</TableHead>
                                        <TableHead className="@max-lg:hidden text-right">
                                            {t("input")}
                                        </TableHead>
                                        <TableHead className="@max-lg:hidden text-right">
                                            {t("output")}
                                        </TableHead>
                                        <TableHead className="@max-xl:hidden text-right">
                                            {t("cached")}
                                        </TableHead>
                                        <TableHead className="@max-md:hidden text-right">
                                            {t("cost")}
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {rows.map((row, index) => (
                                        <TableRow
                                            // Rows have no id of their own; the page order is stable.
                                            key={`${row.date}:${row.feature}:${row.route}:${index}`}
                                            data-testid="usage-activity-row"
                                        >
                                            <TableCell className="text-ink-2 whitespace-nowrap">
                                                {format.day(row.date)}
                                            </TableCell>
                                            <TableCell className="max-w-[200px]">
                                                <span className="flex min-w-0 items-center gap-2">
                                                    {row.person && row.person !== "former" && (
                                                        <ProfileAvatar
                                                            name={row.person.displayName}
                                                            src={row.person.avatarUrl}
                                                            className="size-5"
                                                        />
                                                    )}
                                                    <span
                                                        className={cn(
                                                            "truncate",
                                                            row.person && row.person !== "former"
                                                                ? "text-ink"
                                                                : "text-ink-3 italic"
                                                        )}
                                                    >
                                                        {personName(row)}
                                                    </span>
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-ink-2">
                                                {format.feature(row.feature)}
                                                {row.owner === "workspace" && (
                                                    <span className="text-ink-3 ml-1.5 text-[11px]">
                                                        {t("ownEndpoint")}
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell className="@max-md:hidden text-ink-3">
                                                {row.kind === "chat"
                                                    ? format.route(row.route || "default")
                                                    : t(`kinds.${row.kind}`)}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {format.num(row.calls)}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {format.num(row.aiTokens)}
                                            </TableCell>
                                            <TableCell className="@max-lg:hidden text-right tabular-nums">
                                                {format.num(row.inputTokens)}
                                            </TableCell>
                                            <TableCell className="@max-lg:hidden text-right tabular-nums">
                                                {format.num(row.outputTokens)}
                                            </TableCell>
                                            <TableCell className="@max-xl:hidden text-right tabular-nums">
                                                {format.num(row.cachedInputTokens)}
                                            </TableCell>
                                            <TableCell className="@max-md:hidden text-right tabular-nums">
                                                {format.usd(row.costUsd)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                            <div className="border-line flex items-center justify-between gap-3 border-t px-3.5 py-2">
                                <span className="text-ink-3 text-[12px]">
                                    {t("shown", {
                                        shown: format.num(rows.length),
                                        total: format.num(total),
                                    })}
                                </span>
                                {rows.length < total && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => void showMore()}
                                        disabled={moreBusy}
                                        data-testid="usage-activity-more"
                                    >
                                        {moreBusy ? t("loadingMore") : t("showMore")}
                                    </Button>
                                )}
                            </div>
                        </>
                    )}
                </section>
            )}
        </div>
    );
}
