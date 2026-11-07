"use client";

/**
 * Which documents get opened — the workspace's counterpart to Cursor's
 * repository insights. Only documents the reader may open are listed. Opens
 * per day, then every document with its opens and distinct readers in the
 * window; a row opens the document's sheet (its opens over 30 days and who
 * read it last).
 *
 * This was the Analytics app's document table until Analytics folded into
 * the Usage tab.
 */

import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { PageHeader } from "~/components/tools/PageHeader";
import {
    ChartContainer,
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
import { csvFileName, downloadCsv, toCsv } from "~/lib/usage/csv";
import type { UsageDocumentRow, UsageDocuments } from "~/lib/usage/types";
import { cn } from "~/lib/utils";

import { useTimeFormat } from "../settings/people/format";
import { EmptyLine, FilterInput, LoadingRows, Panel } from "../team/ui";
import { DocumentDetailsSheet } from "./DocumentDetailsSheet";
import { useUsageFilters, useUsageLoad, windowQuery } from "./data";
import { SINGLE_SERIES_THEME, useUsageFormat } from "./format";
import { LoadFailed, StatTile, TileGrid, WindowBar, useWindowLabel } from "./ui";

export function DocumentsScreen() {
    const t = useTranslations("usage.documents");
    const format = useUsageFormat();
    const time = useTimeFormat();
    const { choice } = useUsageFilters();
    const query = useMemo(() => windowQuery(choice), [choice]);
    const load = useUsageLoad<UsageDocuments>("/api/usage/documents", query);
    const data = load.data;
    const range = useWindowLabel(data?.window);
    const [filter, setFilter] = useState("");
    const [open, setOpen] = useState<UsageDocumentRow | null>(null);

    const needle = filter.trim().toLowerCase();
    const shown = useMemo(
        () =>
            (data?.documents ?? []).filter(
                doc =>
                    !needle ||
                    doc.title.toLowerCase().includes(needle) ||
                    doc.category.toLowerCase().includes(needle)
            ),
        [data, needle]
    );
    const opened = data?.documents.filter(doc => doc.views > 0).length ?? 0;
    const config = useMemo<ChartConfig>(
        () => ({ views: { label: t("opens"), theme: SINGLE_SERIES_THEME } }),
        [t]
    );

    const exportDocuments = () => {
        if (!data) return;
        const csv = toCsv(
            ["document", "category", "opens", "people", "last_opened", "added"],
            shown.map(doc => [
                doc.title,
                doc.category,
                doc.views,
                doc.viewers,
                doc.lastViewedAt,
                doc.createdAt,
            ])
        );
        downloadCsv(csvFileName("documents", data.window), csv);
    };

    return (
        <div className="mx-auto flex max-w-[1180px] flex-col gap-5" data-testid="usage-documents">
            <PageHeader
                title={t("title")}
                sub={data ? t("sub", { range }) : " "}
                actions={
                    <>
                        <FilterInput
                            value={filter}
                            onChange={setFilter}
                            placeholder={t("filterPlaceholder")}
                        />
                        <WindowBar onExport={exportDocuments} exportDisabled={!data} />
                    </>
                }
            />

            {load.failed !== null && !data ? (
                <LoadFailed status={load.failed} onRetry={load.reload} />
            ) : !data ? (
                <LoadingRows flush rows={6} />
            ) : (
                <>
                    <TileGrid className="@max-xl:grid-cols-3 grid-cols-3">
                        <StatTile
                            label={t("documents")}
                            value={format.compact(data.totalDocuments)}
                            sub={t("documentsSub")}
                        />
                        <StatTile
                            label={t("opens")}
                            value={format.compact(data.totalViews)}
                            sub={range}
                        />
                        <StatTile
                            label={t("opened")}
                            value={format.compact(opened)}
                            sub={
                                data.totalDocuments > 0
                                    ? t("openedSub", {
                                          percent: format.percent(
                                              (opened / data.totalDocuments) * 100
                                          ),
                                      })
                                    : undefined
                            }
                        />
                    </TileGrid>

                    <Panel title={t("perDay")} testId="usage-documents-chart">
                        <div className="px-2 pt-1">
                            {data.totalViews === 0 ? (
                                <div className="text-ink-3 py-14 text-center text-[13px]">
                                    {t("noOpens")}
                                </div>
                            ) : (
                                <ChartContainer
                                    config={config}
                                    className={cn("h-[200px] w-full", load.loading && "opacity-60")}
                                >
                                    <BarChart
                                        data={data.trend}
                                        barCategoryGap={3}
                                        margin={{ left: 4, right: 4 }}
                                    >
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
                                            width={40}
                                            allowDecimals={false}
                                            tickFormatter={(n: number) => format.compact(n)}
                                        />
                                        <ChartTooltip
                                            cursor={{ fill: "var(--panel-2)" }}
                                            content={
                                                <ChartTooltipContent
                                                    labelFormatter={(date: unknown) =>
                                                        format.longDay(String(date))
                                                    }
                                                />
                                            }
                                        />
                                        <Bar
                                            dataKey="views"
                                            fill="var(--color-views)"
                                            maxBarSize={24}
                                            radius={[4, 4, 0, 0]}
                                        />
                                    </BarChart>
                                </ChartContainer>
                            )}
                        </div>
                    </Panel>

                    <section
                        className={cn(
                            "border-line bg-panel min-w-0 overflow-hidden rounded-lg border",
                            load.loading && "opacity-60"
                        )}
                    >
                        {shown.length === 0 ? (
                            <EmptyLine>{needle ? t("noMatch") : t("empty")}</EmptyLine>
                        ) : (
                            <Table className="text-[12.5px]" data-testid="usage-documents-table">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>{t("document")}</TableHead>
                                        <TableHead className="@max-md:hidden">
                                            {t("category")}
                                        </TableHead>
                                        <TableHead className="text-right">{t("opens")}</TableHead>
                                        <TableHead className="text-right">{t("people")}</TableHead>
                                        <TableHead className="@max-md:hidden text-right">
                                            {t("lastOpened")}
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {shown.map(doc => (
                                        <TableRow
                                            key={doc.id}
                                            className="cursor-pointer"
                                            onClick={() => setOpen(doc)}
                                            data-testid="usage-document-row"
                                        >
                                            <TableCell className="max-w-[360px]">
                                                <button
                                                    type="button"
                                                    className="text-ink block max-w-full truncate text-left font-medium hover:underline"
                                                    onClick={event => {
                                                        event.stopPropagation();
                                                        setOpen(doc);
                                                    }}
                                                >
                                                    {doc.title}
                                                </button>
                                            </TableCell>
                                            <TableCell className="@max-md:hidden text-ink-3">
                                                {doc.category}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {format.num(doc.views)}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {format.num(doc.viewers)}
                                            </TableCell>
                                            <TableCell className="@max-md:hidden text-ink-3 whitespace-nowrap text-right">
                                                {doc.lastViewedAt
                                                    ? time.relative(doc.lastViewedAt)
                                                    : t("never")}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </section>
                </>
            )}

            <DocumentDetailsSheet
                document={open}
                isOpen={open !== null}
                onClose={() => setOpen(null)}
            />
        </div>
    );
}
