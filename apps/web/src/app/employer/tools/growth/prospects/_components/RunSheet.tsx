"use client";

import { Check, CircleDashed, Loader2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "~/components/ui/sheet";
import { cn } from "~/lib/utils";

import { prospectsApi, type RunDto, type RunStep } from "../api";
import { useProspects } from "../_lib/context";
import { money } from "../../_lib/format";

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

export function runIsLive(run: RunDto | null): boolean {
    return run !== null && (run.status === "running" || run.status === "queued");
}

/**
 * A run is visible work: one row per source as it finishes, then the later
 * stages. The same rows become the run's yield table afterwards. Closing the
 * sheet leaves the run going; the rail keeps a count ticking.
 */
export function RunSheet() {
    const { activeRun, runSheetOpen, closeRunSheet, noteRunFinished, segment } = useProspects();
    const [stopping, setStopping] = useState(false);
    const run = activeRun;
    const live = runIsLive(run);

    const stop = async () => {
        if (!run) return;
        setStopping(true);
        try {
            await prospectsApi.stopRun(run.id);
            toast("Run stopped. Companies found so far are kept.");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not stop the run");
        } finally {
            setStopping(false);
        }
    };

    return (
        <Sheet open={runSheetOpen} onOpenChange={open => !open && closeRunSheet()}>
            <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[460px]">
                <SheetHeader className="px-6 pb-2 pt-6">
                    <SheetTitle className="text-ink text-lg font-semibold tracking-[-0.02em]">
                        {run?.status === "completed"
                            ? "Companies found"
                            : run?.status === "stopped"
                              ? "Run stopped"
                              : run?.status === "failed"
                                ? "Run failed"
                                : "Finding companies"}
                    </SheetTitle>
                    <SheetDescription className="text-ink-2 text-[13px]">
                        {segment?.name ?? "Segment"}. Searching the sources this segment has on,
                        then profiling the best matches and finding people for the top ten.
                    </SheetDescription>
                </SheetHeader>
                <div className="px-6 pb-6">
                    {!run ? (
                        <p className="text-ink-3 py-6 text-sm">Starting…</p>
                    ) : (
                        <>
                            <div className="mt-2">
                                {run.steps.map(step => (
                                    <StepRow key={step.id} step={step} />
                                ))}
                            </div>
                            {run.errorMessage && (
                                <p className="text-danger mt-3 text-sm">{run.errorMessage}</p>
                            )}
                            <div className="border-line text-ink-3 mt-4 flex items-center justify-between border-t pt-3 text-xs tabular-nums">
                                <span>
                                    {money(run.spend.usd)} of {money(run.spend.usdCap)} spent ·{" "}
                                    {run.spend.credits} credits
                                </span>
                                <span>{run.caps}</span>
                            </div>
                            <div className="mt-5 flex justify-end gap-2">
                                {live ? (
                                    <>
                                        <Button variant="outline" size="sm" onClick={closeRunSheet}>
                                            Run in background
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="text-danger hover:text-danger"
                                            disabled={stopping}
                                            onClick={() => void stop()}
                                        >
                                            Stop
                                        </Button>
                                    </>
                                ) : (
                                    <Button size="sm" onClick={noteRunFinished}>
                                        Done
                                    </Button>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}
