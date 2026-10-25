"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { toast } from "sonner";

import { ToolLink } from "~/components/tool-app/ToolLink";

import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { cn } from "~/lib/utils";

import { ProspectsApiError, prospectsApi, type DealRow, type SalesStage } from "../api";
import { useGrowthFormat } from "../../_lib/format";
import { useErrorText } from "~/lib/tools/errorText";
import { useProspects } from "../_lib/context";
import { EXIT_STAGES, FUNNEL_STAGES } from "../_lib/stages";
import { useResource } from "~/lib/tools/useResource";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { FitMeter } from "~/components/tools/FitMeter";
import { PageHeader } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { StageMenu } from "../_components/StagePill";

const BOARD: SalesStage[] = FUNNEL_STAGES.filter(s => s !== "lead");

export function DealsScreen() {
    const t = useTranslations("growth.prospects");
    const { relativeTime, joinList } = useGrowthFormat();
    const ts = useTranslations("growth.server");
    const errorText = useErrorText();
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
                    : errorText(e, t("deals.moveFailed"))
            );
        }
    };

    return (
        <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
            <PageHeader
                size="md"
                title={t("common.deals")}
                sub={
                    res.data ? (
                        <>
                            {t("deals.inMotion", { count: deals.length - leads })} ·{" "}
                            <ToolLink
                                href={href("/companies?view=uncontacted")}
                                className="hover:text-ink"
                            >
                                {t("deals.leadsNotQualified", { count: leads })}
                            </ToolLink>
                            {exits.some(e => e.count > 0) && (
                                <>
                                    {" "}
                                    ·{" "}
                                    {joinList(
                                        exits
                                            .filter(e => e.count > 0)
                                            .map(e =>
                                                e.stage === "lost"
                                                    ? t("deals.exits.lost", { count: e.count })
                                                    : t("deals.exits.nurture", { count: e.count })
                                            )
                                    )}
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
                <EmptyState title={t("deals.empty")} body={t("deals.emptyBody")} />
            ) : (
                <div className="grid auto-cols-[minmax(232px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-3">
                    {BOARD.map(stage => {
                        const items = byStage.get(stage) ?? [];
                        return (
                            <section
                                key={stage}
                                className="bg-surface-2 border-line flex min-h-[300px] flex-col rounded-lg border"
                                aria-label={t(`stages.${stage}`)}
                            >
                                <header className="flex items-center justify-between px-3 py-2">
                                    <span className="text-ink text-xs font-semibold">
                                        {t(`stages.${stage}`)}
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
                                            <ToolLink
                                                href={href(`/companies/${d.companyId}`)}
                                                className="text-ink block truncate font-medium hover:underline"
                                            >
                                                {d.companyName}
                                            </ToolLink>
                                            <div className="text-ink-3 mt-1 truncate text-xs">
                                                {d.nextStep ??
                                                    (d.staleDays && d.staleDays > 0
                                                        ? t("deals.noActivity", {
                                                              count: d.staleDays,
                                                          })
                                                        : t("deals.lastActivity", {
                                                              when: relativeTime(
                                                                  d.lastActivityAt ??
                                                                      d.stageChangedAt
                                                              ),
                                                          }))}
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
                                                            title={
                                                                d.ownerIsViewer
                                                                    ? ts("you")
                                                                    : (d.ownerName ?? undefined)
                                                            }
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
                                            {t("deals.emptyColumn")}
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
