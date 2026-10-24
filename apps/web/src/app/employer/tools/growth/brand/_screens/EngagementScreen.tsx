"use client";

import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { useToolPathname, useToolRouter, useToolSearchParams } from "~/components/tool-app/nav";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { useResource } from "~/lib/tools/useResource";
import { cn } from "~/lib/utils";

import { useErrorText } from "~/lib/tools/errorText";
import { useGrowthFormat } from "../../_lib/format";
import { useGrowthPaths } from "../../_lib/paths";
import { ChannelAvatar } from "../_components/ChannelAvatar";
import { NETWORK_LABEL, NetworkMark } from "../_components/NetworkMark";
import { SyncButton, SyncProblems, SyncedAt, useBrandSync } from "../_components/Sync";
import { groupComments, isOpen, openCount, type CommentThread } from "../_lib/threads";
import { brandApi, type BrandChannel, type BrandComment } from "../api";

type Filter = "open" | "all";

type EngagementT = ReturnType<typeof useTranslations<"growth.brand.engagement">>;

/** Why this channel cannot reply from here, or null when it can. */
function replyBlocker(t: EngagementT, channel: BrandChannel | undefined): string | null {
    if (!channel) return t("noChannel");
    if (!channel.capabilities.comments) return t("cannotReply", { name: channel.name });
    if (channel.status === "reconnect") return t("needsReconnect", { name: channel.name });
    return null;
}

function CommentRow({
    comment,
    channel,
    pending,
    replying,
    draft,
    replyError,
    onStartReply,
    onDraft,
    onCancelReply,
    onSendReply,
    onHandled,
    readOnly,
}: {
    comment: BrandComment;
    channel: BrandChannel | undefined;
    pending: boolean;
    replying: boolean;
    draft: string;
    replyError: string | null;
    onStartReply: () => void;
    onDraft: (text: string) => void;
    onCancelReply: () => void;
    onSendReply: () => void;
    onHandled: (handled: boolean) => void;
    /** Viewers and Guests read the inbox; answering speaks as the company. */
    readOnly: boolean;
}) {
    const t = useTranslations("growth.brand.engagement");
    const tc = useTranslations("common.actions");
    const { relativeTime } = useGrowthFormat();
    const blocker = replyBlocker(t, channel);
    const done = comment.handledAt !== null;
    const inputRef = useRef<HTMLTextAreaElement>(null);
    return (
        <div className={cn("flex gap-3", pending && "opacity-60")}>
            {comment.isOwn && channel ? (
                <ChannelAvatar
                    name={channel.name}
                    kind={channel.kind}
                    avatarUrl={channel.avatarUrl}
                    size={28}
                />
            ) : (
                <ChannelAvatar
                    name={comment.authorName}
                    kind="person"
                    avatarUrl={null}
                    size={28}
                    muted={done}
                />
            )}
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-ink text-[13px] font-medium">{comment.authorName}</span>
                    {comment.authorHandle && comment.authorHandle !== comment.authorName && (
                        <span className="text-ink-3 truncate font-mono text-[11.5px]">
                            {comment.authorHandle}
                        </span>
                    )}
                    {comment.isOwn && <span className="text-ink-3 text-xs">{t("yourReply")}</span>}
                    <span className="text-ink-3 text-xs">
                        {pending ? t("sending") : relativeTime(comment.createdAt)}
                    </span>
                    {done && !comment.isOwn && (
                        <span className="text-ink-3 inline-flex items-center gap-1 text-xs">
                            <span className="bg-success size-[6px] rounded-full" />
                            {t("handled")}
                        </span>
                    )}
                </div>
                <p
                    className={cn(
                        "mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-[1.45]",
                        done && !comment.isOwn ? "text-ink-3" : "text-ink-2"
                    )}
                >
                    {comment.text}
                </p>
                {!comment.isOwn && !pending && !readOnly && (
                    <div className="-ml-2 mt-1 flex flex-wrap items-center gap-1">
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            disabled={Boolean(blocker) || replying}
                            title={blocker ?? undefined}
                            onClick={() => {
                                onStartReply();
                                requestAnimationFrame(() => inputRef.current?.focus());
                            }}
                        >
                            {t("reply")}
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => onHandled(!done)}
                        >
                            {done ? t("reopen") : t("markDone")}
                        </Button>
                        {blocker && <span className="text-ink-3 text-xs">{blocker}</span>}
                    </div>
                )}
                {replying && channel && (
                    <form
                        className="mt-2 flex flex-col gap-2"
                        onSubmit={e => {
                            e.preventDefault();
                            onSendReply();
                        }}
                    >
                        <Textarea
                            ref={inputRef}
                            value={draft}
                            onChange={e => onDraft(e.target.value)}
                            rows={3}
                            placeholder={t("replyTo", { name: comment.authorName })}
                            aria-label={t("replyTo", { name: comment.authorName })}
                            className="text-[13px]"
                            onKeyDown={e => {
                                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                    e.preventDefault();
                                    onSendReply();
                                }
                                if (e.key === "Escape") onCancelReply();
                            }}
                        />
                        <div className="flex flex-wrap items-center gap-2">
                            <Button type="submit" size="sm" disabled={!draft.trim()}>
                                {t("replyAs", { name: channel.name })}
                            </Button>
                            <Button type="button" size="sm" variant="ghost" onClick={onCancelReply}>
                                {tc("cancel")}
                            </Button>
                            {replyError && (
                                <span role="alert" className="text-danger text-xs">
                                    {replyError}
                                </span>
                            )}
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}

/**
 * Comments on the posts that went out from here, as an inbox: grouped by
 * post, each comment with the channel's replies under it. Reply as the
 * channel without leaving the tab, or mark a comment done; Open shows what
 * still waits on someone.
 */
export function EngagementScreen() {
    const t = useTranslations("growth.brand");
    const errorText = useErrorText();
    const tc = useTranslations("common");
    const paths = useGrowthPaths();
    const router = useToolRouter();
    const pathname = useToolPathname();
    const params = useToolSearchParams();
    const filter: Filter = params.get("status") === "all" ? "all" : "open";

    const accounts = useResource("brand:accounts", () => brandApi.accounts());
    const res = useResource(`brand:comments:${filter}`, () =>
        brandApi.comments({ status: filter })
    );
    const emptyOpen = filter === "open" && res.data !== null && res.data.comments.length === 0;
    // An empty Open list is either "all done" or "nothing yet": ask once which.
    const everything = useResource(emptyOpen ? "brand:comments:all" : null, () =>
        brandApi.comments({ status: "all" })
    );
    const reload = res.reload;
    const sync = useBrandSync(
        useCallback(async () => {
            await reload();
        }, [reload])
    );

    const [replyingTo, setReplyingTo] = useState<string | null>(null);
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [replyError, setReplyError] = useState<string | null>(null);
    const [pending, setPending] = useState<Set<string>>(() => new Set());
    const tempSeq = useRef(1);

    const channels = useMemo(
        () => new Map((accounts.data?.channels ?? []).map(c => [c.id, c])),
        [accounts.data]
    );
    const comments = useMemo(() => res.data?.comments ?? [], [res.data]);
    const groups = useMemo(() => groupComments(comments), [comments]);
    const open = openCount(comments);

    // Open is an inbox: a thread with nothing waiting leaves it.
    const visible = (thread: CommentThread) =>
        filter === "all" ||
        [thread.root, ...thread.replies].some(c => isOpen(c) || pending.has(c.id)) ||
        thread.root.id === replyingTo ||
        thread.replies.some(r => r.id === replyingTo);
    const shown = groups
        .map(group => ({ ...group, threads: group.threads.filter(visible) }))
        .filter(group => group.threads.length > 0);

    const setFilter = (value: Filter) => {
        const next = new URLSearchParams(params.toString());
        if (value === "open") next.delete("status");
        else next.set("status", value);
        const s = next.toString();
        router.replace(s ? `${pathname}?${s}` : pathname);
    };

    const patch = (id: string, change: (c: BrandComment) => BrandComment) =>
        res.mutate(d => ({ ...d, comments: d.comments.map(c => (c.id === id ? change(c) : c)) }));

    const setHandled = async (comment: BrandComment, handled: boolean) => {
        const before = comment.handledAt;
        patch(comment.id, c => ({ ...c, handledAt: handled ? new Date().toISOString() : null }));
        try {
            const { comment: saved } = await brandApi.setHandled(comment.id, handled);
            patch(comment.id, () => saved);
            if (handled)
                toast(t("engagement.markedDone", { name: comment.authorName }), {
                    action: {
                        label: tc("actions.undo"),
                        onClick: () => void setHandled(saved, false),
                    },
                });
        } catch (e) {
            patch(comment.id, c => ({ ...c, handledAt: before }));
            toast.error(errorText(e, t("engagement.changeFailed")));
        }
    };

    const sendReply = async (parent: BrandComment) => {
        const channel = channels.get(parent.channelId);
        const text = (drafts[parent.id] ?? "").trim();
        if (!channel || !text) return;
        const tempId = `pending-${tempSeq.current++}`;
        const optimistic: BrandComment = {
            ...parent,
            id: tempId,
            parentId: parent.id,
            authorName: channel.name,
            authorHandle: channel.handle,
            text,
            createdAt: new Date().toISOString(),
            isOwn: true,
            handledAt: null,
        };
        setPending(p => new Set(p).add(tempId));
        res.mutate(d => ({ ...d, comments: [...d.comments, optimistic] }));
        setReplyingTo(null);
        setReplyError(null);
        setDrafts(d => ({ ...d, [parent.id]: "" }));
        try {
            const { comment: saved } = await brandApi.reply(parent.id, text);
            res.mutate(d => ({
                ...d,
                comments: d.comments.map(c => (c.id === tempId ? saved : c)),
            }));
            toast.success(t("engagement.replied", { name: channel.name }));
        } catch (e) {
            res.mutate(d => ({ ...d, comments: d.comments.filter(c => c.id !== tempId) }));
            setDrafts(d => ({ ...d, [parent.id]: text }));
            setReplyingTo(parent.id);
            setReplyError(errorText(e, t("engagement.replyFailed")));
        } finally {
            setPending(p => {
                const next = new Set(p);
                next.delete(tempId);
                return next;
            });
        }
    };

    const row = (comment: BrandComment) => (
        <CommentRow
            key={comment.id}
            comment={comment}
            channel={channels.get(comment.channelId)}
            pending={pending.has(comment.id)}
            replying={replyingTo === comment.id}
            draft={drafts[comment.id] ?? ""}
            replyError={replyingTo === comment.id ? replyError : null}
            onStartReply={() => {
                setReplyingTo(comment.id);
                setReplyError(null);
            }}
            onDraft={text => setDrafts(d => ({ ...d, [comment.id]: text }))}
            onCancelReply={() => {
                setReplyingTo(null);
                setReplyError(null);
            }}
            onSendReply={() => void sendReply(comment)}
            onHandled={handled => void setHandled(comment, handled)}
            readOnly={accounts.data?.canPublish === false}
        />
    );

    const canRead = (accounts.data?.channels ?? []).some(c => c.capabilities.comments);

    return (
        <div className="mx-auto flex max-w-[900px] flex-col gap-6">
            <PageHeader
                size="md"
                title={t("engagement.title")}
                sub={
                    res.data ? (
                        <>
                            {filter === "open"
                                ? t("engagement.subOpen", { count: open })
                                : t("engagement.subAll", {
                                      count: comments.filter(c => !c.isOwn).length,
                                      open,
                                  })}{" "}
                            · <SyncedAt at={res.data.syncedAt} />
                        </>
                    ) : undefined
                }
                actions={
                    <SyncButton
                        onClick={() => void sync.run()}
                        busy={sync.busy}
                        disabled={accounts.data?.canPublish === false}
                    />
                }
            />
            <SyncProblems errors={sync.errors} failure={sync.failure} />

            <ToggleGroup
                type="single"
                value={filter}
                onValueChange={v => {
                    if (v === "open" || v === "all") setFilter(v);
                }}
                size="sm"
                className="border-line bg-panel gap-0.5 self-start rounded-md border p-0.5"
                aria-label={t("engagement.showAria")}
            >
                <ToggleGroupItem
                    value="open"
                    className="data-[state=on]:shadow-1 h-7 rounded-[5px] px-2.5 text-xs"
                >
                    {t("engagement.open")}
                    {filter === "open" && res.data && (
                        <span className="text-ink-3 ml-1.5 text-[11px] tabular-nums">{open}</span>
                    )}
                </ToggleGroupItem>
                <ToggleGroupItem
                    value="all"
                    className="data-[state=on]:shadow-1 h-7 rounded-[5px] px-2.5 text-xs"
                >
                    {tc("status.all")}
                </ToggleGroupItem>
            </ToggleGroup>

            {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}

            {res.loading ? (
                <SkeletonRows rows={4} height={72} />
            ) : accounts.data && !canRead ? (
                <EmptyState
                    title={t("engagement.noRead")}
                    body={t("engagement.noReadBody")}
                    action={
                        <Button asChild size="sm">
                            <ToolLink href={paths.brand("/accounts")}>
                                {t("common.openAccounts")}
                            </ToolLink>
                        </Button>
                    }
                />
            ) : shown.length === 0 ? (
                filter === "open" &&
                (comments.length > 0 || (everything.data?.comments.length ?? 0) > 0) ? (
                    <EmptyState
                        title={t("engagement.allDone")}
                        body={t("engagement.allDoneBody")}
                        action={
                            <Button asChild size="sm" variant="outline">
                                <ToolLink href={`${pathname}?status=all`}>
                                    {t("engagement.showAll")}
                                </ToolLink>
                            </Button>
                        }
                    />
                ) : filter === "open" && everything.loading ? (
                    <SkeletonRows rows={2} height={72} />
                ) : (
                    <EmptyState
                        title={t("engagement.noComments")}
                        body={t("engagement.noCommentsBody")}
                        action={
                            <SyncButton
                                onClick={() => void sync.run()}
                                busy={sync.busy}
                                disabled={accounts.data?.canPublish === false}
                            />
                        }
                    />
                )
            ) : (
                <div className="flex flex-col gap-5">
                    {shown.map(group => {
                        const channel = channels.get(group.channelId);
                        return (
                            <section
                                key={group.postId}
                                aria-label={t("engagement.commentsOn", {
                                    excerpt: group.postExcerpt,
                                })}
                                className="border-line bg-panel overflow-hidden rounded-lg border"
                            >
                                <header className="border-line-2 flex items-center gap-2.5 border-b px-4 py-2.5">
                                    {channel ? (
                                        <ChannelAvatar
                                            name={channel.name}
                                            kind={channel.kind}
                                            avatarUrl={channel.avatarUrl}
                                            size={20}
                                        />
                                    ) : (
                                        <NetworkMark platform={group.platform} size={20} />
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <p className="text-ink truncate text-[13px]">
                                            {group.postExcerpt}
                                        </p>
                                        <p className="text-ink-3 truncate text-xs">
                                            {channel?.name ?? NETWORK_LABEL[group.platform]}
                                            {" · "}
                                            {group.open > 0
                                                ? t("engagement.groupOpen", { count: group.open })
                                                : t("engagement.groupDone")}
                                        </p>
                                    </div>
                                    {group.postUrl && (
                                        <Button
                                            asChild
                                            size="sm"
                                            variant="ghost"
                                            className="shrink-0"
                                        >
                                            <a
                                                href={group.postUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                {t("common.openOn", {
                                                    network: NETWORK_LABEL[group.platform],
                                                })}
                                                <ExternalLink className="size-3.5" aria-hidden />
                                            </a>
                                        </Button>
                                    )}
                                </header>
                                <div className="flex flex-col">
                                    {group.threads.map(thread => (
                                        <div
                                            key={thread.root.id}
                                            className="border-line-2 flex flex-col gap-3 border-t px-4 py-3 first:border-t-0"
                                        >
                                            {row(thread.root)}
                                            {thread.replies.length > 0 && (
                                                <div className="border-line-2 ml-[13px] flex flex-col gap-3 border-l pl-[26px]">
                                                    {thread.replies.map(row)}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </section>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
