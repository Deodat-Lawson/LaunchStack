"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";

import { ToolLink } from "~/components/tool-app/ToolLink";

import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

import { prospectsApi, type SourceYield, type TodoItem } from "../api";
import { useCopyText } from "~/lib/tools/copyText";
import { useSegmentText } from "../../_lib/copy";
import { useGrowthFormat } from "../../_lib/format";
import { useErrorText } from "~/lib/tools/errorText";
import { useProspects } from "../_lib/context";
import { SegmentSetup } from "../_components/SegmentSetup";
import { useResource } from "~/lib/tools/useResource";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { FitMeter } from "~/components/tools/FitMeter";
import { FunnelBar } from "../_components/FunnelBar";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";

function YieldRow({ y, max }: { y: SourceYield; max: number }) {
    const t = useTranslations("growth.prospects");
    const word = useCopyText();
    const off = y.status === "off" || y.status === "skipped";
    const found = y.kind === "signal" ? t("common.signals", { count: y.found }) : String(y.found);
    return (
        <div className="border-line-2 grid grid-cols-[minmax(120px,150px)_1fr_64px_56px] items-center gap-3 border-t px-4 py-2 text-[13px] first:border-t-0">
            <span className={cn("truncate", off ? "text-ink-3" : "text-ink")}>
                {word(y.labelCopy, y.label)}
            </span>
            <span className="bg-line-2 relative h-2 overflow-hidden rounded-full" aria-hidden>
                {!off && (
                    <>
                        <span
                            className="bg-ink-3 absolute inset-y-0 left-0 rounded-full"
                            style={{ width: `${max ? (y.found / max) * 100 : 0}%` }}
                        />
                        <span
                            className="bg-brand absolute inset-y-0 left-0 rounded-full"
                            style={{ width: `${max && y.inDeals ? (y.inDeals / max) * 100 : 0}%` }}
                        />
                    </>
                )}
            </span>
            <span className="text-ink-2 text-right tabular-nums">
                {off ? (
                    <span className="text-ink-3 text-xs">
                        {y.detail ? word(y.detailCopy, y.detail) : t("home.off")}
                    </span>
                ) : (
                    found
                )}
            </span>
            <span className="text-ink-2 text-right tabular-nums">
                {off || y.kind === "signal" ? "" : (y.inDeals ?? "—")}
            </span>
        </div>
    );
}

export function HomeScreen() {
    const t = useTranslations("growth.prospects");
    const tg = useTranslations("growth.common.counts");
    const { relativeTime } = useGrowthFormat();
    const word = useCopyText();
    const segmentText = useSegmentText();
    const errorText = useErrorText();
    const { segmentId, href, startRun, activeRun, segments, segmentsLoading } = useProspects();
    const home = useResource(segmentId ? `home:${segmentId}` : null, () =>
        prospectsApi.home(segmentId!)
    );
    const finished = activeRun?.status === "completed";
    const reload = home.reload;
    useEffect(() => {
        if (finished) void reload();
    }, [finished, reload]);

    const d = home.data;
    const find = async () => {
        try {
            await startRun();
        } catch (e) {
            toast.error(errorText(e, t("common.startFailed")));
        }
    };

    const headline = d ? segmentText(d.segment).headline : "";
    const maxFound = d ? Math.max(1, ...d.yield.map(y => y.found)) : 1;

    // No segment yet: ask who you sell to, on the page, instead of a disabled
    // button and a popover to find.
    if (!segmentsLoading && segments.length === 0) return <SegmentSetup />;

    return (
        <div className="mx-auto flex max-w-[1080px] flex-col gap-7">
            <PageHeader
                title={d ? t("home.title", { headline }) : t("home.loadingTitle")}
                accent={d ? t("home.accent") : undefined}
                sub={
                    d ? (
                        d.lastRunAt ? (
                            t("home.subWithRun", {
                                companies: d.segment.counts.companies,
                                deals: d.segment.counts.deals,
                                when: relativeTime(d.lastRunAt),
                                sources: d.segment.counts.sources,
                            })
                        ) : (
                            t("home.subNoRun", {
                                companies: d.segment.counts.companies,
                                deals: d.segment.counts.deals,
                            })
                        )
                    ) : (
                        <Skeleton className="h-3 w-64" />
                    )
                }
                actions={
                    <>
                        <Button variant="ghost" size="sm" asChild>
                            <ToolLink href={href("/segment")}>{t("common.segment")}</ToolLink>
                        </Button>
                        <Button size="sm" onClick={() => void find()} disabled={!segmentId}>
                            {t("common.findCompanies")}
                        </Button>
                    </>
                }
            />

            {home.error && <InlineError message={home.error} onRetry={() => void home.reload()} />}

            <section>
                <SectionHeading
                    title={t("home.todo")}
                    aside={d ? tg("items", { count: d.todo.length }) : undefined}
                />
                {home.loading ? (
                    <SkeletonRows rows={3} height={56} />
                ) : d && d.todo.length === 0 ? (
                    d.lastRunAt ? (
                        <EmptyState
                            title={t("home.nothingWaiting")}
                            body={t("home.nothingWaitingBody")}
                        />
                    ) : (
                        <EmptyState
                            mark
                            title={t("home.firstTitle")}
                            body={t("home.firstBody", { count: d.segment.counts.sources })}
                            action={
                                <Button size="sm" onClick={() => void find()}>
                                    {t("common.findCompanies")}
                                </Button>
                            }
                        />
                    )
                ) : (
                    <div className="border-line bg-panel overflow-hidden rounded-lg border">
                        {d?.todo.map(item => (
                            <div
                                key={item.id}
                                className="border-line-2 flex items-center gap-4 border-t px-4 py-3 first:border-t-0"
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="text-ink text-sm font-medium">
                                        {todoText(t, item).title}
                                    </div>
                                    <div className="text-ink-3 truncate text-xs">
                                        {todoText(t, item).detail}
                                    </div>
                                </div>
                                <Button variant="outline" size="sm" asChild>
                                    <ToolLink href={href(item.action.href)}>
                                        {todoText(t, item).action}
                                    </ToolLink>
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section>
                <SectionHeading
                    title={t("common.deals")}
                    aside={
                        d?.medianDays
                            ? t("home.median", {
                                  days: d.medianDays.days,
                                  from: t(`stages.${d.medianDays.from}`),
                                  to: t(`stages.${d.medianDays.to}`),
                              })
                            : undefined
                    }
                />
                {home.loading || !d ? (
                    <Skeleton className="h-8 w-full" />
                ) : (
                    <FunnelBar counts={d.funnel} hrefFor={() => href("/deals")} />
                )}
            </section>

            <div className="grid grid-cols-2 gap-7 @max-lg:grid-cols-1">
                <section className="min-w-0">
                    <SectionHeading title={t("home.whereFrom")} aside={t("home.whereFromAside")} />
                    {home.loading || !d ? (
                        <SkeletonRows rows={6} height={38} />
                    ) : d.yield.length === 0 ? (
                        <EmptyState title={t("home.noSources")} body={t("home.noSourcesBody")} />
                    ) : (
                        <div className="border-line bg-panel overflow-hidden rounded-lg border">
                            {d.yield.map(y => (
                                <YieldRow key={y.sourceId} y={y} max={maxFound} />
                            ))}
                        </div>
                    )}
                </section>
                <section className="min-w-0">
                    <SectionHeading
                        title={t("home.fresh")}
                        aside={d?.lastRunAt ? t("home.fromLastRun") : undefined}
                    />
                    {home.loading || !d ? (
                        <SkeletonRows rows={4} height={56} />
                    ) : d.fresh.length === 0 ? (
                        <EmptyState title={t("home.nothingNew")} body={t("home.nothingNewBody")} />
                    ) : (
                        <div className="border-line bg-panel overflow-hidden rounded-lg border">
                            {d.fresh.map(c => (
                                <ToolLink
                                    key={c.id}
                                    href={href(`/companies/${c.id}`)}
                                    className="border-line-2 hover:bg-panel-2 focus-visible:bg-panel-2 grid grid-cols-[1fr_auto] items-center gap-4 border-t px-4 py-2.5 outline-none first:border-t-0"
                                >
                                    <span className="min-w-0">
                                        <span className="text-ink block truncate text-sm font-medium">
                                            {c.name}
                                        </span>
                                        <span className="text-ink-2 block truncate text-xs">
                                            {word(c.whyCopy, c.why)}
                                        </span>
                                    </span>
                                    <FitMeter value={c.fit} threshold={c.fitThreshold} />
                                </ToolLink>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}

type ProspectsTranslator = ReturnType<typeof useTranslations<"growth.prospects">>;

/** A to-do item in the reader's language; the server's English when it sent no copy. */
function todoText(
    t: ProspectsTranslator,
    item: TodoItem
): { title: string; detail: string; action: string } {
    const copy = item.copy;
    if (!copy) return { title: item.title, detail: item.detail, action: item.action.label };
    switch (copy.key) {
        case "review":
            return {
                title: t("home.todoItems.review.title", {
                    count: copy.count,
                    highFit: String(copy.highFit),
                }),
                // The companies' own names.
                detail: item.detail,
                action: t("home.todoItems.review.action"),
            };
        case "due":
            return {
                title: t("home.todoItems.due.title", { count: copy.steps.length }),
                detail: copy.steps
                    .map(step =>
                        t("home.todoItems.due.step", {
                            name: step.name,
                            action: step.nextAction ?? t("home.todoItems.due.followUp"),
                        })
                    )
                    .join(" · "),
                action: t("home.todoItems.due.action"),
            };
        case "stale":
            return {
                title: t("home.todoItems.stale.title", { count: copy.deals.length }),
                detail: copy.deals.map(deal => t("home.todoItems.stale.deal", deal)).join(" · "),
                action: t("home.todoItems.stale.action"),
            };
    }
}
