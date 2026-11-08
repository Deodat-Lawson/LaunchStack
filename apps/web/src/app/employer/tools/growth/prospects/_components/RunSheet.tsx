"use client";

import { Check, CircleDashed, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
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
import { useCopyText } from "~/lib/tools/copyText";
import { useGrowthFormat } from "../../_lib/format";
import { useErrorText } from "~/lib/tools/errorText";
import { useProspects } from "../_lib/context";

function StepIcon({ status }: { status: RunStep["status"] }) {
    const t = useTranslations("growth.prospects.runSheet");
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
                    aria-label={t("running")}
                />
            );
        case "failed":
            return (
                <span
                    className={cn(
                        base,
                        "bg-danger text-danger-fg flex items-center justify-center rounded-full"
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

export function StepRow({ step, child = false }: { step: RunStep; child?: boolean }) {
    const word = useCopyText();
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
                    {word(step.labelCopy, step.label)}
                    {step.detail && (
                        <span className="text-ink-3"> · {word(step.detailCopy, step.detail)}</span>
                    )}
                </span>
                <span className="text-ink-3 text-right text-xs tabular-nums">
                    {step.right && word(step.rightCopy, step.right)}
                </span>
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

export function useElapsed(since: string | null | undefined, live: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!live || !since) return;
        const id = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, [live, since]);
    if (!since) return 0;
    return Math.max(0, (live ? now : Date.now()) - new Date(since).getTime());
}

/**
 * A run is visible work: one row per source as it finishes, then the later
 * stages. The same rows become the run's yield table afterwards. Closing the
 * sheet leaves the run going; the bar keeps a count ticking.
 */
export function RunSheet() {
    const t = useTranslations("growth.prospects.runSheet");
    const tc = useTranslations("common.actions");
    const { money, duration } = useGrowthFormat();
    const word = useCopyText();
    const errorText = useErrorText();
    const { activeRun, runSheetOpen, closeRunSheet, noteRunFinished, segment } = useProspects();
    const [stopping, setStopping] = useState(false);
    const run = activeRun;
    const live = runIsLive(run);
    const elapsedMs = useElapsed(run?.startedAt, live);
    const tookMs = run?.summary?.durationMs ?? elapsedMs;
    const expectedLabel =
        run?.mode === "live"
            ? t("expectedLive")
            : run?.mode === "fixture"
              ? t("expectedFixture")
              : t("expectedKeyless");

    const stop = async () => {
        if (!run) return;
        setStopping(true);
        try {
            await prospectsApi.stopRun(run.id);
            toast(t("stopped"));
        } catch (e) {
            toast.error(errorText(e, t("stopFailed")));
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
                            ? t("titleCompleted")
                            : run?.status === "stopped"
                              ? t("titleStopped")
                              : run?.status === "failed"
                                ? t("titleFailed")
                                : t("titleRunning")}
                    </SheetTitle>
                    <SheetDescription className="text-ink-2 text-[13px]">
                        {t("description", { segment: segment?.name ?? t("segmentFallback") })}
                    </SheetDescription>
                </SheetHeader>
                <div className="px-6 pb-6">
                    {!run ? (
                        <p className="text-ink-3 py-6 text-sm">{t("starting")}</p>
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
                            <div className="border-line text-ink-2 mt-4 space-y-1 border-t pt-3 text-xs tabular-nums">
                                <div className="flex items-center justify-between gap-3">
                                    <span>
                                        {live
                                            ? t("elapsed", { time: duration(elapsedMs) })
                                            : t("took", { time: duration(tookMs) })}
                                    </span>
                                    <span className="text-ink-3">{expectedLabel}</span>
                                </div>
                                {(run.spend.usdCap > 0 || run.spend.credits > 0) && (
                                    <div className="text-ink-3 flex items-center justify-between gap-3">
                                        <span>
                                            {t("spend", {
                                                spent: money(run.spend.usd),
                                                cap: money(run.spend.usdCap),
                                                credits: run.spend.credits,
                                            })}
                                        </span>
                                        <span className="ml-auto">
                                            {word(run.capsCopy, run.caps)}
                                        </span>
                                    </div>
                                )}
                                {!(run.spend.usdCap > 0 || run.spend.credits > 0) && (
                                    <div className="text-ink-3 flex justify-end">
                                        {word(run.capsCopy, run.caps)}
                                    </div>
                                )}
                            </div>
                            {live && run.mode === "keyless" && (
                                <p className="border-line bg-panel-2 text-ink-2 mt-3 rounded-md border px-3 py-2 text-[13px]">
                                    {t("keylessNote")}
                                </p>
                            )}
                            <div className="mt-5 flex justify-end gap-2">
                                {live ? (
                                    <>
                                        <Button variant="outline" size="sm" onClick={closeRunSheet}>
                                            {t("background")}
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="text-danger hover:text-danger"
                                            disabled={stopping}
                                            onClick={() => void stop()}
                                        >
                                            {tc("stop")}
                                        </Button>
                                    </>
                                ) : (
                                    <Button size="sm" onClick={noteRunFinished}>
                                        {tc("done")}
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
