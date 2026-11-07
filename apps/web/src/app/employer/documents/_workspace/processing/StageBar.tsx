"use client";

/**
 * One file's trip through processing, as a bar of six segments — Added,
 * Waiting, Reading, Splitting, Indexing, Ready. A finished stage is filled,
 * the running one fills as far as it knows (Indexing counts sections; a
 * stage that can't count sweeps), a failed one turns red, a retrying one
 * amber. The whole bar is one progressbar for assistive tech; each segment's
 * tooltip says what the stage does and how long it took.
 */

import { useTranslations } from "next-intl";

import {
    QUEUE_STAGE_IDS,
    type QueueItemState,
    type QueueStage,
} from "~/lib/processing-queue/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import { formatDuration, type ProcessingTranslator } from "./viewModel";

function stageShare(stage: QueueStage): number | null {
    if (!stage.total || stage.total <= 0 || stage.done === undefined) return null;
    return Math.max(0, Math.min(1, stage.done / stage.total));
}

function stageTiming(stage: QueueStage, now: number, t: ProcessingTranslator): string | null {
    if (!stage.startedAt) return null;
    const start = Date.parse(stage.startedAt);
    if (!Number.isFinite(start)) return null;
    if (stage.endedAt) {
        return t("stageTiming.took", {
            duration: formatDuration(Date.parse(stage.endedAt) - start, t),
        });
    }
    if (stage.status === "active") {
        return t("stageTiming.soFar", { duration: formatDuration(now - start, t) });
    }
    return null;
}

export function StageBar({
    stages,
    state,
    name,
    headline,
    now,
    compact = false,
}: {
    stages: QueueStage[];
    state: QueueItemState;
    /** The file's name, for the progressbar's label. */
    name: string;
    /** What is happening now, for the progressbar's value text. */
    headline: string;
    now: number;
    /** No captions under the segments (a narrow tab shows the headline only). */
    compact?: boolean;
}) {
    const t = useTranslations("processing");
    const ordered = QUEUE_STAGE_IDS.map(
        id =>
            stages.find(stage => stage.id === id) ?? {
                id,
                status: "pending" as const,
                startedAt: null,
                endedAt: null,
            }
    );
    const doneCount = ordered.filter(stage => stage.status === "done").length;
    const current = ordered.findIndex(
        stage => stage.status === "active" || stage.status === "failed"
    );

    return (
        <div
            role="progressbar"
            aria-label={t("progressbar.label", { name })}
            aria-valuemin={0}
            aria-valuemax={ordered.length}
            aria-valuenow={doneCount}
            aria-valuetext={t("progressbar.value", {
                headline,
                step: Math.min((current >= 0 ? current : doneCount) + 1, ordered.length),
                total: ordered.length,
            })}
            data-testid="stage-bar"
            data-state={state}
        >
            <div className="grid grid-cols-6 gap-1">
                {ordered.map(stage => {
                    const share = stageShare(stage);
                    const retrying = state === "retrying" && stage.status === "active";
                    const timing = stageTiming(stage, now, t);
                    return (
                        <Tooltip key={stage.id}>
                            <TooltipTrigger asChild>
                                <span
                                    data-stage={stage.id}
                                    data-status={stage.status}
                                    className={cn(
                                        "relative block h-1.5 overflow-hidden rounded-full",
                                        stage.status === "done" && "bg-brand",
                                        stage.status === "failed" && "bg-danger",
                                        stage.status === "pending" && "bg-line",
                                        stage.status === "active" &&
                                            (retrying ? "bg-warn-soft" : "bg-brand-soft")
                                    )}
                                >
                                    {stage.status === "active" &&
                                        (share !== null ? (
                                            <span
                                                className={cn(
                                                    "absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out",
                                                    retrying ? "bg-warn" : "bg-brand"
                                                )}
                                                style={{ width: `${Math.max(share * 100, 6)}%` }}
                                            />
                                        ) : (
                                            <span
                                                className={cn(
                                                    "absolute inset-y-0 left-0 w-2/5 rounded-full",
                                                    retrying ? "bg-warn" : "bg-brand"
                                                )}
                                                style={{
                                                    animation: retrying
                                                        ? undefined
                                                        : "lsw-sweep 1.4s ease-in-out infinite",
                                                }}
                                            />
                                        ))}
                                </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[240px]">
                                <span className="block font-semibold">
                                    {t(`stages.${stage.id}.label`)}
                                </span>
                                {t(`stages.${stage.id}.about`)}
                                {timing ? <span className="block opacity-80">{timing}</span> : null}
                            </TooltipContent>
                        </Tooltip>
                    );
                })}
            </div>
            {/* Under 520px of tab the six names no longer fit their
                segments; the row's headline already says which stage it is.
                The wrapper carries no display class of its own (see
                ToolFrame on why `grid …:hidden` on one element never hides). */}
            {!compact && (
                <div className="@max-sm:hidden" aria-hidden>
                    <div className="mt-1.5 grid grid-cols-6 gap-1">
                        {ordered.map(stage => (
                            <span
                                key={stage.id}
                                className={cn(
                                    "truncate text-[10.5px] leading-none",
                                    stage.status === "active" && "text-ink font-medium",
                                    stage.status === "failed" && "text-danger font-medium",
                                    stage.status === "done" && "text-ink-2",
                                    stage.status === "pending" && "text-ink-4"
                                )}
                            >
                                {t(`stages.${stage.id}.label`)}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
