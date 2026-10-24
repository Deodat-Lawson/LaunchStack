"use client";

import { Check, CircleDashed, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "~/components/ui/sheet";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { cn } from "~/lib/utils";

import { useToolFormat } from "~/lib/tools/format";
import { runIsLive, useProposals } from "../_lib/context";
import { useCopyText } from "~/lib/tools/copyText";
import type { RunStepDto } from "../api";

function StepIcon({ status }: { status: RunStepDto["status"] }) {
    const t = useTranslations("proposals.runSheet");
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
                    aria-label={t("stepRunning")}
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

/**
 * A run is visible work: one row per step as it finishes. Closing the sheet
 * leaves the run going; the bar keeps its indicator until it is done.
 */
export function ProposalRunSheet() {
    const t = useTranslations("proposals.runSheet");
    const tKind = useTranslations("proposals.runKind");
    const tc = useTranslations("common");
    const format = useToolFormat();
    const say = useCopyText();
    const { activeRun, runSheetOpen, closeRunSheet, href } = useProposals();
    const run = activeRun;
    const headline = run?.headline != null ? say(run.headlineCopy, run.headline) : null;
    const runError = run?.error != null ? say(run.errorCopy, run.error) : null;
    const live = runIsLive(run);
    const elapsed = run?.completedAt
        ? format.duration(new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime())
        : null;
    return (
        <Sheet open={runSheetOpen} onOpenChange={open => !open && closeRunSheet()}>
            {/* Mounted in the tab (the frame's overlay), so `w-full` is the
                tab's width. The cap stays an `sm:` variant on purpose: it
                has to replace the kit's own `sm:max-w-sm`, which a container
                variant would not. */}
            <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[440px]">
                <SheetHeader className="px-6 pb-2 pt-6">
                    <SheetTitle className="text-ink text-lg font-semibold tracking-[-0.02em]">
                        {!run
                            ? t("noRun")
                            : run.status === "completed"
                              ? // A rewrite has no title of its own once done.
                                run.kind === "rewrite"
                                  ? tc("status.done")
                                  : t(`doneTitle.${run.kind}`)
                              : run.status === "failed"
                                ? t("failed")
                                : tKind(run.kind)}
                    </SheetTitle>
                    <SheetDescription className="text-ink-3 text-[13px]">
                        {headline ?? (live ? t("liveHint") : (runError ?? ""))}
                    </SheetDescription>
                </SheetHeader>
                {run && (
                    <div className="px-6 pb-6">
                        <div className="border-line-2 mt-2 border-t">
                            {run.steps.map(step => (
                                <div
                                    key={step.id}
                                    className={cn(
                                        "border-line-2 grid grid-cols-[18px_1fr] items-center gap-2.5 border-b py-2 text-[13.5px]",
                                        step.status === "waiting" && "text-ink-2",
                                        step.status === "skipped" && "text-ink-3"
                                    )}
                                >
                                    <StepIcon status={step.status} />
                                    <span className="min-w-0 truncate">
                                        {say(step.labelCopy, step.label)}
                                        {step.detail && (
                                            <span className="text-ink-3">
                                                {` · ${say(step.detailCopy, step.detail)}`}
                                            </span>
                                        )}
                                    </span>
                                </div>
                            ))}
                        </div>
                        {run.status === "failed" && runError && (
                            <p role="alert" className="text-danger mt-3 text-[13px]">
                                {runError}
                            </p>
                        )}
                        <div className="text-ink-3 mt-3 flex items-center justify-between text-xs tabular-nums">
                            <span>
                                {elapsed ? `${elapsed}` : live ? t("running") : ""}
                                {run.credits > 0
                                    ? ` · ${t("credits", { credits: run.credits })}`
                                    : ""}
                            </span>
                            {!live && run.applicationId && (
                                <Button asChild size="sm" variant="outline" onClick={closeRunSheet}>
                                    <ToolLink href={href(`/write/${run.applicationId}`)}>
                                        {t("openApplication")}
                                    </ToolLink>
                                </Button>
                            )}
                            {!live && !run.applicationId && run.kind === "funders" && (
                                <Button asChild size="sm" variant="outline" onClick={closeRunSheet}>
                                    <ToolLink href={href("/funders")}>{t("seeFunders")}</ToolLink>
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
}
