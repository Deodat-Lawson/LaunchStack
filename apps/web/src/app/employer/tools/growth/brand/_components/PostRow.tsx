"use client";

import { ExternalLink, Eye, ImageIcon, MessageSquare, ThumbsUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { createContext, useContext, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { cn } from "~/lib/utils";

import { useErrorText } from "~/lib/tools/errorText";
import { compact } from "../_lib/numbers";
import { dayAndMonth, isDue, postMoment, timeOfDay, toLocalInput } from "../_lib/time";
import { brandApi, type BrandPost, type BrandPostMetrics } from "../api";
import { ChannelAvatar, ChannelLabel } from "./ChannelAvatar";
import { NETWORK_LABEL, NetworkMark } from "./NetworkMark";

/** Status as a dot and a word; semantic colour only where the status is one. */
export function PostStatus({ post, className }: { post: BrandPost; className?: string }) {
    const t = useTranslations("growth.brand.status");
    const due = isDue(post);
    const word = due ? t("due") : t(post.status);
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 text-xs",
                post.status === "published" && "text-ink-2",
                post.status === "publishing" && "text-brand-ink",
                post.status === "failed" && "text-danger",
                post.status === "cancelled" && "text-ink-3",
                post.status === "draft" && "text-ink-3",
                post.status === "scheduled" && (due ? "text-warn" : "text-ink-2"),
                className
            )}
        >
            <span
                className={cn(
                    "size-[7px] shrink-0 rounded-full",
                    post.status === "published" && "bg-success",
                    post.status === "publishing" &&
                        "bg-brand animate-pulse motion-reduce:animate-none",
                    post.status === "failed" && "bg-danger",
                    post.status === "cancelled" && "bg-ink-4",
                    post.status === "draft" && "border-line border",
                    post.status === "scheduled" && (due ? "bg-warn" : "bg-ink-3")
                )}
            />
            {word}
        </span>
    );
}

/** "2.1K · 64 · 9" with an icon per number and the words for a screen reader. */
export function PostMetricsInline({
    metrics,
    className,
}: {
    metrics: BrandPostMetrics;
    className?: string;
}) {
    const t = useTranslations("growth.brand.metrics");
    const locale = useLocale();
    type Metric = "impressions" | "reactions" | "comments";
    const items = [
        metrics.impressions !== null
            ? { icon: Eye, n: metrics.impressions, word: "impressions" as const }
            : null,
        { icon: ThumbsUp, n: metrics.reactions, word: "reactions" as const },
        { icon: MessageSquare, n: metrics.comments, word: "comments" as const },
    ].filter(Boolean) as Array<{ icon: typeof Eye; n: number; word: Metric }>;
    return (
        <span
            className={cn(
                "text-ink-3 inline-flex items-center gap-2 text-[11.5px] tabular-nums",
                className
            )}
        >
            {items.map(({ icon: Icon, n, word }) => (
                <span
                    key={word}
                    className="inline-flex items-center gap-0.5"
                    title={t(word, { count: n })}
                >
                    <Icon className="size-3" aria-hidden />
                    <span aria-hidden>{compact(n, locale)}</span>
                    <span className="sr-only">{t(word, { count: n })}</span>
                </span>
            ))}
        </span>
    );
}

/** A small image mark when a post carries images, with the count past one. */
export function MediaMark({ count, className }: { count: number; className?: string }) {
    const t = useTranslations("growth.brand.metrics");
    if (count === 0) return null;
    return (
        <span
            className={cn("text-ink-3 inline-flex items-center gap-0.5 text-[11px]", className)}
            title={t("images", { count })}
        >
            <ImageIcon className="size-3" aria-hidden />
            {count > 1 && <span className="tabular-nums">{count}</span>}
            <span className="sr-only">{t("images", { count })}</span>
        </span>
    );
}

/**
 * Everything one can do to a post, in a popover off its row: publish now,
 * move it, cancel or delete it, open it where it went. Actions are gated the
 * way the API gates them, so a disabled control is never a surprise.
 */
/**
 * Whether the member looking may only read: a Viewer or Guest sees the
 * calendar and a post's details but no control that would speak as the
 * company. The screens set it from the posts response's `canPublish`.
 */
export const PostsReadOnly = createContext(false);

export function PostActions({
    post,
    onChange,
    children,
}: {
    post: BrandPost;
    onChange: () => void;
    children: React.ReactNode;
}) {
    const t = useTranslations("growth.brand");
    const errorText = useErrorText();
    const tc = useTranslations("common.actions");
    const locale = useLocale();
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [when, setWhen] = useState(() =>
        toLocalInput(post.scheduledAt ? new Date(post.scheduledAt) : postMoment(post))
    );
    const readOnly = useContext(PostsReadOnly);
    const editable = !readOnly && post.status !== "published" && post.status !== "publishing";
    const publishable =
        !readOnly &&
        (post.status === "draft" || post.status === "scheduled" || post.status === "failed");
    const run = async (work: () => Promise<unknown>, done: string) => {
        setBusy(true);
        try {
            await work();
            toast(done);
            onChange();
            setOpen(false);
        } catch (e) {
            toast.error(errorText(e, t("postActions.failed")));
        } finally {
            setBusy(false);
        }
    };
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{children}</PopoverTrigger>
            <PopoverContent align="start" className="w-[340px] p-3">
                <div className="flex items-center gap-2">
                    <ChannelLabel
                        channel={post.channel}
                        platform={post.platform}
                        size={22}
                        network
                        className="min-w-0 flex-1"
                    />
                    <PostStatus post={post} className="shrink-0" />
                </div>
                {post.title && (
                    <div className="text-ink mt-2 text-[13px] font-medium">{post.title}</div>
                )}
                <p className="text-ink-2 mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-[13px] leading-[1.45]">
                    {post.body}
                </p>
                {post.media.length > 0 && (
                    <div className="mt-2 flex gap-1.5">
                        {post.media.map(m => (
                            // eslint-disable-next-line @next/next/no-img-element -- same-origin media the network serves back; next/image needs known sizes
                            <img
                                key={m.id}
                                src={m.url}
                                alt={m.alt ?? ""}
                                className="border-line size-14 rounded-md border object-cover"
                            />
                        ))}
                    </div>
                )}
                <div className="text-ink-3 mt-2 text-xs">
                    {post.status === "published" && post.publishedAt
                        ? t("postActions.wentOut", {
                              date: dayAndMonth(new Date(post.publishedAt), locale),
                              time: timeOfDay(new Date(post.publishedAt), locale),
                          })
                        : post.scheduledAt
                          ? t("postActions.due", {
                                date: dayAndMonth(new Date(post.scheduledAt), locale),
                                time: timeOfDay(new Date(post.scheduledAt), locale),
                            })
                          : t("postActions.noTime")}
                    {post.source?.kind === "campaign" ? ` · ${t("postActions.fromCampaign")}` : ""}
                </div>
                {post.metrics && <PostMetricsInline metrics={post.metrics} className="mt-1.5" />}
                {post.error && <p className="text-danger mt-2 text-xs">{post.error}</p>}

                {editable && (
                    <div className="border-line-2 mt-3 flex items-center gap-2 border-t pt-3">
                        <Input
                            type="datetime-local"
                            value={when}
                            onChange={e => setWhen(e.target.value)}
                            className="h-8 text-[13px]"
                            aria-label={t("postActions.newTime")}
                        />
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || !when}
                            onClick={() =>
                                void run(
                                    () =>
                                        brandApi.patch(post.id, {
                                            scheduledAt: new Date(when).toISOString(),
                                            status: "scheduled",
                                        }),
                                    t("postActions.rescheduled")
                                )
                            }
                        >
                            {post.status === "scheduled"
                                ? t("postActions.move")
                                : t("postActions.schedule")}
                        </Button>
                    </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    {publishable && (
                        <Button
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                                void run(async () => {
                                    const { post: result } = await brandApi.publish(post.id);
                                    if (result.status !== "published")
                                        throw new Error(
                                            result.error ?? t("postActions.notAccepted")
                                        );
                                }, t("postActions.published"))
                            }
                        >
                            {t("postActions.publishNow")}
                        </Button>
                    )}
                    {post.status === "scheduled" && !readOnly && (
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                                void run(
                                    () => brandApi.patch(post.id, { status: "cancelled" }),
                                    t("postActions.cancelled")
                                )
                            }
                        >
                            {tc("cancel")}
                        </Button>
                    )}
                    {editable && (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger hover:text-danger"
                            disabled={busy}
                            onClick={() =>
                                void run(() => brandApi.remove(post.id), t("postActions.deleted"))
                            }
                        >
                            {tc("delete")}
                        </Button>
                    )}
                    {post.postUrl && (
                        <Button asChild size="sm" variant="outline" className="ml-auto">
                            <a href={post.postUrl} target="_blank" rel="noreferrer">
                                {t("common.openOn", { network: NETWORK_LABEL[post.platform] })}
                                <ExternalLink className="size-3.5" aria-hidden />
                            </a>
                        </Button>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}

/** One post as a list row: when, where, what, status (or its numbers once out). Click for the actions. */
export function PostRow({ post, onChange }: { post: BrandPost; onChange: () => void }) {
    const locale = useLocale();
    const at = postMoment(post);
    const muted = post.status === "cancelled";
    return (
        <PostActions post={post} onChange={onChange}>
            <button
                type="button"
                className="border-line-2 hover:bg-panel-2 focus-visible:ring-brand/50 @max-md:grid-cols-[72px_22px_minmax(0,1fr)_auto] grid w-full grid-cols-[164px_minmax(0,170px)_minmax(0,1fr)_auto] items-center gap-3 border-t px-4 py-2.5 text-left outline-none first:border-t-0 focus-visible:ring-[3px]"
            >
                <span className="text-ink-2 text-[13px] tabular-nums">
                    <span className="@max-md:hidden">{dayAndMonth(at, locale)} · </span>
                    {timeOfDay(at, locale)}
                </span>
                <span className="@max-md:hidden flex min-w-0 items-center">
                    <ChannelLabel
                        channel={post.channel}
                        platform={post.platform}
                        size={20}
                        showKind={false}
                        muted={muted}
                    />
                </span>
                <span className="@max-md:inline-flex hidden">
                    {post.channel ? (
                        <ChannelAvatar
                            name={post.channel.name}
                            kind={post.channel.kind}
                            avatarUrl={post.channel.avatarUrl}
                            size={20}
                            muted={muted}
                        />
                    ) : (
                        <NetworkMark platform={post.platform} size={20} muted={muted} />
                    )}
                </span>
                <span className="flex min-w-0 items-center gap-2">
                    <span
                        className={cn(
                            "text-ink truncate text-[13px]",
                            muted && "text-ink-3 line-through"
                        )}
                    >
                        {post.title ? `${post.title} — ` : ""}
                        {post.body}
                    </span>
                    <MediaMark count={post.media.length} className="shrink-0" />
                </span>
                {post.status === "published" && post.metrics ? (
                    <PostMetricsInline metrics={post.metrics} />
                ) : (
                    <PostStatus post={post} />
                )}
            </button>
        </PostActions>
    );
}
