"use client";

/**
 * Where the AI went: one row per feature, then one per model route. Routes
 * are named (Default, Fast, Reasoning…), never model ids.
 */

import React from "react";
import { useTranslations } from "next-intl";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import type { UsageFeatureRow, UsageRouteRow } from "~/lib/usage/types";

import { EmptyLine, Panel } from "../team/ui";
import { useUsageFormat } from "./format";

export function FeatureTable({
    rows,
    title,
    showPeople = true,
}: {
    rows: UsageFeatureRow[];
    title: string;
    /** The People column, which says nothing on one person's page. */
    showPeople?: boolean;
}) {
    const t = useTranslations("usage.features");
    const format = useUsageFormat();
    // Shares are of the one unit every kind adds up in; input and output are chat's own.
    const total = rows.reduce((sum, row) => sum + row.aiTokens, 0);

    return (
        <Panel title={title} testId="usage-feature-table">
            {rows.length === 0 ? (
                <EmptyLine>{t("empty")}</EmptyLine>
            ) : (
                <Table className="text-[12.5px]">
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t("feature")}</TableHead>
                            {showPeople && (
                                <TableHead className="@max-md:hidden text-right">
                                    {t("people")}
                                </TableHead>
                            )}
                            <TableHead className="text-right">{t("requests")}</TableHead>
                            <TableHead className="@max-lg:hidden text-right">
                                {t("input")}
                            </TableHead>
                            <TableHead className="@max-lg:hidden text-right">
                                {t("output")}
                            </TableHead>
                            <TableHead className="text-right">{t("usage")}</TableHead>
                            <TableHead className="@max-md:hidden text-right">{t("cost")}</TableHead>
                            <TableHead className="text-right">{t("share")}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map(row => {
                            const tokens = row.aiTokens;
                            return (
                                <TableRow key={row.feature}>
                                    <TableCell className="text-ink">
                                        {format.feature(row.feature)}
                                    </TableCell>
                                    {showPeople && (
                                        <TableCell className="@max-md:hidden text-right tabular-nums">
                                            {/* Work no one person started counts for nobody. */}
                                            {row.people > 0 ? format.num(row.people) : "—"}
                                        </TableCell>
                                    )}
                                    <TableCell className="text-right tabular-nums">
                                        {format.num(row.calls)}
                                    </TableCell>
                                    <TableCell className="@max-lg:hidden text-right tabular-nums">
                                        {format.compact(row.inputTokens)}
                                    </TableCell>
                                    <TableCell className="@max-lg:hidden text-right tabular-nums">
                                        {format.compact(row.outputTokens)}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                        {format.compact(tokens)}
                                    </TableCell>
                                    <TableCell className="@max-md:hidden text-right tabular-nums">
                                        {format.usd(row.costUsd)}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                        {total > 0 ? format.percent((tokens / total) * 100) : "—"}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            )}
        </Panel>
    );
}

export function RouteTable({ rows, title }: { rows: UsageRouteRow[]; title: string }) {
    const t = useTranslations("usage.features");
    const format = useUsageFormat();
    if (rows.length === 0) return null;
    return (
        <Panel title={title} testId="usage-route-table">
            <Table className="text-[12.5px]">
                <TableHeader>
                    <TableRow>
                        <TableHead>{t("route")}</TableHead>
                        <TableHead className="text-right">{t("calls")}</TableHead>
                        <TableHead className="text-right">{t("tokens")}</TableHead>
                        <TableHead className="text-right">{t("cost")}</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map(row => (
                        <TableRow key={row.route}>
                            <TableCell className="text-ink">{format.route(row.route)}</TableCell>
                            <TableCell className="text-right tabular-nums">
                                {format.num(row.calls)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                                {format.compact(row.inputTokens + row.outputTokens)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                                {format.usd(row.costUsd)}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </Panel>
    );
}
