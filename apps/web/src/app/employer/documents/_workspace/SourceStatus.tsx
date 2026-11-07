"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Bug, ChevronRight, CircleAlert, LifeBuoy, Loader2, RotateCw } from "lucide-react";

import { useFeedback } from "~/components/feedback/FeedbackProvider";

import { Button } from "~/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Progress } from "~/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { sourceFailureContactHref, useSourceFailureCopy } from "~/lib/source-failure";
import { describeSourceProgress } from "~/lib/source-progress";
import { cn } from "~/lib/utils";

import type { WorkspaceSource } from "./types";

/**
 * A processing source's status under its title: the stage and the percent,
 * with a thin bar across the row — all of it what the worker reported.
 * Without a report yet (a row still being added, a connector syncing) it
 * says so without a number.
 */
export function SourceProgressStatus({ source }: { source: WorkspaceSource }) {
    const t = useTranslations("sources.sourceStatus");
    const tp = useTranslations("sources.progress");
    const failureCopy = useSourceFailureCopy();
    const { percent, label, waiting } = describeSourceProgress(source.processing, tp);
    const tone = waiting ? "text-warn-ink" : "text-brand";

    const line = (
        <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
            <span
                className={cn(
                    "truncate",
                    tone,
                    percent === null &&
                        "animate-[lsw-shimmer_1.6s_ease-in-out_infinite] motion-reduce:animate-none"
                )}
            >
                {label}
            </span>
            {percent !== null && (
                <span className="text-ink-3 ml-auto shrink-0 tabular-nums">{percent}%</span>
            )}
        </div>
    );

    const status = (
        <div
            role="status"
            tabIndex={waiting ? 0 : undefined}
            data-testid={`source-progress-${source.id}`}
            className="mt-px min-w-0 text-[11px]"
        >
            {line}
            {percent !== null && (
                <Progress
                    value={percent}
                    aria-label={t("progressLabel", { label, percent })}
                    className={cn(
                        "mt-1 h-[3px]",
                        waiting
                            ? "bg-warn/20 [&>[data-slot=progress-indicator]]:bg-warn"
                            : "bg-brand/15"
                    )}
                />
            )}
        </div>
    );

    if (!waiting) return status;
    // Waiting out a backoff: say why on hover or focus.
    const reason = failureCopy.describe(waiting.lastError);
    return (
        <Tooltip>
            <TooltipTrigger asChild>{status}</TooltipTrigger>
            <TooltipContent className="max-w-xs">
                {t("waitingReason", {
                    message: reason.message,
                    attempt: waiting.attempt,
                    maxAttempts: waiting.maxAttempts,
                })}
            </TooltipContent>
        </Tooltip>
    );
}

interface SourceFailureStatusProps {
    source: WorkspaceSource;
    /** Runs processing again; absent when the caller may not (view-only, no upload permission). */
    onRetry?: (source: WorkspaceSource) => Promise<void>;
}

/**
 * A failed source's line: what went wrong in a few words, a Retry where
 * running it again could help, and a card with the whole story — the plain
 * sentence, a way to reach support, and the raw error for whoever asks.
 */
export function SourceFailureStatus({ source, onRetry }: SourceFailureStatusProps) {
    const t = useTranslations("sources.sourceStatus");
    const tc = useTranslations("common");
    const failureCopy = useSourceFailureCopy();
    const failure = failureCopy.describe(source.errorMessage);
    const feedback = useFeedback();
    const [retrying, setRetrying] = useState(false);
    const [open, setOpen] = useState(false);
    const retryCount = source.processing?.retryCount ?? 0;
    const jobId = source.processing?.jobId;
    const canRetry = failure.retryable && onRetry !== undefined;
    // Support is the way forward when a retry can't help, or one already didn't.
    const offerContact = !failure.retryable || retryCount > 0;

    /**
     * Where the instance takes reports, the failure goes into one — stored,
     * answered in the Feedback tab — rather than a mail the person has to
     * send. Same ids either way: the document, the category, the job id.
     */
    const reportFailure = () => {
        const text = failureCopy.reportText({
            document: source.title,
            documentId: source.documentId,
            category: failure.category,
            jobId,
        });
        setOpen(false);
        feedback.open({
            kind: "bug",
            title: text.subject,
            body: text.details,
            origin: {
                document: source.title.slice(0, 300),
                problem: failure.category,
                ...(jobId ? { jobId: jobId.slice(0, 300) } : {}),
            },
        });
    };

    const retry = async () => {
        if (!onRetry || retrying) return;
        setRetrying(true);
        try {
            await onRetry(source);
            setOpen(false);
        } finally {
            setRetrying(false);
        }
    };

    const retryIcon = retrying ? (
        <Loader2 className="size-2.5 animate-spin motion-reduce:animate-none" aria-hidden />
    ) : (
        <RotateCw className="size-2.5" aria-hidden />
    );

    return (
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        data-testid={`source-failure-${source.id}`}
                        aria-label={t("failureTrigger", {
                            label: failure.label,
                            title: source.title,
                        })}
                        className="text-danger inline-flex min-w-0 cursor-pointer items-center gap-1 hover:underline"
                        onClick={event => event.stopPropagation()}
                    >
                        <CircleAlert className="size-2.5 shrink-0" aria-hidden />
                        <span className="truncate">{failure.label}</span>
                    </button>
                </PopoverTrigger>
                <PopoverContent
                    align="start"
                    className="w-80 p-3.5"
                    onClick={event => event.stopPropagation()}
                >
                    <div className="text-ink text-[13px] font-semibold">{t("cardTitle")}</div>
                    <p className="text-ink-2 mt-1 text-[12.5px] leading-[1.5]">{failure.message}</p>
                    {retryCount > 0 && (
                        <p className="text-ink-3 mt-1 text-[12px]">
                            {t("failedAgain", { count: retryCount })}
                        </p>
                    )}
                    {(canRetry || offerContact) && (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            {canRetry && (
                                <Button size="sm" onClick={() => void retry()} disabled={retrying}>
                                    {retrying ? (
                                        <Loader2
                                            className="animate-spin motion-reduce:animate-none"
                                            aria-hidden
                                        />
                                    ) : (
                                        <RotateCw aria-hidden />
                                    )}
                                    {tc("actions.retry")}
                                </Button>
                            )}
                            {offerContact && feedback.enabled && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={reportFailure}
                                    data-testid="source-failure-report"
                                >
                                    <Bug aria-hidden />
                                    {t("reportProblem")}
                                </Button>
                            )}
                            {offerContact && !feedback.enabled && (
                                <Button size="sm" variant="outline" asChild>
                                    <Link
                                        href={sourceFailureContactHref({
                                            document: source.title,
                                            documentId: source.documentId,
                                            category: failure.category,
                                            jobId,
                                        })}
                                    >
                                        <LifeBuoy aria-hidden />
                                        {t("contactUs")}
                                    </Link>
                                </Button>
                            )}
                        </div>
                    )}
                    {(failure.detail !== null || jobId !== undefined) && (
                        <Collapsible className="mt-3">
                            <CollapsibleTrigger className="text-ink-3 hover:text-ink-2 group inline-flex cursor-pointer items-center gap-1 text-[11.5px]">
                                <ChevronRight
                                    className="size-3 transition-transform group-data-[state=open]:rotate-90"
                                    aria-hidden
                                />
                                {t("details")}
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                                {jobId && (
                                    <div className="text-ink-3 mt-1.5 text-[11px]">
                                        {t("jobId")}{" "}
                                        <span className="mono text-ink-2 select-all">{jobId}</span>
                                    </div>
                                )}
                                {failure.detail && (
                                    <pre className="mono bg-panel-2 text-ink-2 mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md p-2 text-[10.5px] leading-[1.45]">
                                        {failure.detail}
                                    </pre>
                                )}
                            </CollapsibleContent>
                        </Collapsible>
                    )}
                </PopoverContent>
            </Popover>
            {canRetry && (
                <button
                    type="button"
                    data-testid={`source-retry-${source.id}`}
                    aria-label={t("retryAria", { title: source.title })}
                    disabled={retrying}
                    onClick={event => {
                        event.stopPropagation();
                        void retry();
                    }}
                    className={cn(
                        "text-ink-3 hover:text-brand ml-auto inline-flex shrink-0 cursor-pointer items-center gap-0.5 disabled:cursor-default",
                        retrying && "text-brand"
                    )}
                >
                    {retryIcon}
                    {tc("actions.retry")}
                </button>
            )}
        </span>
    );
}
