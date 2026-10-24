"use client";

import { MessageSquare, Repeat2, ThumbsDown, ThumbsUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import type { ScenarioDetail, ScenarioPerson, ScenarioPost } from "~/lib/scenarios/types";
import { cn } from "~/lib/utils";

import { atHandle, formatSigned, isLive, moodLabel } from "~/lib/scenarios/words";
import { Monogram } from "./Bits";

const PAGE = 60;

/**
 * Everything people posted, oldest first, under a header per round. The
 * opening post and events added during the run are set apart; reposts and
 * quotes show what they point at; comments sit under their post. A post
 * jumped to from the report scrolls into view and is outlined for a moment.
 */
export function FeedTab({
    run,
    focusPost,
    onPerson,
}: {
    run: ScenarioDetail;
    focusPost: string | null;
    onPerson: (personId: string) => void;
}) {
    const t = useTranslations("scenarios.feed");
    const tw = useTranslations("scenarios.words");
    const locale = useLocale();
    const [round, setRound] = useState<string>("all");
    const [limit, setLimit] = useState(PAGE);
    const [highlight, setHighlight] = useState<string | null>(null);
    const people = useMemo(() => new Map(run.people.map(p => [p.id, p])), [run.people]);
    const roundNumbers = useMemo(
        () => [...new Set(run.posts.map(p => p.round))].sort((a, b) => a - b),
        [run.posts]
    );

    const filtered = useMemo(
        () => (round === "all" ? run.posts : run.posts.filter(p => p.round === Number(round))),
        [run.posts, round]
    );

    // A post jumped to: show every round, make sure it is rendered, then
    // scroll to it and outline it for a moment.
    const handled = useRef<string | null>(null);
    useEffect(() => {
        if (!focusPost || handled.current === focusPost) return;
        const index = run.posts.findIndex(p => p.id === focusPost);
        if (index === -1) return;
        handled.current = focusPost;
        setRound("all");
        setLimit(l => Math.max(l, index + 10));
        setHighlight(focusPost);
    }, [focusPost, run.posts]);
    // Runs after the render that shows it, so the post is in the page.
    useEffect(() => {
        if (!highlight) return;
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        document
            .getElementById(`scenario-post-${highlight}`)
            ?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
        const timer = window.setTimeout(() => setHighlight(null), 2600);
        return () => window.clearTimeout(timer);
    }, [highlight]);

    if (run.posts.length === 0) {
        return (
            <p className="text-ink-3 text-[13px]">
                {isLive(run.status) ? t("emptyLive") : t("empty")}
            </p>
        );
    }

    const shown = filtered.slice(0, limit);
    const groups: Array<{ round: number; posts: ScenarioPost[] }> = [];
    for (const post of shown) {
        const last = groups[groups.length - 1];
        if (last && last.round === post.round) last.posts.push(post);
        else groups.push({ round: post.round, posts: [post] });
    }

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-ink-3 text-xs">
                    {t("counts", {
                        posts: run.posts.length,
                        comments: run.posts.reduce((n, p) => n + p.comments.length, 0),
                    })}
                </span>
                <Select value={round} onValueChange={setRound}>
                    <SelectTrigger
                        className="h-8 w-[160px] text-[13px]"
                        aria-label={t("showRound")}
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">{t("allRounds")}</SelectItem>
                        {roundNumbers.map(r => (
                            <SelectItem key={r} value={String(r)}>
                                {r === 0 ? t("opening") : t("round", { round: r })}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {groups.map(group => {
                const stats = run.roundStats.find(r => r.round === group.round);
                return (
                    <section
                        key={group.round}
                        aria-label={
                            group.round === 0 ? t("opening") : t("round", { round: group.round })
                        }
                    >
                        <div className="border-line-2 mb-2.5 flex items-baseline justify-between gap-3 border-b pb-1.5">
                            <h3 className="text-ink text-[13px] font-semibold">
                                {group.round === 0
                                    ? t("opening")
                                    : t("round", { round: group.round })}
                            </h3>
                            {stats && (
                                <span className="text-ink-3 text-xs tabular-nums">
                                    {t("roundStats", {
                                        posts: stats.posts,
                                        comments: stats.comments,
                                        mean: formatSigned(stats.meanStance, locale),
                                        mood: moodLabel(tw, stats.meanStance),
                                    })}
                                </span>
                            )}
                        </div>
                        <div className="flex flex-col gap-2.5">
                            {group.posts.map(post => (
                                <PostCard
                                    key={post.id}
                                    post={post}
                                    author={people.get(post.authorId)}
                                    highlighted={highlight === post.id}
                                    onPerson={onPerson}
                                />
                            ))}
                        </div>
                    </section>
                );
            })}

            {filtered.length > limit && (
                <Button
                    variant="outline"
                    size="sm"
                    className="self-center"
                    onClick={() => setLimit(l => l + PAGE)}
                >
                    {t("showMore", { count: Math.min(PAGE, filtered.length - limit) })}
                </Button>
            )}
        </div>
    );
}

function Count({ icon: Icon, n, label }: { icon: typeof ThumbsUp; n: number; label: string }) {
    return (
        <span className="inline-flex items-center gap-1 tabular-nums" title={label}>
            <Icon className="size-3.5" aria-hidden />
            {n}
            <span className="sr-only">{label}</span>
        </span>
    );
}

export function PostCard({
    post,
    author,
    highlighted = false,
    onPerson,
    compact = false,
}: {
    post: ScenarioPost;
    author: ScenarioPerson | undefined;
    highlighted?: boolean;
    onPerson?: (personId: string) => void;
    compact?: boolean;
}) {
    const t = useTranslations("scenarios.feed");
    const special = post.authorKind !== "agent";
    const tag =
        post.kind === "seed"
            ? post.authorKind === "brand"
                ? t("tag.draft")
                : t("tag.situation")
            : post.kind === "event"
              ? t("tag.event")
              : post.kind === "repost"
                ? t("tag.repost")
                : post.kind === "quote"
                  ? t("tag.quote")
                  : null;
    const name =
        author && onPerson ? (
            <button
                type="button"
                onClick={() => onPerson(author.id)}
                className="text-ink hover:text-brand-ink focus-visible:ring-brand/50 truncate rounded-sm text-[13px] font-semibold outline-none focus-visible:ring-2"
            >
                {post.authorName}
            </button>
        ) : (
            <span className="text-ink truncate text-[13px] font-semibold">{post.authorName}</span>
        );

    return (
        <article
            id={`scenario-post-${post.id}`}
            aria-label={
                tag
                    ? t("postAria", { name: post.authorName, tag: tag.toLowerCase() })
                    : post.authorName
            }
            className={cn(
                "rounded-lg border p-3.5 transition-shadow duration-200",
                special ? "border-line bg-panel-2 border-dashed" : "border-line bg-panel",
                highlighted && "ring-brand/60 ring-2"
            )}
        >
            <header className="flex items-start gap-2.5">
                <Monogram name={post.authorName} kind={post.authorKind} size={compact ? 26 : 32} />
                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                        {name}
                        {post.authorKind === "agent" && (
                            <span className="text-ink-3 truncate text-xs">
                                {atHandle(post.authorHandle)}
                            </span>
                        )}
                    </div>
                    <div className="text-ink-3 truncate text-xs">
                        {[
                            tag,
                            author?.role,
                            compact
                                ? post.round === 0
                                    ? t("openingLower")
                                    : t("roundLower", { round: post.round })
                                : null,
                        ]
                            .filter(Boolean)
                            .join(" · ")}
                    </div>
                </div>
            </header>
            {post.text && (
                <p className="text-ink mt-2 whitespace-pre-wrap break-words text-[13.5px] leading-[1.5]">
                    {post.text}
                </p>
            )}
            {post.root && (
                <blockquote className="border-line bg-surface mt-2 rounded-md border px-3 py-2 text-[13px] leading-snug">
                    <span className="text-ink-3 text-xs">{atHandle(post.root.authorHandle)}</span>
                    <p className="text-ink-2 mt-0.5 line-clamp-4 whitespace-pre-wrap">
                        {post.root.text}
                    </p>
                </blockquote>
            )}
            {post.kind !== "repost" && (
                <div className="text-ink-3 mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <Count
                        icon={ThumbsUp}
                        n={post.likes}
                        label={t("likes", { count: post.likes })}
                    />
                    <Count
                        icon={ThumbsDown}
                        n={post.dislikes}
                        label={t("dislikes", { count: post.dislikes })}
                    />
                    <Count
                        icon={Repeat2}
                        n={post.shares}
                        label={t("shares", { count: post.shares })}
                    />
                    <Count
                        icon={MessageSquare}
                        n={post.comments.length}
                        label={t("comments", { count: post.comments.length })}
                    />
                </div>
            )}
            {!compact && post.comments.length > 0 && (
                <ol
                    className="border-line mt-3 flex flex-col gap-2 border-l pl-3"
                    aria-label={t("commentsLabel")}
                >
                    {post.comments.map(c => (
                        <li key={c.id} className="text-[13px] leading-snug">
                            {onPerson ? (
                                <button
                                    type="button"
                                    onClick={() => onPerson(c.authorId)}
                                    className="text-ink hover:text-brand-ink focus-visible:ring-brand/50 rounded-sm font-medium outline-none focus-visible:ring-2"
                                >
                                    {c.authorName}
                                </button>
                            ) : (
                                <span className="text-ink font-medium">{c.authorName}</span>
                            )}{" "}
                            <span className="text-ink-3 text-xs">
                                {atHandle(c.authorHandle)}
                                {c.round !== post.round
                                    ? ` · ${t("roundLower", { round: c.round })}`
                                    : ""}
                            </span>
                            <p className="text-ink-2 mt-0.5">{c.text}</p>
                        </li>
                    ))}
                </ol>
            )}
        </article>
    );
}
