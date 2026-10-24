"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import { InlineError } from "~/components/tools/EmptyState";
import { PageHeader } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { useErrorText } from "~/lib/tools/errorText";
import { useGrowthPaths } from "../../_lib/paths";
import { useResource } from "~/lib/tools/useResource";
import { ChannelAvatar } from "../_components/ChannelAvatar";
import { NETWORK_LABEL, NetworkMark } from "../_components/NetworkMark";
import {
    MediaMark,
    PostActions,
    PostMetricsInline,
    PostStatus,
    PostsReadOnly,
} from "../_components/PostRow";
import {
    addDays,
    dayNumber,
    fullDate,
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

/**
 * A post on a day: time, the channel it goes out as, first words, an image
 * mark, and once it is out its numbers. The status is a colour only where
 * it is one.
 */
function DayPost({ post, onChange }: { post: BrandPost; onChange: () => void }) {
    const t = useTranslations("growth.brand.calendar");
    const locale = useLocale();
    const at = postMoment(post);
    const quiet = post.status === "cancelled" || post.status === "draft";
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
                    quiet && "border-line"
                )}
            >
                <span className="flex min-w-0 items-center gap-1.5">
                    {post.channel ? (
                        <ChannelAvatar
                            name={post.channel.name}
                            kind={post.channel.kind}
                            avatarUrl={post.channel.avatarUrl}
                            size={14}
                            muted={quiet}
                        />
                    ) : (
                        <NetworkMark platform={post.platform} size={14} muted={quiet} />
                    )}
                    <span className="text-ink-2 shrink-0 font-mono text-[11px] tabular-nums">
                        {post.status === "draft" ? t("draft") : timeOfDay(at, locale)}
                    </span>
                    <MediaMark count={post.media.length} className="ml-auto shrink-0" />
                </span>
                <span
                    className={cn(
                        "truncate text-[11.5px] leading-tight",
                        quiet ? "text-ink-3" : "text-ink-2"
                    )}
                >
                    {post.channel?.name ??
                        t("disconnected", { network: NETWORK_LABEL[post.platform] })}
                </span>
                <span
                    className={cn(
                        "text-ink line-clamp-2 text-[12px] leading-[1.3]",
                        post.status === "cancelled" && "text-ink-3 line-through"
                    )}
                >
                    {post.body}
                </span>
                {post.status === "published" && post.metrics && (
                    <PostMetricsInline metrics={post.metrics} className="text-[11px]" />
                )}
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
    const t = useTranslations("growth.brand");
    const errorText = useErrorText();
    const locale = useLocale();
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
            if (n > 0) toast.success(t("calendar.publishedOverdue", { count: n }));
            if (result.failed.length > 0)
                toast.error(t("calendar.failedSee", { count: result.failed.length }));
            if (n === 0 && result.failed.length === 0) toast(t("calendar.nothingOverdue"));
            await res.reload();
        } catch (e) {
            toast.error(errorText(e, t("calendar.publishFailed")));
        }
    };

    return (
        <PostsReadOnly.Provider value={res.data?.canPublish === false}>
            <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
                <PageHeader
                    size="md"
                    title={t("calendar.title")}
                    sub={
                        res.data
                            ? due.length
                                ? t("calendar.subOverdue", {
                                      scheduled,
                                      published,
                                      overdue: due.length,
                                  })
                                : t("calendar.sub", { scheduled, published })
                            : undefined
                    }
                    actions={
                        <>
                            {due.length > 0 && res.data?.canPublish !== false && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void publishDue()}
                                >
                                    {t("calendar.publishOverdue")}
                                </Button>
                            )}
                            <Button asChild size="sm">
                                <ToolLink href={paths.brand("/compose")}>
                                    {t("common.compose")}
                                </ToolLink>
                            </Button>
                        </>
                    }
                />

                <div className="flex items-center gap-2">
                    <Button
                        size="sm"
                        variant="outline"
                        className="size-8 p-0"
                        aria-label={t("calendar.previousWeek")}
                        onClick={() => setWeekStart(w => addDays(w, -7))}
                    >
                        <ChevronLeft className="size-4" />
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        className="size-8 p-0"
                        aria-label={t("calendar.nextWeek")}
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
                            {t("calendar.thisWeek")}
                        </Button>
                    )}
                    <span className="text-ink text-[13px] font-medium">
                        {monthYear(weekStart, locale)}
                    </span>
                    <span className="text-ink-3 text-[13px]">
                        {t("calendar.weekOf", {
                            start: dayNumber(weekStart, locale),
                            end: dayNumber(addDays(weekStart, 6), locale),
                        })}
                    </span>
                </div>

                {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}
                {res.loading ? (
                    <SkeletonRows rows={3} height={90} />
                ) : (
                    <div className="border-line bg-panel @max-md:grid-cols-1 grid grid-cols-7 overflow-hidden rounded-lg border">
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
                                        i > 0 && "@max-md:border-l-0 @max-md:border-t border-l",
                                        isToday && "bg-surface-2/60"
                                    )}
                                    aria-label={fullDate(day, locale)}
                                >
                                    <header className="flex items-baseline justify-between px-0.5">
                                        <span
                                            className={cn(
                                                "text-[12px]",
                                                isToday
                                                    ? "text-brand-ink font-semibold"
                                                    : "text-ink-3"
                                            )}
                                        >
                                            {weekday(day, locale)}
                                        </span>
                                        <span
                                            className={cn(
                                                "font-mono text-[12px] tabular-nums",
                                                isToday
                                                    ? "text-brand-ink font-semibold"
                                                    : "text-ink-3"
                                            )}
                                        >
                                            {dayNumber(day, locale)}
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
                        {t.rich("calendar.nothing", {
                            link: chunks => (
                                <ToolLink
                                    href={paths.brand("/compose")}
                                    className="text-brand-ink hover:underline"
                                >
                                    {chunks}
                                </ToolLink>
                            ),
                        })}
                    </p>
                )}
            </div>
        </PostsReadOnly.Provider>
    );
}
