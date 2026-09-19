"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import { InlineError } from "../../_components/EmptyState";
import { PageHeader } from "../../_components/PageHeader";
import { SkeletonRows } from "../../_components/SkeletonRows";
import { plural } from "../../_lib/format";
import { useGrowthPaths } from "../../_lib/paths";
import { useResource } from "../../_lib/useResource";
import { NetworkMark } from "../_components/NetworkMark";
import { PostActions, PostStatus } from "../_components/PostRow";
import {
    addDays,
    dayNumber,
    isDue,
    monthYear,
    postMoment,
    sameDay,
    startOfWeek,
    timeOfDay,
    weekRange,
    weekday,
} from "../_lib/time";
import { brandApi, type BrandPost } from "../api";

/** A post on a day: time, network, first words. The status is a colour only where it is one. */
function DayPost({ post, onChange }: { post: BrandPost; onChange: () => void }) {
    const at = postMoment(post);
    return (
        <PostActions post={post} onChange={onChange}>
            <button
                type="button"
                className={cn(
                    "focus-visible:ring-brand/50 hover:bg-panel-2 flex w-full flex-col gap-0.5 rounded-md border-l-2 py-1 pl-2 pr-1 text-left outline-none focus-visible:ring-[3px]",
                    post.status === "scheduled" && !isDue(post) && "border-ink-3",
                    post.status === "scheduled" && isDue(post) && "border-warn",
                    post.status === "publishing" && "border-brand",
                    post.status === "published" && "border-success",
                    post.status === "failed" && "border-danger",
                    (post.status === "draft" || post.status === "cancelled") && "border-line"
                )}
            >
                <span className="flex items-center gap-1.5">
                    <NetworkMark
                        platform={post.platform}
                        size={14}
                        muted={post.status === "cancelled" || post.status === "draft"}
                    />
                    <span className="text-ink-2 font-mono text-[11px] tabular-nums">
                        {post.status === "draft" ? "draft" : timeOfDay(at)}
                    </span>
                </span>
                <span
                    className={cn(
                        "text-ink line-clamp-2 text-[12px] leading-[1.3]",
                        post.status === "cancelled" && "text-ink-3 line-through"
                    )}
                >
                    {post.body}
                </span>
                {(post.status === "failed" || post.status === "publishing" || isDue(post)) && (
                    <PostStatus post={post} className="text-[11px]" />
                )}
            </button>
        </PostActions>
    );
}

/**
 * The week, Monday to Sunday, every post where it belongs; earlier weeks show
 * what went out, later ones what is due. Anything can be moved or published
 * from its popover; the list under the grid is the same week for a phone.
 */
export function CalendarScreen() {
    const paths = useGrowthPaths();
    const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
    const range = useMemo(() => weekRange(weekStart), [weekStart]);
    const res = useResource(
        `brand:calendar:${range.from}`,
        () => brandApi.posts({ from: range.from, to: range.to }),
        { pollMs: 15_000 }
    );
    const posts = res.data?.posts ?? [];
    const days = useMemo(
        () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
        [weekStart]
    );
    const today = new Date();
    const thisWeek = sameDay(startOfWeek(today), weekStart);
    const due = posts.filter(p => isDue(p));
    const scheduled = posts.filter(p => p.status === "scheduled").length;
    const published = posts.filter(p => p.status === "published").length;

    const publishDue = async () => {
        try {
            const result = await brandApi.publishDue();
            const n = result.published.length;
            if (n > 0) toast.success(`Published ${plural(n, "overdue post")}`);
            if (result.failed.length > 0)
                toast.error(`${plural(result.failed.length, "post")} failed; see the calendar`);
            if (n === 0 && result.failed.length === 0) toast("Nothing was overdue");
            await res.reload();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not publish");
        }
    };

    return (
        <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
            <PageHeader
                size="md"
                title="Calendar"
                sub={
                    res.data
                        ? `${plural(scheduled, "post")} scheduled and ${published} out this week${due.length ? ` · ${plural(due.length, "post")} overdue` : ""}`
                        : undefined
                }
                actions={
                    <>
                        {due.length > 0 && (
                            <Button size="sm" variant="outline" onClick={() => void publishDue()}>
                                Publish overdue now
                            </Button>
                        )}
                        <Button asChild size="sm">
                            <Link href={paths.brand("/compose")}>Compose</Link>
                        </Button>
                    </>
                }
            />

            <div className="flex items-center gap-2">
                <Button
                    size="sm"
                    variant="outline"
                    className="size-8 p-0"
                    aria-label="Previous week"
                    onClick={() => setWeekStart(w => addDays(w, -7))}
                >
                    <ChevronLeft className="size-4" />
                </Button>
                <Button
                    size="sm"
                    variant="outline"
                    className="size-8 p-0"
                    aria-label="Next week"
                    onClick={() => setWeekStart(w => addDays(w, 7))}
                >
                    <ChevronRight className="size-4" />
                </Button>
                {!thisWeek && (
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setWeekStart(startOfWeek(new Date()))}
                    >
                        This week
                    </Button>
                )}
                <span className="text-ink text-[13px] font-medium">{monthYear(weekStart)}</span>
                <span className="text-ink-3 text-[13px]">
                    week of {dayNumber(weekStart)}–{dayNumber(addDays(weekStart, 6))}
                </span>
            </div>

            {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}
            {res.loading ? (
                <SkeletonRows rows={3} height={90} />
            ) : (
                <div className="border-line bg-panel grid grid-cols-1 overflow-hidden rounded-lg border md:grid-cols-7">
                    {days.map((day, i) => {
                        const isToday = sameDay(day, today);
                        const dayPosts = posts
                            .filter(p => sameDay(postMoment(p), day))
                            .sort((a, b) => postMoment(a).getTime() - postMoment(b).getTime());
                        return (
                            <section
                                key={day.toISOString()}
                                className={cn(
                                    "border-line-2 flex min-h-[132px] flex-col gap-1.5 p-2",
                                    i > 0 && "border-t md:border-l md:border-t-0",
                                    isToday && "bg-surface-2/60"
                                )}
                                aria-label={day.toDateString()}
                            >
                                <header className="flex items-baseline justify-between px-0.5">
                                    <span
                                        className={cn(
                                            "text-[12px]",
                                            isToday ? "text-brand-ink font-semibold" : "text-ink-3"
                                        )}
                                    >
                                        {weekday(day)}
                                    </span>
                                    <span
                                        className={cn(
                                            "font-mono text-[12px] tabular-nums",
                                            isToday ? "text-brand-ink font-semibold" : "text-ink-3"
                                        )}
                                    >
                                        {dayNumber(day)}
                                    </span>
                                </header>
                                {dayPosts.map(post => (
                                    <DayPost
                                        key={post.id}
                                        post={post}
                                        onChange={() => void res.reload()}
                                    />
                                ))}
                            </section>
                        );
                    })}
                </div>
            )}
            {!res.loading && posts.length === 0 && (
                <p className="text-ink-3 text-[13px]">
                    Nothing on this week.{" "}
                    <Link href={paths.brand("/compose")} className="text-brand-ink hover:underline">
                        Compose a post
                    </Link>{" "}
                    or generate a campaign and schedule its drafts.
                </p>
            )}
        </div>
    );
}
