"use client";

import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { cn } from "~/lib/utils";

import type { DealRow, SalesStage } from "../api";
import { relativeTime } from "~/lib/tools/format";
import { FUNNEL_STAGES, STAGE_LABELS } from "../_lib/stages";
import { FitMeter } from "~/components/tools/FitMeter";
import { StageMenu } from "./StagePill";

/** Leads stay in the Companies view; the board is what is in motion. */
export const BOARD_STAGES: SalesStage[] = FUNNEL_STAGES.filter(s => s !== "lead");

export function DealsBoard({
    deals,
    onMove,
    onOpen,
}: {
    deals: DealRow[];
    onMove: (deal: DealRow, stage: SalesStage) => void;
    onOpen: (companyId: string) => void;
}) {
    const byStage = new Map<SalesStage, DealRow[]>();
    for (const d of deals) byStage.set(d.stage, [...(byStage.get(d.stage) ?? []), d]);
    return (
        <div className="grid auto-cols-[minmax(232px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-3">
            {BOARD_STAGES.map(stage => {
                const items = byStage.get(stage) ?? [];
                return (
                    <section
                        key={stage}
                        className="bg-surface-2 border-line flex min-h-[300px] flex-col rounded-lg border"
                        aria-label={STAGE_LABELS[stage]}
                    >
                        <header className="flex items-center justify-between px-3 py-2">
                            <span className="text-ink text-xs font-semibold">
                                {STAGE_LABELS[stage]}
                            </span>
                            <span className="text-ink-3 font-mono text-[11px] tabular-nums">
                                {items.length}
                            </span>
                        </header>
                        <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
                            {items.map(d => (
                                <article
                                    key={d.id}
                                    className={cn(
                                        "bg-panel border-line hover:border-ink-4 rounded-md border p-2.5 text-[13px] transition-colors",
                                        d.staleDays && d.staleDays > 0 && "border-l-warn border-l-2"
                                    )}
                                >
                                    <button
                                        type="button"
                                        onClick={() => onOpen(d.companyId)}
                                        className="text-ink focus-visible:ring-brand/50 block max-w-full truncate rounded-sm text-left font-medium outline-none hover:underline focus-visible:ring-2"
                                    >
                                        {d.companyName}
                                    </button>
                                    <div className="text-ink-3 mt-1 truncate text-xs">
                                        {d.nextStep ??
                                            (d.staleDays && d.staleDays > 0
                                                ? `No activity for ${d.staleDays} days`
                                                : `Last activity ${relativeTime(d.lastActivityAt ?? d.stageChangedAt)}`)}
                                    </div>
                                    <div className="mt-2 flex items-center justify-between gap-2">
                                        <FitMeter value={d.fit} threshold={d.fitThreshold} />
                                        <span className="flex items-center gap-1.5">
                                            {d.ownerInitials && (
                                                <Avatar
                                                    className="size-5"
                                                    title={d.ownerName ?? undefined}
                                                >
                                                    <AvatarFallback className="text-[9px]">
                                                        {d.ownerInitials}
                                                    </AvatarFallback>
                                                </Avatar>
                                            )}
                                            <StageMenu
                                                stage={d.stage}
                                                moves={d.allowedMoves}
                                                onMove={s => onMove(d, s)}
                                            />
                                        </span>
                                    </div>
                                </article>
                            ))}
                            {items.length === 0 && (
                                <p className="text-ink-4 px-1 py-6 text-center text-xs">Empty</p>
                            )}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}
