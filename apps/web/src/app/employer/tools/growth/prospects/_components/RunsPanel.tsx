"use client";

import { Check, ChevronDown, ChevronRight, CircleDashed, Loader2, X } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";

import { prospectsApi, type RunDto, type RunStep, type SourceYield } from "../api";
import { isRunLive, useProspects } from "../_lib/context";
import { duration, relativeTime } from "../../_lib/format";
import { useResource } from "../../_lib/useResource";
import { EmptyState, InlineError } from "../../_components/EmptyState";
import { Panel } from "../../_components/Panel";
import { SkeletonRows } from "../../_components/SkeletonRows";

function StepIcon({ status }: { status: RunStep["status"] }) {
    const base = "size-3.5 shrink-0";
    switch (status) {
        case "done":
            return (
                <span
                    className={cn(
                        base,
                        "bg-success text-brand-fg flex items-center justify-center rounded-full"
                    )}
                >
                    <Check className="size-2.5" strokeWidth={3} />
                </span>
            );
        case "running":
            return (
                <Loader2
                    className={cn(base, "text-brand animate-spin motion-reduce:animate-none")}
                    aria-label="Running"
                />
            );
        case "failed":
            return (
                <span
                    className={cn(
                        base,
                        "bg-danger flex items-center justify-center rounded-full text-white"
                    )}
                >
                    <X className="size-2.5" strokeWidth={3} />
                </span>
            );
        case "skipped":
            return <CircleDashed className={cn(base, "text-ink-4")} />;
        default:
            return <span className={cn(base, "border-line rounded-full border-[1.5px]")} />;
    }
}

function StepRow({ step, child = false }: { step: RunStep; child?: boolean }) {
    return (
        <>
            <div
                className={cn(
                    "border-line-2 grid grid-cols-[18px_1fr_auto] items-center gap-2.5 border-t py-2 text-[13.5px] first:border-t-0",
                    child && "pl-[18px] text-[13px]",
                    step.status === "waiting" && "text-ink-2",
                    step.status === "skipped" && "text-ink-3"
                )}
            >
                <StepIcon status={step.status} />
                <span className="min-w-0 truncate">
                    {step.label}
                    {step.detail && <span className="text-ink-3"> · {step.detail}</span>}
                </span>
                <span className="text-ink-3 text-right text-xs tabular-nums">{step.right}</span>
            </div>
            {step.children?.map(c => (
                <StepRow key={c.id} step={c} child />
            ))}
        </>
    );
}

function StatusWord({ run }: { run: RunDto }) {
    const live = isRunLive(run);
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
                ? run.stopRequested
                    ? "Stopping"
                    : "Running"
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

const MODE_WORD: Record<RunDto["mode"], string> = {
    live: "live providers",
    keyless: "public sources, no keys",
    sample: "sample data",
};

/**
 * The runs panel: the run in flight with its steps and a Stop, the switch
 * between live and sample data, and every earlier run with what it found.
 */
export function RunsPanel({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
}) {
    const {
        segmentId,
        segment,
        activeRun,
        nextMode,
        startRun,
        stopRun,
        samplePreferred,
        setSamplePreferred,
        runsVersion,
    } = useProspects();
    const res = useResource(
        open && segmentId ? `runs:${segmentId}:${runsVersion}` : null,
        () => prospectsApi.runs(segmentId!),
        { pollMs: activeRun && isRunLive(activeRun) ? 5000 : null }
    );
    const [expanded, setExpanded] = useState<string | null>(null);
    const [busy, setBusy] = useState<"start" | "stop" | null>(null);
    const live = isRunLive(activeRun);

    useEffect(() => {
        if (!open) setExpanded(null);
    }, [open]);

    const start = async () => {
        setBusy("start");
        try {
            await startRun({ sample: samplePreferred });
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not start the run");
        } finally {
            setBusy(null);
        }
    };
    const stop = async () => {
        setBusy("stop");
        try {
            await stopRun();
            toast("Stopping after the current company. Everything found so far is kept.");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not stop the run");
        } finally {
            setBusy(null);
        }
    };

    const history = (res.data?.runs ?? []).filter(r => r.id !== activeRun?.id);

    return (
        <Panel
            open={open}
            onOpenChange={onOpenChange}
            size="md"
            title="Runs"
            description={
                nextMode === "keyless"
                    ? "No API keys are configured, so a run reads public directories and each company's own website."
                    : "Each run searches the sources this segment has on, profiles the best matches and finds people."
            }
            footer={
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                        <Switch
                            id="prospects-sample"
                            checked={samplePreferred}
                            onCheckedChange={setSamplePreferred}
                            aria-label="Use sample data"
                        />
                        <Label
                            htmlFor="prospects-sample"
                            className="text-ink-2 text-xs font-normal"
                        >
                            Sample data
                        </Label>
                    </span>
                    <span className="flex items-center gap-2">
                        {live ? (
                            <Button
                                variant="outline"
                                size="sm"
                                className="text-danger hover:text-danger"
                                disabled={busy !== null || activeRun?.stopRequested}
                                onClick={() => void stop()}
                            >
                                {activeRun?.stopRequested ? "Stopping…" : "Stop"}
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                disabled={!segmentId || busy !== null}
                                onClick={() => void start()}
                            >
                                Find companies
                            </Button>
                        )}
                    </span>
                </div>
            }
        >
            {activeRun && (
                <section className="mb-6">
                    <div className="mb-2 flex items-center justify-between">
                        <h2 className="text-ink text-[13px] font-semibold">
                            {activeRun.status === "completed"
                                ? "Companies found"
                                : activeRun.status === "stopped"
                                  ? "Run stopped"
                                  : activeRun.status === "failed"
                                    ? "Run failed"
                                    : "Finding companies"}
                            <span className="text-ink-3 ml-2 text-xs font-normal">
                                {segment?.name ?? ""} · {MODE_WORD[activeRun.mode]}
                            </span>
                        </h2>
                        <StatusWord run={activeRun} />
                    </div>
                    <div className="border-line bg-panel rounded-lg border px-4 py-1">
                        {activeRun.steps.map(step => (
                            <StepRow key={step.id} step={step} />
                        ))}
                    </div>
                    {activeRun.progress && (
                        <div className="mt-2" aria-label="Profiling progress">
                            <div className="bg-line-2 h-1.5 overflow-hidden rounded-full">
                                <div
                                    className="bg-brand h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
                                    style={{
                                        width: `${Math.min(100, Math.round((activeRun.progress.profiled / Math.max(1, activeRun.progress.shortlisted)) * 100))}%`,
                                    }}
                                />
                            </div>
                            <div className="text-ink-3 mt-1 text-xs tabular-nums">
                                {activeRun.progress.profiled} of {activeRun.progress.shortlisted}{" "}
                                profiled
                            </div>
                        </div>
                    )}
                    {activeRun.errorMessage && (
                        <p className="text-danger mt-2 text-sm">{activeRun.errorMessage}</p>
                    )}
                    <div className="text-ink-3 mt-2 flex items-center justify-between text-xs tabular-nums">
                        <span>{activeRun.spend.credits} credits</span>
                        <span>{activeRun.caps}</span>
                    </div>
                </section>
            )}

            <section>
                <h2 className="text-ink mb-2 text-[13px] font-semibold">
                    Earlier runs
                    {res.data && (
                        <span className="text-ink-3 ml-2 text-xs font-normal">
                            {history.length} so far
                        </span>
                    )}
                </h2>
                {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}
                {res.loading ? (
                    <SkeletonRows rows={3} height={44} />
                ) : history.length === 0 ? (
                    <EmptyState
                        title={activeRun ? "This is the first run" : "No runs yet"}
                        body="A run takes a few minutes and shows its progress as it goes. Everything it finds stays in the segment."
                    />
                ) : (
                    <div className="border-line bg-panel overflow-hidden rounded-lg border">
                        {history.map(run => {
                            const isOpen = expanded === run.id;
                            return (
                                <Fragment key={run.id}>
                                    <button
                                        type="button"
                                        onClick={() => setExpanded(isOpen ? null : run.id)}
                                        className="border-line-2 hover:bg-panel-2 focus-visible:ring-brand/50 grid w-full grid-cols-[16px_1fr_auto] items-center gap-2 border-t px-3 py-2 text-left text-[13px] outline-none first:border-t-0 focus-visible:ring-[3px]"
                                        aria-expanded={isOpen}
                                    >
                                        {isOpen ? (
                                            <ChevronDown className="text-ink-3 size-3.5" />
                                        ) : (
                                            <ChevronRight className="text-ink-3 size-3.5" />
                                        )}
                                        <span className="min-w-0">
                                            <span className="text-ink block truncate">
                                                {relativeTime(run.startedAt)}
                                                <span className="text-ink-3">
                                                    {" "}
                                                    · {MODE_WORD[run.mode]}
                                                </span>
                                            </span>
                                            <span className="text-ink-3 block truncate text-xs tabular-nums">
                                                {run.summary
                                                    ? `${run.summary.found} found · ${run.summary.newCompanies} companies · ${run.summary.profiled} profiled · ${duration(run.summary.durationMs)}`
                                                    : (run.errorMessage ?? "No summary")}
                                            </span>
                                        </span>
                                        <StatusWord run={run} />
                                    </button>
                                    {isOpen && run.summary && (
                                        <div className="bg-surface-2 border-line-2 border-t px-4 py-3">
                                            <YieldTable sources={run.summary.sources} />
                                            {run.errorMessage && (
                                                <p className="text-danger mt-2 text-xs">
                                                    {run.errorMessage}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </Fragment>
                            );
                        })}
                    </div>
                )}
            </section>
        </Panel>
    );
}
