"use client";

import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

import { KIND_LABELS, STAGE_LABELS, daysAgo, type RelationshipStage } from "../api";
import type { DistributionState } from "../useDistribution";
import { FitBadge } from "./badges";

const COLUMNS: RelationshipStage[] = [
    "researched",
    "contacted",
    "in_conversation",
    "qualified",
    "negotiating",
    "contracted",
    "active",
];

export function PipelineBoard({ state }: { state: DistributionState }) {
    const byStage = new Map<RelationshipStage, typeof state.partners>();
    for (const item of state.partners) {
        const list = byStage.get(item.relationship.stage) ?? [];
        list.push(item);
        byStage.set(item.relationship.stage, list);
    }
    const candidates = byStage.get("candidate")?.length ?? 0;
    return (
        <div className="flex flex-col gap-3">
            <p className="text-ink-2 text-xs">
                {candidates} candidate{candidates === 1 ? "" : "s"} not yet researched are in the
                Partners tab. Click a card to open it and move it; moves are checked against the
                stage rules.
            </p>
            <div className="grid auto-cols-[minmax(230px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
                {COLUMNS.map(stage => {
                    const items = byStage.get(stage) ?? [];
                    return (
                        <section
                            key={stage}
                            className="border-line bg-panel flex min-h-[320px] flex-col rounded-xl border"
                        >
                            <header className="border-line flex items-center justify-between border-b px-3 py-2">
                                <span className="text-ink text-xs font-bold uppercase tracking-widest">
                                    {STAGE_LABELS[stage]}
                                </span>
                                <span className="text-ink-3 font-mono text-xs">{items.length}</span>
                            </header>
                            <div className="flex flex-1 flex-col gap-2 p-2">
                                {items.map(item => (
                                    <button
                                        key={item.relationship.id}
                                        onClick={() => void state.openPartner(item.relationship.id)}
                                        className={cn(
                                            "border-line bg-bg hover:border-brand flex flex-col gap-1 rounded-lg border p-2.5 text-left text-sm transition",
                                            item.stale && "border-warn/60"
                                        )}
                                    >
                                        <div className="text-ink truncate font-medium">
                                            {item.org.name}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <Badge variant="secondary">
                                                {KIND_LABELS[item.relationship.kind]}
                                            </Badge>
                                            <FitBadge score={item.relationship.fitScore} />
                                            {item.relationship.territory && (
                                                <span className="text-ink-3 font-mono text-[11px]">
                                                    {item.relationship.territory.country}
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-ink-2 truncate text-[11px]">
                                            {item.relationship.nextAction ??
                                                `last activity ${daysAgo(item.relationship.lastActivityAt ?? item.relationship.stageChangedAt)}`}
                                        </div>
                                    </button>
                                ))}
                                {items.length === 0 && (
                                    <p className="text-ink-3 px-1 py-4 text-center text-xs">—</p>
                                )}
                            </div>
                        </section>
                    );
                })}
            </div>
        </div>
    );
}
