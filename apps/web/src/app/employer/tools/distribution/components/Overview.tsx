"use client";

import { AlertTriangle, CalendarClock, Grid3x3, Layers } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Card } from "~/components/ui/card";
import { cn } from "~/lib/utils";

import {
    KIND_LABELS,
    STAGE_LABELS,
    daysAgo,
    type CoverageCellDto,
    type RelationshipStage,
} from "../api";
import type { DistributionState } from "../useDistribution";
import { FitBadge, StageBadge } from "./badges";

function Tile({
    title,
    value,
    detail,
    icon: Icon,
    tone,
}: {
    title: string;
    value: string;
    detail: string;
    icon: typeof Layers;
    tone?: "warn" | "ok";
}) {
    return (
        <Card
            className={cn(
                "bg-panel flex flex-col gap-1 border-none p-4 shadow-sm",
                tone === "warn" && "ring-warn/40 ring-1"
            )}
        >
            <div className="flex items-center justify-between">
                <span className="text-ink-3 text-[10px] font-bold uppercase tracking-widest">
                    {title}
                </span>
                <Icon
                    className={cn(
                        "h-4 w-4",
                        tone === "warn"
                            ? "text-warn"
                            : tone === "ok"
                              ? "text-success"
                              : "text-brand-ink"
                    )}
                />
            </div>
            <div className="text-ink text-2xl font-black tabular-nums">{value}</div>
            <div className="text-ink-2 text-xs">{detail}</div>
        </Card>
    );
}

const FUNNEL: RelationshipStage[] = [
    "candidate",
    "contacted",
    "in_conversation",
    "qualified",
    "negotiating",
    "contracted",
    "active",
];

export function Overview({ state }: { state: DistributionState }) {
    const d = state.dashboard;
    if (!d)
        return (
            <p className="text-ink-2 text-sm">
                {state.loading.dashboard
                    ? "Loading…"
                    : "No data yet. Start a discovery run from the Runs tab."}
            </p>
        );
    const max = Math.max(1, ...d.funnel.map(f => f.count));
    const countries = [...new Set(d.coverage.map(c => c.country))];
    const kinds = [...new Set(d.coverage.map(c => c.kind))];
    const cell = (country: string, kind: string): CoverageCellDto | undefined =>
        d.coverage.find(c => c.country === country && c.kind === kind);

    return (
        <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Tile
                    title="Coverage"
                    value={`${d.coveredCells} / ${d.targetedCells}`}
                    detail="territory × kind cells with a contracted or active partner"
                    icon={Grid3x3}
                    tone={
                        d.targetedCells > 0 && d.coveredCells === d.targetedCells ? "ok" : undefined
                    }
                />
                <Tile
                    title="In pipeline"
                    value={String(d.inPipeline)}
                    detail="contacted through negotiating"
                    icon={Layers}
                />
                <Tile
                    title="Stale"
                    value={String(d.stale)}
                    detail="no activity past the stage's threshold"
                    icon={AlertTriangle}
                    tone={d.stale > 0 ? "warn" : undefined}
                />
                <Tile
                    title="Due this week"
                    value={String(d.dueThisWeek + d.renewalsDue)}
                    detail={`${d.dueThisWeek} next actions, ${d.renewalsDue} renewal${d.renewalsDue === 1 ? "" : "s"}`}
                    icon={CalendarClock}
                />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card className="bg-panel border-none p-4 shadow-sm">
                    <h2 className="text-ink mb-3 text-xs font-bold uppercase tracking-widest">
                        Funnel
                    </h2>
                    <div className="grid grid-cols-[130px_1fr_40px] items-center gap-x-3 gap-y-2 text-sm">
                        {FUNNEL.map(stage => {
                            const count = d.funnel.find(f => f.stage === stage)?.count ?? 0;
                            const median = d.medianDaysInStage[stage];
                            return (
                                <div key={stage} className="contents">
                                    <span className="text-ink-2 truncate">
                                        {STAGE_LABELS[stage]}
                                        {median !== undefined && (
                                            <span className="text-ink-3 ml-1 text-[11px]">
                                                · {median}d
                                            </span>
                                        )}
                                    </span>
                                    <div className="bg-panel-2 relative h-2.5 rounded-sm">
                                        <div
                                            className="bg-brand absolute inset-y-0 left-0 rounded-sm"
                                            style={{ width: `${Math.round((count / max) * 100)}%` }}
                                        />
                                    </div>
                                    <span className="text-ink text-right font-mono text-xs tabular-nums">
                                        {count}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                    <p className="text-ink-3 mt-3 text-[11px]">
                        Cumulative: a partner at &ldquo;qualified&rdquo; also counts in every
                        earlier stage. Median days per stage come from the timeline.
                    </p>
                </Card>

                <Card className="bg-panel border-none p-4 shadow-sm">
                    <h2 className="text-ink mb-3 text-xs font-bold uppercase tracking-widest">
                        Coverage · territory × partner kind
                    </h2>
                    {countries.length === 0 ? (
                        <p className="text-ink-2 text-sm">
                            Add territories and partner kinds to the program to see coverage.
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr>
                                        <th className="text-ink-3 p-1 text-left font-medium"></th>
                                        {kinds.map(k => (
                                            <th
                                                key={k}
                                                className="text-ink-3 p-1 text-center font-medium uppercase tracking-wide"
                                            >
                                                {KIND_LABELS[k]}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {countries.map(country => (
                                        <tr key={country}>
                                            <td className="text-ink-2 p-1 font-mono">{country}</td>
                                            {kinds.map(kind => {
                                                const c = cell(country, kind);
                                                const tone = !c?.targeted
                                                    ? "bg-panel-2 text-ink-3"
                                                    : c.covered > 0
                                                      ? "bg-success-soft text-success"
                                                      : c.inPipeline > 0
                                                        ? "bg-brand-soft text-brand-ink"
                                                        : "bg-warn-soft text-warn";
                                                const label = !c
                                                    ? "–"
                                                    : c.covered > 0
                                                      ? `${c.covered} ✓`
                                                      : c.inPipeline > 0
                                                        ? `${c.inPipeline} in play`
                                                        : c.candidates > 0
                                                          ? `${c.candidates} cand.`
                                                          : c.targeted
                                                            ? "gap"
                                                            : "–";
                                                return (
                                                    <td key={kind} className="p-1">
                                                        <div
                                                            className={cn(
                                                                "rounded-sm px-2 py-1.5 text-center font-mono tabular-nums",
                                                                tone
                                                            )}
                                                            title={
                                                                c
                                                                    ? `covered ${c.covered} · in pipeline ${c.inPipeline} · candidates ${c.candidates}`
                                                                    : undefined
                                                            }
                                                        >
                                                            {label}
                                                        </div>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>
            </div>

            <Card className="bg-panel border-none p-4 shadow-sm">
                <h2 className="text-ink mb-3 text-xs font-bold uppercase tracking-widest">
                    Partners needing attention
                </h2>
                {d.attention.length === 0 ? (
                    <p className="text-ink-2 text-sm">Nothing is stale or due. Good.</p>
                ) : (
                    <ul className="divide-line divide-y">
                        {d.attention.map(item => (
                            <li key={item.relationship.id}>
                                <button
                                    className="hover:bg-panel-2 flex w-full flex-wrap items-center gap-3 px-1 py-2 text-left text-sm"
                                    onClick={() => void state.openPartner(item.relationship.id)}
                                >
                                    <span className="text-ink min-w-[180px] font-medium">
                                        {item.org.name}
                                    </span>
                                    <Badge variant="secondary">
                                        {KIND_LABELS[item.relationship.kind]}
                                    </Badge>
                                    <StageBadge stage={item.relationship.stage} />
                                    <FitBadge score={item.relationship.fitScore} />
                                    {item.stale && (
                                        <Badge variant="warn">
                                            stale ·{" "}
                                            {daysAgo(
                                                item.relationship.lastActivityAt ??
                                                    item.relationship.stageChangedAt
                                            )}
                                        </Badge>
                                    )}
                                    {item.relationship.nextAction && (
                                        <span className="text-ink-2 truncate">
                                            {item.relationship.nextAction}
                                            {item.relationship.nextActionAt
                                                ? ` · due ${new Date(item.relationship.nextActionAt).toLocaleDateString()}`
                                                : ""}
                                        </span>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
        </div>
    );
}
