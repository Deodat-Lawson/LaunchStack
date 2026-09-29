"use client";

import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { cn } from "~/lib/utils";

import { NETWORK_LABEL, NetworkMark } from "./NetworkMark";
import { STATUS_WORD, dayAndMonth, isDue, postMoment, timeOfDay, toLocalInput } from "../_lib/time";
import { brandApi, type BrandPost } from "../api";

/** Status as a dot and a word; semantic colour only where the status is one. */
export function PostStatus({ post, className }: { post: BrandPost; className?: string }) {
    const due = isDue(post);
    const word = due ? "Due" : STATUS_WORD[post.status];
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
                    "size-[7px] rounded-full",
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

/**
 * Everything one can do to a post, in a popover off its row: publish now,
 * move it, cancel or delete it, open it where it went. Actions are gated the
 * way the API gates them, so a disabled control is never a surprise.
 */
export function PostActions({
    post,
    onChange,
    children,
}: {
    post: BrandPost;
    onChange: () => void;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [when, setWhen] = useState(() =>
        toLocalInput(post.scheduledAt ? new Date(post.scheduledAt) : postMoment(post))
    );
    const editable = post.status !== "published" && post.status !== "publishing";
    const publishable =
        post.status === "draft" || post.status === "scheduled" || post.status === "failed";
    const run = async (work: () => Promise<unknown>, done: string) => {
        setBusy(true);
        try {
            await work();
            toast(done);
            onChange();
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "That did not work");
        } finally {
            setBusy(false);
        }
    };
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{children}</PopoverTrigger>
            <PopoverContent align="start" className="w-[320px] p-3">
                <div className="flex items-center gap-2">
                    <NetworkMark platform={post.platform} size={18} />
                    <span className="text-ink text-[13px] font-medium">
                        {NETWORK_LABEL[post.platform]}
                    </span>
                    <PostStatus post={post} className="ml-auto" />
                </div>
                {post.title && (
                    <div className="text-ink mt-2 text-[13px] font-medium">{post.title}</div>
                )}
                <p className="text-ink-2 mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-[13px] leading-[1.45]">
                    {post.body}
                </p>
                <div className="text-ink-3 mt-2 text-xs">
                    {post.status === "published" && post.publishedAt
                        ? `Went out ${dayAndMonth(new Date(post.publishedAt))} at ${timeOfDay(new Date(post.publishedAt))}`
                        : post.scheduledAt
                          ? `Due ${dayAndMonth(new Date(post.scheduledAt))} at ${timeOfDay(new Date(post.scheduledAt))}`
                          : "No time set"}
                    {post.source?.kind === "campaign" ? " · from a campaign" : ""}
                </div>
                {post.error && <p className="text-danger mt-2 text-xs">{post.error}</p>}

                {editable && (
                    <div className="border-line-2 mt-3 flex items-center gap-2 border-t pt-3">
                        <Input
                            type="datetime-local"
                            value={when}
                            onChange={e => setWhen(e.target.value)}
                            className="h-8 text-[13px]"
                            aria-label="New time"
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
                                    "Rescheduled"
                                )
                            }
                        >
                            {post.status === "scheduled" ? "Move" : "Schedule"}
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
                                            result.error ?? "The network did not accept it"
                                        );
                                }, "Published")
                            }
                        >
                            Publish now
                        </Button>
                    )}
                    {post.status === "scheduled" && (
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                                void run(
                                    () => brandApi.patch(post.id, { status: "cancelled" }),
                                    "Cancelled. It stays on the calendar."
                                )
                            }
                        >
                            Cancel
                        </Button>
                    )}
                    {editable && (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger hover:text-danger"
                            disabled={busy}
                            onClick={() => void run(() => brandApi.remove(post.id), "Deleted")}
                        >
                            Delete
                        </Button>
                    )}
                    {post.postUrl && (
                        <Button asChild size="sm" variant="outline" className="ml-auto">
                            <a href={post.postUrl} target="_blank" rel="noreferrer">
                                Open
                                <ExternalLink className="size-3.5" />
                            </a>
                        </Button>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}

/** One post as a list row: when, where, what, status. Click for the actions. */
export function PostRow({ post, onChange }: { post: BrandPost; onChange: () => void }) {
    const at = postMoment(post);
    return (
        <PostActions post={post} onChange={onChange}>
            <button
                type="button"
                className="border-line-2 hover:bg-panel-2 focus-visible:ring-brand/50 grid w-full grid-cols-[92px_20px_minmax(0,1fr)_auto] items-center gap-3 border-t px-4 py-2.5 text-left outline-none first:border-t-0 focus-visible:ring-[3px] md:grid-cols-[150px_20px_minmax(0,1fr)_auto]"
            >
                <span className="text-ink-2 text-[13px] tabular-nums">
                    <span className="hidden md:inline">{dayAndMonth(at)} · </span>
                    {timeOfDay(at)}
                </span>
                <NetworkMark
                    platform={post.platform}
                    size={18}
                    muted={post.status === "cancelled"}
                />
                <span
                    className={cn(
                        "text-ink truncate text-[13px]",
                        post.status === "cancelled" && "text-ink-3 line-through"
                    )}
                >
                    {post.title ? `${post.title} — ` : ""}
                    {post.body}
                </span>
                <PostStatus post={post} />
            </button>
        </PostActions>
    );
}
