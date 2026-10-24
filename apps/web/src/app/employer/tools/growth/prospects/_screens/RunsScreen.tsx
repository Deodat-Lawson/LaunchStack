"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import { cn } from "~/lib/utils";

import { prospectsApi, type RunDto, type SourceYield } from "../api";
import { useGrowthFormat } from "../../_lib/format";
import { useProspects } from "../_lib/context";
import { useResource } from "~/lib/tools/useResource";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader } from "~/components/tools/PageHeader";
import { runIsLive } from "../_components/RunSheet";
import { SkeletonRows } from "~/components/tools/SkeletonRows";

function StatusWord({ run }: { run: RunDto }) {
    const t = useTranslations("growth.prospects.runs.status");
    const live = runIsLive(run);
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 text-xs",
                run.status === "completed" && "text-ink-2",
                live && "text-brand-ink",
                run.status === "failed" && "text-danger",
                run.status === "stopped" && "text-ink-3"
            )}
        >
            <span
                className={cn(
                    "size-[7px] rounded-full",
                    run.status === "completed" && "bg-success",
                    live && "bg-brand animate-pulse motion-reduce:animate-none",
                    run.status === "failed" && "bg-danger",
                    run.status === "stopped" && "bg-ink-4"
                )}
            />
            {live
                ? t("running")
                : run.status === "completed"
                  ? t("completed")
                  : run.status === "failed"
                    ? t("failed")
                    : t("stopped")}
        </span>
    );
}

function YieldTable({ sources }: { sources: SourceYield[] }) {
    const t = useTranslations("growth.prospects");
    const tc = useTranslations("common.fields");
    return (
        <table className="w-full text-[13px]">
            <thead>
                <tr className="text-ink-3 text-left text-xs">
                    <th className="py-1 pr-3 font-medium">{t("common.source")}</th>
                    <th className="py-1 pr-3 text-right font-medium">{t("runs.found")}</th>
                    <th className="py-1 pr-3 text-right font-medium">{t("runs.new")}</th>
                    <th className="py-1 pr-3 text-right font-medium">{t("runs.inDeal")}</th>
                    <th className="py-1 font-medium">{tc("status")}</th>
                </tr>
            </thead>
            <tbody>
                {sources.map(s => (
                    <tr key={s.sourceId} className="border-line-2 border-t">
                        <td className="py-1.5 pr-3">{s.label}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                            {s.kind === "signal"
                                ? t("common.signals", { count: s.found })
                                : s.found}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                            {s.kind === "signal" ? "" : (s.newCompanies ?? "—")}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                            {s.kind === "signal" ? "" : (s.inDeals ?? "—")}
                        </td>
                        <td
                            className={cn(
                                "py-1.5 text-xs",
                                s.status === "ok" && "text-ink-2",
                                s.status === "degraded" && "text-warn",
                                s.status === "failed" && "text-danger",
                                (s.status === "skipped" || s.status === "off") && "text-ink-3"
                            )}
                        >
                            {s.status === "ok" ? t("runs.ok") : (s.detail ?? s.status)}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export function RunsScreen() {
    const t = useTranslations("growth.prospects");
    const tc = useTranslations("common.fields");
    const { relativeTime, money, duration } = useGrowthFormat();
    const { segmentId, startRun, activeRun, openRunSheet, samplePreferred, setSamplePreferred } =
        useProspects();
    const res = useResource(
        segmentId ? `runs:${segmentId}` : null,
        () => prospectsApi.runs(segmentId!),
        {
            pollMs: activeRun && runIsLive(activeRun) ? 2000 : null,
        }
    );
    const finished = activeRun?.status === "completed" || activeRun?.status === "stopped";
    const reload = res.reload;
    useEffect(() => {
        if (finished) void reload();
    }, [finished, reload]);
    const [expanded, setExpanded] = useState<string | null>(null);
    const runs = res.data?.runs ?? [];
    const keyless = res.data?.nextMode === "keyless";

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
            <PageHeader
                size="md"
                title={t("runs.title")}
                sub={
                    res.data
                        ? keyless
                            ? t("runs.subKeyless", { count: runs.length })
                            : t("runs.subLive", { count: runs.length })
                        : undefined
                }
                actions={
                    <>
                        <span className="flex items-center gap-2 pr-1">
                            <Switch
                                id="prospects-sample"
                                checked={samplePreferred}
                                onCheckedChange={setSamplePreferred}
                                aria-label={t("runs.sampleAria")}
                            />
                            <Label
                                htmlFor="prospects-sample"
                                className="text-ink-2 text-xs font-normal"
                            >
                                {t("runs.sample")}
                            </Label>
                        </span>
                        <Button
                            size="sm"
                            onClick={() =>
                                void startRun({ sample: samplePreferred }).catch((e: unknown) =>
                                    toast.error(
                                        e instanceof Error ? e.message : t("common.startFailed")
                                    )
                                )
                            }
                            disabled={!segmentId || (activeRun !== null && runIsLive(activeRun))}
                        >
                            {t("common.findCompanies")}
                        </Button>
                    </>
                }
            />
            {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}
            {res.loading ? (
                <SkeletonRows rows={4} height={48} />
            ) : runs.length === 0 ? (
                <EmptyState
                    mark
                    title={t("runs.noRuns")}
                    body={t("runs.noRunsBody")}
                    action={
                        <Button size="sm" onClick={() => void startRun()}>
                            {t("common.findCompanies")}
                        </Button>
                    }
                />
            ) : (
                <div className="border-line bg-panel overflow-x-auto rounded-lg border">
                    <Table className="text-[13px]">
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="w-8" />
                                <TableHead className="text-ink-3 text-xs font-medium">
                                    {t("runs.started")}
                                </TableHead>
                                <TableHead className="text-ink-3 text-xs font-medium">
                                    {tc("status")}
                                </TableHead>
                                <TableHead className="text-ink-3 text-right text-xs font-medium">
                                    {t("runs.found")}
                                </TableHead>
                                <TableHead className="text-ink-3 text-right text-xs font-medium">
                                    {t("runs.new")}
                                </TableHead>
                                <TableHead className="text-ink-3 text-right text-xs font-medium">
                                    {t("runs.profiled")}
                                </TableHead>
                                <TableHead className="text-ink-3 text-right text-xs font-medium">
                                    {t("common.people")}
                                </TableHead>
                                <TableHead className="text-ink-3 text-right text-xs font-medium">
                                    {t("runs.spend")}
                                </TableHead>
                                <TableHead className="text-ink-3 text-right text-xs font-medium">
                                    {t("runs.took")}
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {runs.map(run => {
                                const open = expanded === run.id;
                                const live = runIsLive(run);
                                return (
                                    <Fragment key={run.id}>
                                        <TableRow
                                            className="cursor-pointer"
                                            onClick={() =>
                                                live
                                                    ? openRunSheet(run.id)
                                                    : setExpanded(open ? null : run.id)
                                            }
                                        >
                                            <TableCell className="text-ink-3 pr-0">
                                                {live ? null : open ? (
                                                    <ChevronDown className="size-3.5" />
                                                ) : (
                                                    <ChevronRight className="size-3.5" />
                                                )}
                                            </TableCell>
                                            <TableCell className="text-ink">
                                                {relativeTime(run.startedAt)}
                                            </TableCell>
                                            <TableCell>
                                                <StatusWord run={run} />
                                                {live && (
                                                    <span className="text-ink-3 ml-2 text-xs">
                                                        {t("runs.openProgress")}
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {run.summary?.found ?? "—"}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {run.summary?.newCompanies ?? "—"}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {run.summary?.profiled ?? "—"}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {run.summary?.people ?? "—"}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {t("runs.spendCell", {
                                                    money: money(run.spend.usd),
                                                    credits: run.spend.credits,
                                                })}
                                            </TableCell>
                                            <TableCell className="text-ink-2 text-right tabular-nums">
                                                {run.summary
                                                    ? duration(run.summary.durationMs)
                                                    : "—"}
                                            </TableCell>
                                        </TableRow>
                                        {open && run.summary && (
                                            <TableRow className="hover:bg-transparent">
                                                <TableCell
                                                    colSpan={9}
                                                    className="bg-surface-2 px-6 py-3"
                                                >
                                                    <YieldTable sources={run.summary.sources} />
                                                    {run.errorMessage && (
                                                        <p className="text-danger mt-2 text-xs">
                                                            {run.errorMessage}
                                                        </p>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </Fragment>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}
