"use client";

import { ArrowRight, Megaphone } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { IconGrowth, ProspectsMark } from "~/components/icons/prospects";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

import { InlineError } from "../_components/EmptyState";
import { ToolHeader, ToolPage } from "../_components/ToolHeader";
import { plural, relativeTime } from "../_lib/format";
import { useGrowthUrls } from "../_lib/paths";
import { useResource } from "../_lib/useResource";
import { brandApi } from "../brand/api";
import { DAY, addDays, isDue } from "../brand/_lib/time";
import { prospectsApi } from "../prospects/api";
import { useProspects } from "../prospects/_lib/context";

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
    return (
        <div className="min-w-0">
            <div className="text-ink text-[22px] font-semibold tabular-nums leading-none tracking-[-0.02em]">
                {value}
            </div>
            <div className="text-ink-3 mt-1 text-xs">{label}</div>
        </div>
    );
}

function WorkspaceCard({
    icon,
    title,
    description,
    href,
    stats,
    actions,
    error,
    onRetry,
    className,
}: {
    icon: React.ReactNode;
    title: string;
    description: string;
    href: string;
    stats: React.ReactNode;
    actions: React.ReactNode;
    error?: string | null;
    onRetry?: () => void;
    className?: string;
}) {
    return (
        <section
            className={cn(
                "border-line bg-panel flex flex-col gap-5 rounded-2xl border p-5 md:p-6",
                className
            )}
        >
            <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                    <div
                        className="bg-brand/10 text-brand-ink dark:bg-brand/15 flex size-10 shrink-0 items-center justify-center rounded-2xl"
                        aria-hidden
                    >
                        {icon}
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-ink text-[17px] font-semibold tracking-tight">
                            <Link href={href} className="hover:underline">
                                {title}
                            </Link>
                        </h2>
                        <p className="text-ink-2 text-[13px]">{description}</p>
                    </div>
                </div>
                <Button asChild variant="ghost" size="sm" className="shrink-0">
                    <Link href={href} aria-label={`Open ${title}`}>
                        Open
                        <ArrowRight className="size-3.5" />
                    </Link>
                </Button>
            </div>
            {error ? (
                <InlineError message={error} onRetry={onRetry} />
            ) : (
                <div className="grid grid-cols-3 gap-4">{stats}</div>
            )}
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </section>
    );
}

/**
 * Growth's front door: what the week looks like on each side, and the two
 * things a person most often comes here to do. Everything else is one click
 * into the workspace it belongs to.
 */
export function GrowthLanding() {
    const urls = useGrowthUrls();
    const { segment, segmentId, segmentsLoading } = useProspects();
    const window = useMemo(() => {
        const now = new Date();
        return {
            from: new Date(now.getTime() - 7 * DAY).toISOString(),
            to: addDays(now, 7).toISOString(),
        };
    }, []);
    const posts = useResource(`landing:posts:${window.from}`, () =>
        brandApi.posts({ from: window.from, to: window.to })
    );
    const accounts = useResource("brand:accounts", () => brandApi.accounts());
    const home = useResource(segmentId ? `landing:home:${segmentId}` : null, () =>
        prospectsApi.home(segmentId!)
    );

    const list = posts.data?.posts ?? [];
    const now = Date.now();
    const upcoming = list.filter(p => p.status === "scheduled" || p.status === "publishing");
    const overdue = list.filter(p => isDue(p)).length;
    const wentOut = list.filter(
        p =>
            p.status === "published" &&
            new Date(p.publishedAt ?? p.createdAt).getTime() >= now - 7 * DAY
    ).length;
    const connected = (accounts.data?.accounts ?? []).filter(a => a.configured).length;
    const networks = accounts.data?.accounts.length ?? 4;

    const d = home.data;
    const sk = <Skeleton className="h-6 w-10" />;

    return (
        <ToolPage width="reading">
            <ToolHeader
                icon={<IconGrowth size={20} />}
                title="Growth"
                description="Make the company known, and find the companies that will buy."
            />
            <div className="grid gap-4 md:grid-cols-2">
                <WorkspaceCard
                    icon={<Megaphone className="size-5" />}
                    title="Brand"
                    description="Compose once for every network, schedule it, see the week."
                    href={urls.brand()}
                    error={posts.error}
                    onRetry={() => void posts.reload()}
                    stats={
                        <>
                            <Stat
                                value={posts.loading ? sk : upcoming.length}
                                label={overdue > 0 ? `coming up · ${overdue} overdue` : "coming up"}
                            />
                            <Stat
                                value={posts.loading ? sk : wentOut}
                                label="out in the last 7 days"
                            />
                            <Stat
                                value={accounts.loading ? sk : `${connected} / ${networks}`}
                                label="networks connected"
                            />
                        </>
                    }
                    actions={
                        <>
                            <Button asChild size="sm">
                                <Link href={urls.brand({ panel: "compose" })}>Compose a post</Link>
                            </Button>
                            <Button asChild size="sm" variant="outline">
                                <Link href={urls.campaigns}>Generate a campaign</Link>
                            </Button>
                        </>
                    }
                />
                <WorkspaceCard
                    icon={<ProspectsMark size={18} />}
                    title="Prospects"
                    description={
                        segment
                            ? segment.headline
                            : segmentsLoading
                              ? "Loading your segment"
                              : "Find the companies that would buy what you sell."
                    }
                    href={urls.prospects()}
                    error={home.error}
                    onRetry={() => void home.reload()}
                    stats={
                        <>
                            <Stat
                                value={
                                    !d && (home.loading || segmentsLoading)
                                        ? sk
                                        : (d?.segment.counts.companies ?? 0)
                                }
                                label="companies"
                            />
                            <Stat
                                value={
                                    !d && (home.loading || segmentsLoading)
                                        ? sk
                                        : (d?.segment.counts.deals ?? 0)
                                }
                                label="deals"
                            />
                            <Stat
                                value={
                                    !d && (home.loading || segmentsLoading)
                                        ? sk
                                        : (d?.todo.length ?? 0)
                                }
                                label={
                                    d?.lastRunAt
                                        ? `to do · last run ${relativeTime(d.lastRunAt)}`
                                        : "to do · no run yet"
                                }
                            />
                        </>
                    }
                    actions={
                        <>
                            <Button asChild size="sm">
                                <Link href={urls.prospects({ view: "companies" })}>
                                    {d && d.todo.length > 0
                                        ? plural(d.todo.length, "thing") + " to do"
                                        : "Open companies"}
                                </Link>
                            </Button>
                            <Button asChild size="sm" variant="outline">
                                <Link href={urls.prospects({ panel: "runs" })}>Find companies</Link>
                            </Button>
                        </>
                    }
                />
            </div>
        </ToolPage>
    );
}
