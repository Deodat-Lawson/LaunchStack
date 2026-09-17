"use client";

import Link from "next/link";
import { useEffect } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

import { prospectsApi, type SourceYield } from "../api";
import { useProspects } from "../_lib/context";
import { plural, relativeTime } from "../_lib/format";
import { STAGE_LABELS } from "../_lib/stages";
import { useResource } from "../_lib/useResource";
import { EmptyState, InlineError } from "../_components/EmptyState";
import { FitMeter } from "../_components/FitMeter";
import { FunnelBar } from "../_components/FunnelBar";
import { PageHeader, SectionHeading } from "../_components/PageHeader";
import { SkeletonRows } from "../_components/SkeletonRows";

function YieldRow({ y, max }: { y: SourceYield; max: number }) {
    const off = y.status === "off" || y.status === "skipped";
    const found = y.kind === "signal" ? `${y.found} signals` : String(y.found);
    return (
        <div className="border-line-2 grid grid-cols-[minmax(120px,150px)_1fr_64px_56px] items-center gap-3 border-t px-4 py-2 text-[13px] first:border-t-0">
            <span className={cn("truncate", off ? "text-ink-3" : "text-ink")}>{y.label}</span>
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
                {off ? <span className="text-ink-3 text-xs">{y.detail ?? "off"}</span> : found}
            </span>
            <span className="text-ink-2 text-right tabular-nums">
                {off || y.kind === "signal" ? "" : (y.inDeals ?? "—")}
            </span>
        </div>
    );
}

export function HomeScreen() {
    const { segmentId, href, startRun, activeRun } = useProspects();
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
            toast.error(e instanceof Error ? e.message : "Could not start the run");
        }
    };

    const headline = d?.segment.headline ?? "";
    const maxFound = d ? Math.max(1, ...d.yield.map(y => y.found)) : 1;

    return (
        <div className="mx-auto flex max-w-[1080px] flex-col gap-7">
            <PageHeader
                title={d ? `${headline},` : "Loading your segment"}
                accent={d ? "this week" : undefined}
                sub={
                    d ? (
                        <>
                            {plural(d.segment.counts.companies, "company", "companies")} ·{" "}
                            {plural(d.segment.counts.deals, "deal")} ·{" "}
                            {d.lastRunAt
                                ? `last run ${relativeTime(d.lastRunAt)} across ${plural(d.segment.counts.sources, "source")}`
                                : "no run yet"}
                        </>
                    ) : (
                        <Skeleton className="h-3 w-64" />
                    )
                }
                actions={
                    <>
                        <Button variant="ghost" size="sm" asChild>
                            <Link href={href("/segment")}>Segment</Link>
                        </Button>
                        <Button size="sm" onClick={() => void find()} disabled={!segmentId}>
                            Find companies
                        </Button>
                    </>
                }
            />

            {home.error && <InlineError message={home.error} onRetry={() => void home.reload()} />}

            <section>
                <SectionHeading
                    title="To do"
                    aside={d ? plural(d.todo.length, "item") : undefined}
                />
                {home.loading ? (
                    <SkeletonRows rows={3} height={56} />
                ) : d && d.todo.length === 0 ? (
                    d.lastRunAt ? (
                        <EmptyState
                            title="Nothing waiting on you"
                            body="New high-fit companies, replies due and stale deals show up here."
                        />
                    ) : (
                        <EmptyState
                            mark
                            title="Find your first companies"
                            body={`Searches the ${plural(d.segment.counts.sources, "source")} this segment has on, profiles the best matches with cited evidence, and finds people to contact.`}
                            action={
                                <Button size="sm" onClick={() => void find()}>
                                    Find companies
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
                                    <div className="text-ink text-sm font-medium">{item.title}</div>
                                    <div className="text-ink-3 truncate text-xs">{item.detail}</div>
                                </div>
                                <Button variant="outline" size="sm" asChild>
                                    <Link href={href(item.action.href)}>{item.action.label}</Link>
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section>
                <SectionHeading
                    title="Deals"
                    aside={
                        d?.medianDays
                            ? `median ${d.medianDays.days} days from ${STAGE_LABELS[d.medianDays.from]} to ${STAGE_LABELS[d.medianDays.to]}`
                            : undefined
                    }
                />
                {home.loading || !d ? (
                    <Skeleton className="h-8 w-full" />
                ) : (
                    <FunnelBar counts={d.funnel} hrefFor={() => href("/deals")} />
                )}
            </section>

            <div className="grid grid-cols-1 gap-7 lg:grid-cols-2">
                <section className="min-w-0">
                    <SectionHeading title="Where companies come from" aside="found · in a deal" />
                    {home.loading || !d ? (
                        <SkeletonRows rows={6} height={38} />
                    ) : d.yield.length === 0 ? (
                        <EmptyState
                            title="No sources have run yet"
                            body="Each platform's yield shows here after the first run."
                        />
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
                        title="New and worth a look"
                        aside={d?.lastRunAt ? `from the last run` : undefined}
                    />
                    {home.loading || !d ? (
                        <SkeletonRows rows={4} height={56} />
                    ) : d.fresh.length === 0 ? (
                        <EmptyState
                            title="Nothing new yet"
                            body="Companies above the fit threshold from the latest run appear here."
                        />
                    ) : (
                        <div className="border-line bg-panel overflow-hidden rounded-lg border">
                            {d.fresh.map(c => (
                                <Link
                                    key={c.id}
                                    href={href(`/companies/${c.id}`)}
                                    className="border-line-2 hover:bg-panel-2 focus-visible:bg-panel-2 grid grid-cols-[1fr_auto] items-center gap-4 border-t px-4 py-2.5 outline-none first:border-t-0"
                                >
                                    <span className="min-w-0">
                                        <span className="text-ink block truncate text-sm font-medium">
                                            {c.name}
                                        </span>
                                        <span className="text-ink-2 block truncate text-xs">
                                            {c.why}
                                        </span>
                                    </span>
                                    <FitMeter value={c.fit} threshold={c.fitThreshold} />
                                </Link>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
