"use client";

import { ChevronDown } from "lucide-react";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";

import type { SalesStage, StageMove } from "../api";
import { EXIT_STAGES, STAGE_LABELS, stageTone } from "../_lib/stages";

const DOT: Record<ReturnType<typeof stageTone>, string> = {
    quiet: "bg-ink-4",
    info: "bg-info",
    active: "bg-brand",
    won: "bg-success",
    lost: "bg-danger",
};

/** A dot and a word. Stale deals add the number of days in warn, as text. */
export function StagePill({
    stage,
    staleDays,
    className,
}: {
    stage: SalesStage;
    staleDays?: number | null;
    className?: string;
}) {
    return (
        <span
            className={cn("text-ink-2 inline-flex items-center gap-1.5 text-xs", className)}
            data-stage={stage}
        >
            <span className={cn("size-[7px] shrink-0 rounded-full", DOT[stageTone(stage)])} />
            <span className="whitespace-nowrap">{STAGE_LABELS[stage]}</span>
            {staleDays !== null && staleDays !== undefined && staleDays > 0 && (
                <span className="text-warn whitespace-nowrap">· {staleDays} days</span>
            )}
        </span>
    );
}

/**
 * The stage as a control. It lists every stage; the ones the deal cannot
 * move to are disabled with the reason underneath, so the rule is visible
 * where the decision is made instead of in a toast afterwards.
 */
export function StageMenu({
    stage,
    moves,
    onMove,
    disabled,
    size = "sm",
}: {
    stage: SalesStage;
    moves: StageMove[];
    onMove: (stage: SalesStage) => void;
    disabled?: boolean;
    size?: "sm" | "md";
}) {
    const forward = moves.filter(m => !EXIT_STAGES.includes(m.stage));
    const exits = moves.filter(m => EXIT_STAGES.includes(m.stage));
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={disabled}>
                <button
                    type="button"
                    className={cn(
                        "border-line bg-panel hover:bg-panel-2 focus-visible:ring-brand/50 inline-flex items-center gap-1.5 rounded-md border font-medium outline-none transition-colors focus-visible:ring-[3px] disabled:opacity-60",
                        size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3 text-sm"
                    )}
                    aria-label={`Stage: ${STAGE_LABELS[stage]}. Change stage`}
                >
                    <StagePill stage={stage} className="text-ink" />
                    <ChevronDown className="text-ink-3 size-3.5" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-ink-3 text-xs font-normal">
                    Move to
                </DropdownMenuLabel>
                {forward.map(m => (
                    <MoveItem key={m.stage} move={m} current={stage} onMove={onMove} />
                ))}
                {exits.length > 0 && <DropdownMenuSeparator />}
                {exits.map(m => (
                    <MoveItem key={m.stage} move={m} current={stage} onMove={onMove} />
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function MoveItem({
    move,
    current,
    onMove,
}: {
    move: StageMove;
    current: SalesStage;
    onMove: (stage: SalesStage) => void;
}) {
    const isCurrent = move.stage === current;
    const blocked = move.reason !== null;
    return (
        <DropdownMenuItem
            disabled={isCurrent || blocked}
            onSelect={() => onMove(move.stage)}
            className="flex-col items-start gap-0.5 py-1.5"
        >
            <span className="flex w-full items-center justify-between gap-3">
                <StagePill stage={move.stage} className="text-ink" />
                {isCurrent && <span className="text-ink-3 text-[11px]">current</span>}
            </span>
            {blocked && !isCurrent && (
                <span className="text-ink-3 text-[11.5px] leading-snug">{move.reason}</span>
            )}
        </DropdownMenuItem>
    );
}
