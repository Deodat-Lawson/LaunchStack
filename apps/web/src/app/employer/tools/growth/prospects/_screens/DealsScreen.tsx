"use client";

import Link from "next/link";
import { useMemo } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { cn } from "~/lib/utils";

import { ProspectsApiError, prospectsApi, type DealRow, type SalesStage } from "../api";
import { useProspects } from "../_lib/context";
import { relativeTime } from "../../_lib/format";
import { EXIT_STAGES, FUNNEL_STAGES, STAGE_LABELS } from "../_lib/stages";
import { useResource } from "../../_lib/useResource";
import { EmptyState, InlineError } from "../../_components/EmptyState";
import { FitMeter } from "../_components/FitMeter";
import { PageHeader } from "../../_components/PageHeader";
import { SkeletonRows } from "../../_components/SkeletonRows";
import { StageMenu } from "../_components/StagePill";

const BOARD: SalesStage[] = FUNNEL_STAGES.filter(s => s !== "lead");

export function DealsScreen() {
    const { segmentId, href } = useProspects();
    const res = useResource(segmentId ? `deals:${segmentId}` : null, () =>
        prospectsApi.deals(segmentId!)
    );
    const deals = useMemo(() => res.data?.deals ?? [], [res.data]);
    const byStage = useMemo(() => {
        const map = new Map<SalesStage, DealRow[]>();
        for (const d of deals) map.set(d.stage, [...(map.get(d.stage) ?? []), d]);
        return map;
    }, [deals]);
    const leads = byStage.get("lead")?.length ?? 0;
    const exits = EXIT_STAGES.map(s => ({ stage: s, count: byStage.get(s)?.length ?? 0 }));

    const move = async (deal: DealRow, stage: SalesStage) => {
        try {
            const { deal: updated } = await prospectsApi.patchDeal(deal.id, { stage });
            res.mutate(current => ({
                deals: current.deals.map(d => (d.id === deal.id ? { ...d, ...updated } : d)),
            }));
        } catch (e) {
            toast.error(
                e instanceof ProspectsApiError &&
                    e.body &&
                    typeof e.body === "object" &&
                    "reason" in e.body
                    ? String((e.body as { reason: unknown }).reason)
                    : e instanceof Error
                      ? e.message
                      : "Could not move the deal"
            );
        }
    };

    return (
        <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
            <PageHeader
                size="md"
                title="Deals"
                sub={
                    res.data ? (
                        <>
                            {deals.length - leads} in motion ·{" "}
                            <Link
                                href={href("/companies?view=uncontacted")}
                                className="hover:text-ink"
                            >
                                {leads} leads not yet qualified
                            </Link>
                            {exits.some(e => e.count > 0) && (
                                <>
                                    {" "}
                                    ·{" "}
                                    {exits
                                        .filter(e => e.count > 0)
                                        .map(
                                            e => `${e.count} ${STAGE_LABELS[e.stage].toLowerCase()}`
                                        )
                                        .join(", ")}
                                </>
                            )}
                        </>
                    ) : undefined
                }
            />
            {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}
            {res.loading ? (
                <SkeletonRows rows={6} height={64} />
            ) : deals.length - leads === 0 ? (
                <EmptyState
                    title="No deals in motion"
                    body="Qualify a company from the Companies list, or move one here from its page. Leads stay in Companies until you do."
                />
            ) : (
                <div className="grid auto-cols-[minmax(232px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-3">
                    {BOARD.map(stage => {
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
                                                d.staleDays &&
                                                    d.staleDays > 0 &&
                                                    "border-l-warn border-l-2"
                                            )}
                                        >
                                            <Link
                                                href={href(`/companies/${d.companyId}`)}
                                                className="text-ink block truncate font-medium hover:underline"
                                            >
                                                {d.companyName}
                                            </Link>
                                            <div className="text-ink-3 mt-1 truncate text-xs">
                                                {d.nextStep ??
                                                    (d.staleDays && d.staleDays > 0
                                                        ? `No activity for ${d.staleDays} days`
                                                        : `Last activity ${relativeTime(d.lastActivityAt ?? d.stageChangedAt)}`)}
                                            </div>
                                            <div className="mt-2 flex items-center justify-between gap-2">
                                                <FitMeter
                                                    value={d.fit}
                                                    threshold={d.fitThreshold}
                                                />
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
                                                        onMove={s => void move(d, s)}
                                                    />
                                                </span>
                                            </div>
                                        </article>
                                    ))}
                                    {items.length === 0 && (
                                        <p className="text-ink-4 px-1 py-6 text-center text-xs">
                                            Empty
                                        </p>
                                    )}
                                </div>
                            </section>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
