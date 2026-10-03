"use client";

import { useMemo } from "react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { NetworkMark } from "./NetworkMark";
import { PostActions, PostStatus } from "./PostRow";
import {
    addDays,
    dayNumber,
    isDue,
    isRetrying,
    postMoment,
    sameDay,
    timeOfDay,
    weekday,
} from "../_lib/time";
import type { BrandPost } from "../api";

/** A post on a day: time, network, first words. The status is a colour only where it is one. */
function DayPost({ post, onChange }: { post: BrandPost; onChange: () => void }) {
    const at = postMoment(post);
    const attention = isDue(post) || isRetrying(post);
    return (
        <PostActions post={post} onChange={onChange}>
            <button
                type="button"
                className={cn(
                    "focus-visible:ring-brand/50 hover:bg-panel-2 flex w-full flex-col gap-0.5 rounded-md border-l-2 py-1 pl-2 pr-1 text-left outline-none focus-visible:ring-[3px]",
                    post.status === "scheduled" && !attention && "border-ink-3",
                    post.status === "scheduled" && attention && "border-warn",
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
                {(post.status === "failed" || post.status === "publishing" || attention) && (
                    <PostStatus post={post} className="text-[11px]" />
                )}
            </button>
        </PostActions>
    );
}

/**
 * The week, Monday to Sunday, every post where it belongs; earlier weeks show
 * what went out, later ones what is due. Anything can be moved or published
 * from its popover. On a phone the seven days stack.
 */
export function WeekCalendar({
    weekStart,
    posts,
    loading,
    onChange,
    onCompose,
}: {
    weekStart: Date;
    posts: BrandPost[];
    loading: boolean;
    onChange: () => void;
    onCompose: () => void;
}) {
    const days = useMemo(
        () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
        [weekStart]
    );
    const weekEnd = addDays(weekStart, 7);
    const inWeek = posts.filter(p => {
        const at = postMoment(p).getTime();
        return at >= weekStart.getTime() && at < weekEnd.getTime();
    });
    const today = new Date();

    if (loading) return <SkeletonRows rows={3} height={90} />;

    return (
        <div className="flex flex-col gap-2">
            <div className="border-line bg-panel grid grid-cols-1 overflow-hidden rounded-lg border md:grid-cols-7">
                {days.map((day, i) => {
                    const isToday = sameDay(day, today);
                    const dayPosts = inWeek
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
                                <DayPost key={post.id} post={post} onChange={onChange} />
                            ))}
                        </section>
                    );
                })}
            </div>
            {inWeek.length === 0 && (
                <p className="text-ink-3 flex flex-wrap items-center gap-x-1 text-[13px]">
                    Nothing on this week.
                    <Button
                        variant="link"
                        size="sm"
                        className="text-brand-ink h-auto p-0 text-[13px] font-normal"
                        onClick={onCompose}
                    >
                        Compose a post
                    </Button>
                    or generate a campaign and schedule its drafts.
                </p>
            )}
        </div>
    );
}
