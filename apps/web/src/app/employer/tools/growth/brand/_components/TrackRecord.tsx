"use client";

import { useLocale, useTranslations } from "next-intl";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { InlineError } from "~/components/tools/EmptyState";
import { SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { Button } from "~/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import type { TrackRecord, TrackRecordRow } from "~/lib/scenarios/types";
import { formatPercent } from "~/lib/scenarios/words";
import { useResource } from "~/lib/tools/useResource";

import { useGrowthFormat } from "../../_lib/format";
import { useGrowthPaths } from "../../_lib/paths";
import { brandApi, type BrandPlatform } from "../api";
import { NETWORK_LABEL } from "./NetworkMark";

/** Agreement this strong or more reads as "ranked the same way". */
const AGREES = 0.3;

function networkName(network: string): string {
    return NETWORK_LABEL[network as BrandPlatform] ?? network;
}

/**
 * Whether post tests have been worth anything: for drafts tested before they
 * went out, the simulated engagement against the real one. Says nothing until
 * enough tested posts have real numbers, and then only what the numbers say.
 */
export function TrackRecordSection() {
    const t = useTranslations("growth.brand.trackRecord");
    const res = useResource("brand:post-tests:track-record", () => brandApi.trackRecord());
    const record = res.data?.record ?? null;
    return (
        <section>
            <SectionHeading title={t("title")} aside={t("aside")} />
            {res.error ? (
                <InlineError message={res.error} onRetry={() => void res.reload()} />
            ) : !record ? (
                <SkeletonRows rows={3} height={44} />
            ) : (
                <div className="border-line bg-panel overflow-hidden rounded-lg border">
                    <div className="px-4 py-3.5">
                        {record.withResults < record.minimum || record.spearman === null ? (
                            <NotEnough record={record} />
                        ) : (
                            <Agreement record={record} spearman={record.spearman} />
                        )}
                    </div>
                    {record.rows.length > 0 && <Rows rows={record.rows} />}
                </div>
            )}
        </section>
    );
}

function NotEnough({ record }: { record: TrackRecord }) {
    const t = useTranslations("growth.brand");
    const paths = useGrowthPaths();
    const waiting = record.tested - record.withResults;
    return (
        <div className="flex flex-col items-start gap-2">
            <div className="text-ink text-sm font-medium">
                {t("trackRecord.notEnough", {
                    count: record.withResults,
                    minimum: record.minimum,
                })}
            </div>
            <p className="text-ink-2 max-w-[70ch] text-[13px] leading-relaxed">
                {t("trackRecord.notEnoughBody", { minimum: record.minimum })}
                {record.tested > 0 &&
                    ` ${
                        waiting > 0
                            ? t("trackRecord.soFarWaiting", { count: record.tested, waiting })
                            : t("trackRecord.soFar", { count: record.tested })
                    }`}
            </p>
            <Button asChild size="sm" variant="outline">
                <ToolLink href={paths.brand("/compose")}>{t("common.composeAPost")}</ToolLink>
            </Button>
        </div>
    );
}

function Agreement({ record, spearman }: { record: TrackRecord; spearman: number }) {
    const t = useTranslations("growth.brand.trackRecord");
    const locale = useLocale();
    const agrees = spearman >= AGREES;
    return (
        <div className="flex flex-col gap-1.5">
            <div className="text-ink text-sm font-medium">
                {agrees ? t("agrees") : t("disagrees")}
            </div>
            <p className="text-ink-2 max-w-[75ch] text-[13px] leading-relaxed">
                {t.rich("agreement", {
                    value: spearman.toLocaleString(locale, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                    }),
                    count: record.withResults,
                    hits: record.hits,
                    total: record.total,
                    mono: chunks => <span className="font-mono tabular-nums">{chunks}</span>,
                })}
            </p>
            {record.withResults < 15 && (
                <p className="text-ink-3 text-xs">
                    {t("smallSample", { count: record.withResults })}
                </p>
            )}
        </div>
    );
}

function Rows({ rows }: { rows: TrackRecordRow[] }) {
    const t = useTranslations("growth.brand");
    const locale = useLocale();
    const { shortDate } = useGrowthFormat();
    return (
        <div className="border-line-2 overflow-x-auto border-t">
            <Table className="min-w-[620px] text-[13px]">
                <TableHeader>
                    <TableRow className="hover:bg-transparent">
                        <TableHead className="text-ink-3 pl-4 text-xs font-medium">
                            {t("common.post")}
                        </TableHead>
                        <TableHead className="text-ink-3 text-xs font-medium">
                            {t("trackRecord.network")}
                        </TableHead>
                        <TableHead className="text-ink-3 text-xs font-medium">
                            {t("common.published")}
                        </TableHead>
                        <TableHead className="text-ink-3 text-right text-xs font-medium">
                            {t("trackRecord.simulated")}
                        </TableHead>
                        <TableHead className="text-ink-3 pr-4 text-right text-xs font-medium">
                            {t("trackRecord.real")}
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map(row => (
                        <TableRow key={`${row.runId}-${row.postId}`}>
                            <TableCell
                                className="text-ink max-w-[320px] truncate pl-4"
                                title={row.text}
                            >
                                {row.text}
                            </TableCell>
                            <TableCell className="text-ink-2">{networkName(row.network)}</TableCell>
                            <TableCell className="text-ink-2 tabular-nums">
                                {row.publishedAt
                                    ? shortDate(row.publishedAt)
                                    : t("trackRecord.notYet")}
                            </TableCell>
                            <TableCell className="text-ink-2 text-right font-mono tabular-nums">
                                {formatPercent(row.predicted, locale)}
                            </TableCell>
                            <TableCell className="pr-4 text-right font-mono tabular-nums">
                                {row.actual === null ? (
                                    <span className="text-ink-3 font-sans text-xs">
                                        {t("trackRecord.waiting")}
                                    </span>
                                ) : (
                                    <span className="text-ink">
                                        {formatPercent(row.actual, locale)}
                                    </span>
                                )}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
