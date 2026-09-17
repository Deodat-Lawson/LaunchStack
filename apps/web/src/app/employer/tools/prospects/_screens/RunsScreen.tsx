"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
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
import { useProspects } from "../_lib/context";
import { duration, money, relativeTime } from "../_lib/format";
import { useResource } from "../_lib/useResource";
import { EmptyState, InlineError } from "../_components/EmptyState";
import { PageHeader } from "../_components/PageHeader";
import { runIsLive } from "../_components/RunSheet";
import { SkeletonRows } from "../_components/SkeletonRows";

function StatusWord({ run }: { run: RunDto }) {
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
                ? "Running"
                : run.status === "completed"
                  ? "Completed"
                  : run.status === "failed"
                    ? "Failed"
                    : "Stopped"}
        </span>
    );
}

function YieldTable({ sources }: { sources: SourceYield[] }) {
    return (
        <table className="w-full text-[13px]">
            <thead>
                <tr className="text-ink-3 text-left text-xs">
                    <th className="py-1 pr-3 font-medium">Source</th>
                    <th className="py-1 pr-3 text-right font-medium">Found</th>
                    <th className="py-1 pr-3 text-right font-medium">New</th>
                    <th className="py-1 pr-3 text-right font-medium">In a deal</th>
                    <th className="py-1 font-medium">Status</th>
                </tr>
            </thead>
            <tbody>
                {sources.map(s => (
                    <tr key={s.sourceId} className="border-line-2 border-t">
                        <td className="py-1.5 pr-3">{s.label}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                            {s.kind === "signal" ? `${s.found} signals` : s.found}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                            {s.kind === "signal" ? "" : s.newCompanies}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                            {s.kind === "signal" ? "" : s.inDeals}
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
                            {s.status === "ok" ? "ok" : (s.detail ?? s.status)}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export function RunsScreen() {
    const { segmentId, startRun, activeRun, openRunSheet } = useProspects();
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

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
            <PageHeader
                size="md"
                title="Runs"
                sub={
                    res.data
                        ? `${runs.length} so far · each run searches the sources this segment has on`
                        : undefined
                }
                actions={
                    <Button
                        size="sm"
                        onClick={() =>
                            void startRun().catch((e: unknown) =>
                                toast.error(
                                    e instanceof Error ? e.message : "Could not start the run"
                                )
                            )
                        }
                        disabled={!segmentId || (activeRun !== null && runIsLive(activeRun))}
                    >
                        Find companies
                    </Button>
                }
            />
            {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}
            {res.loading ? (
                <SkeletonRows rows={4} height={48} />
            ) : runs.length === 0 ? (
                <EmptyState
                    mark
                    title="No runs yet"
                    body="A run searches every source this segment has on, profiles the best matches and finds people. It takes a few minutes and shows its progress as it goes."
                    action={
                        <Button size="sm" onClick={() => void startRun()}>
                            Find companies
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
                                    Started
                                </TableHead>
                                <TableHead className="text-ink-3 text-xs font-medium">
                                    Status
                                </TableHead>
                                <TableHead className="text-ink-3 text-right text-xs font-medium">
                                    Found
                                </TableHead>
                                <TableHead className="text-ink-3 text-right text-xs font-medium">
                                    New
                                </TableHead>
                                <TableHead className="text-ink-3 text-right text-xs font-medium">
                                    Profiled
                                </TableHead>
                                <TableHead className="text-ink-3 text-right text-xs font-medium">
                                    People
                                </TableHead>
                                <TableHead className="text-ink-3 text-right text-xs font-medium">
                                    Spend
                                </TableHead>
                                <TableHead className="text-ink-3 text-right text-xs font-medium">
                                    Took
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
                                                        open progress
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
                                                {money(run.spend.usd)} · {run.spend.credits} cr
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
