"use client";

import { Check, CircleDashed, Loader2, X } from "lucide-react";

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

import { duration } from "~/lib/tools/format";
import { runIsLive, useProposals } from "../_lib/context";
import { RUN_KIND_LABEL, type RunStepDto } from "../api";

function StepIcon({ status }: { status: RunStepDto["status"] }) {
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

const DONE_TITLE: Record<string, string> = {
    profile: "Profile built",
    funders: "Funders found",
    extract: "Requirements read",
    draft: "Drafts written",
    review: "Review done",
};

/**
 * A run is visible work: one row per step as it finishes. Closing the sheet
 * leaves the run going; the bar keeps its indicator until it is done.
 */
export function ProposalRunSheet() {
    const { activeRun, runSheetOpen, closeRunSheet, href } = useProposals();
    const run = activeRun;
    const live = runIsLive(run);
    const elapsed = run?.completedAt
        ? duration(new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime())
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
                            ? "No run"
                            : run.status === "completed"
                              ? (DONE_TITLE[run.kind] ?? "Done")
                              : run.status === "failed"
                                ? "The run failed"
                                : RUN_KIND_LABEL[run.kind]}
                    </SheetTitle>
                    <SheetDescription className="text-ink-3 text-[13px]">
                        {run?.headline ??
                            (live
                                ? "Steps tick as they finish; you can close this and keep working."
                                : (run?.error ?? ""))}
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
                                        {step.label}
                                        {step.detail && (
                                            <span className="text-ink-3"> · {step.detail}</span>
                                        )}
                                    </span>
                                </div>
                            ))}
                        </div>
                        {run.status === "failed" && run.error && (
                            <p role="alert" className="text-danger mt-3 text-[13px]">
                                {run.error}
                            </p>
                        )}
                        <div className="text-ink-3 mt-3 flex items-center justify-between text-xs tabular-nums">
                            <span>
                                {elapsed ? `${elapsed}` : live ? "running" : ""}
                                {run.credits > 0
                                    ? ` · ${run.credits.toLocaleString()} credits`
                                    : ""}
                            </span>
                            {!live && run.applicationId && (
                                <Button asChild size="sm" variant="outline" onClick={closeRunSheet}>
                                    <ToolLink href={href(`/write/${run.applicationId}`)}>
                                        Open the application
                                    </ToolLink>
                                </Button>
                            )}
                            {!live && !run.applicationId && run.kind === "funders" && (
                                <Button asChild size="sm" variant="outline" onClick={closeRunSheet}>
                                    <ToolLink href={href("/funders")}>See funders</ToolLink>
                                </Button>
                            )}
                            {!live && !run.applicationId && run.kind === "profile" && (
                                <Button asChild size="sm" variant="outline" onClick={closeRunSheet}>
                                    <ToolLink href={href("/profile")}>See the profile</ToolLink>
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
}
