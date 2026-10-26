"use client";

import { MessageCircle, Pin, Repeat2, ThumbsDown, ThumbsUp, Zap } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import type {
    ScenarioComment,
    ScenarioDetail,
    ScenarioPerson,
    ScenarioPost,
    ScenarioRoundStats,
} from "~/lib/scenarios/types";
import { cn } from "~/lib/utils";

import {
    STANCE_BG,
    STANCES,
    atHandle,
    formatSigned,
    isLive,
    moodLabel,
} from "~/lib/scenarios/words";
import { mostVocal, movedTo } from "../_lib/people";
import { Shift, StanceDot } from "./Bits";
import { PersonHoverCard, Portrait } from "./Portrait";

const PAGE = 60;
/** Replies shown under a post before "Show more replies". */
const REPLIES = 2;

type FeedT = ReturnType<typeof useTranslations<"scenarios.feed">>;

/** Who is behind a post, a reply or a quoted post, found by id or by handle. */
interface Cast {
    byId: Map<string, ScenarioPerson>;
    byHandle: Map<string, ScenarioPerson>;
    posts: Map<string, ScenarioPost>;
    onPerson: (personId: string) => void;
    jump: (postId: string) => boolean;
}

const handleKey = (handle: string) => handle.replace(/^@+/, "").toLowerCase();

/**
 * The run as the network saw it: one timeline, oldest first, the situation
 * pinned at the top and a band where each round begins. Posts read the way
 * they would on a real network — a face, a name that shows the person on
 * hover, replies threaded underneath, reposts and quotes showing what they
 * point at — and a post where its author changed their mind says so. Beside
 * it, the rounds to jump between and the people who said the most. A post
 * jumped to from the report scrolls into view and is lit for a moment.
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
    const [round, setRound] = useState<string>("all");
    const [limit, setLimit] = useState(PAGE);
    const [highlight, setHighlight] = useState<string | null>(null);
    const roundNumbers = useMemo(
        () => [...new Set(run.posts.map(p => p.round))].sort((a, b) => a - b),
        [run.posts]
    );
    const filtered = useMemo(
        () => (round === "all" ? run.posts : run.posts.filter(p => p.round === Number(round))),
        [run.posts, round]
    );

    // Show every round, make sure the post is rendered, then light it; the
    // effect below scrolls once the render that shows it has happened.
    const show = useCallback(
        (postId: string) => {
            const index = run.posts.findIndex(p => p.id === postId);
            if (index === -1) return false;
            setRound("all");
            setLimit(l => Math.max(l, index + 10));
            setHighlight(postId);
            return true;
        },
        [run.posts]
    );
    const handled = useRef<string | null>(null);
    useEffect(() => {
        if (!focusPost || handled.current === focusPost) return;
        if (show(focusPost)) handled.current = focusPost;
    }, [focusPost, show]);
    useEffect(() => {
        if (!highlight) return;
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        document
            .getElementById(`scenario-post-${highlight}`)
            ?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
        const timer = window.setTimeout(() => setHighlight(null), 2600);
        return () => window.clearTimeout(timer);
    }, [highlight]);

    const cast = useMemo<Cast>(
        () => ({
            byId: new Map(run.people.map(p => [p.id, p])),
            byHandle: new Map(run.people.map(p => [handleKey(p.handle), p])),
            posts: new Map(run.posts.map(p => [p.id, p])),
            onPerson,
            jump: show,
        }),
        [run.people, run.posts, onPerson, show]
    );

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
    // A person's change of mind is marked once a round, on the first thing they posted in it.
    const marked = new Set<string>();

    return (
        <div className="@max-lg:grid-cols-1 grid grid-cols-[minmax(0,680px)_minmax(0,260px)] items-start gap-8">
            <div className="flex min-w-0 flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-ink-3 text-xs">
                        {t("counts", {
                            posts: run.posts.length,
                            comments: run.posts.reduce((n, p) => n + p.comments.length, 0),
                        })}
                    </span>
                    <Select value={round} onValueChange={setRound}>
                        <SelectTrigger
                            className="@max-lg:flex hidden h-8 w-[160px] text-[13px]"
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

                <div className="border-line bg-panel overflow-hidden rounded-xl border">
                    {groups.map((group, gi) => (
                        <section
                            key={group.round}
                            aria-label={
                                group.round === 0
                                    ? t("opening")
                                    : t("round", { round: group.round })
                            }
                        >
                            {group.round > 0 && (
                                <RoundBand
                                    round={group.round}
                                    stats={run.roundStats.find(r => r.round === group.round)}
                                    first={gi === 0}
                                />
                            )}
                            {group.posts.map(post => {
                                const author = cast.byId.get(post.authorId);
                                const key = `${post.authorId}:${post.round}`;
                                const shift =
                                    post.authorKind === "agent" && !marked.has(key)
                                        ? movedTo(author, post.round)
                                        : null;
                                if (shift !== null) marked.add(key);
                                return (
                                    <FeedItem
                                        key={post.id}
                                        post={post}
                                        author={author}
                                        cast={cast}
                                        shift={shift}
                                        highlighted={highlight === post.id}
                                    />
                                );
                            })}
                        </section>
                    ))}
                </div>

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

            <aside className="@max-lg:hidden sticky top-4 flex min-w-0 flex-col gap-7">
                <RoundsNav
                    run={run}
                    rounds={roundNumbers}
                    value={round}
                    onChange={r => {
                        setRound(r);
                        setLimit(PAGE);
                    }}
                />
                <MostVocal run={run} onPerson={onPerson} />
            </aside>
        </div>
    );
}

/** Where a round starts in the timeline, with how the room felt after it. */
function RoundBand({
    round,
    stats,
    first,
}: {
    round: number;
    stats: ScenarioRoundStats | undefined;
    first: boolean;
}) {
    const t = useTranslations("scenarios.feed");
    const tw = useTranslations("scenarios.words");
    const locale = useLocale();
    return (
        <div
            className={cn(
                "bg-panel-2 border-line-2 flex items-center justify-between gap-3 border-b px-4 py-2",
                !first && "border-t"
            )}
        >
            <h3 className="text-ink text-[12.5px] font-semibold">{t("round", { round })}</h3>
            {stats && (
                <span className="text-ink-3 flex min-w-0 items-center gap-2 text-xs">
                    <span className="@max-sm:hidden truncate tabular-nums">
                        {t("roundMeta", { posts: stats.posts, comments: stats.comments })}
                    </span>
                    <MoodBar counts={stats.stanceCounts} />
                    <span
                        className="whitespace-nowrap"
                        title={formatSigned(stats.meanStance, locale)}
                    >
                        {moodLabel(tw, stats.meanStance)}
                    </span>
                </span>
            )}
        </div>
    );
}

/** People at each stance after a round, critical to supportive, as one thin bar. */
function MoodBar({
    counts,
    className,
}: {
    counts: ScenarioRoundStats["stanceCounts"];
    className?: string;
}) {
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    return (
        <span
            aria-hidden
            className={cn(
                "bg-panel flex h-1.5 w-14 shrink-0 overflow-hidden rounded-full",
                className
            )}
        >
            {STANCES.map((s, i) =>
                counts[i] ? (
                    <span
                        key={s}
                        className={cn("h-full", STANCE_BG[s])}
                        style={{ width: `${(100 * counts[i]) / total}%` }}
                    />
                ) : null
            )}
        </span>
    );
}

/** A face that opens the person, showing who they are on hover. */
function Face({
    handle,
    person,
    kind = "agent",
    size,
    cast,
}: {
    handle: string;
    person: ScenarioPerson | undefined;
    kind?: ScenarioPost["authorKind"];
    size: number;
    cast: Cast;
}) {
    const t = useTranslations("scenarios.feed");
    if (!person || kind !== "agent") {
        return <Portrait handle={handle} kind={kind} size={size} />;
    }
    return (
        <PersonHoverCard person={person}>
            <button
                type="button"
                onClick={() => cast.onPerson(person.id)}
                aria-label={t("openProfile", { name: person.name })}
                className="focus-visible:ring-brand/50 shrink-0 rounded-full outline-none focus-visible:ring-2"
            >
                <Portrait handle={handle} size={size} />
            </button>
        </PersonHoverCard>
    );
}

/** A name that opens the person, showing who they are on hover. */
function Name({
    name,
    person,
    cast,
    className,
}: {
    name: string;
    person: ScenarioPerson | undefined;
    cast: Cast;
    className?: string;
}) {
    if (!person) {
        return <span className={cn("text-ink truncate font-semibold", className)}>{name}</span>;
    }
    return (
        <PersonHoverCard person={person}>
            <button
                type="button"
                onClick={() => cast.onPerson(person.id)}
                className={cn(
                    "text-ink focus-visible:ring-brand/50 truncate rounded-sm font-semibold outline-none hover:underline focus-visible:ring-2",
                    className
                )}
            >
                {name}
            </button>
        </PersonHoverCard>
    );
}

function Count({ icon: Icon, n, label }: { icon: typeof ThumbsUp; n: number; label: string }) {
    return (
        <span className="inline-flex min-w-[2.5rem] items-center gap-1.5 tabular-nums">
            <Icon className="size-4" aria-hidden />
            {n > 0 && <span aria-hidden>{n}</span>}
            <span className="sr-only">{label}</span>
        </span>
    );
}

function Actions({ post, t }: { post: ScenarioPost; t: FeedT }) {
    return (
        <div className="text-ink-3 mt-2.5 flex items-center gap-6 text-[13px]">
            <Count
                icon={MessageCircle}
                n={post.comments.length}
                label={t("comments", { count: post.comments.length })}
            />
            <Count icon={Repeat2} n={post.shares} label={t("shares", { count: post.shares })} />
            <Count icon={ThumbsUp} n={post.likes} label={t("likes", { count: post.likes })} />
            <Count
                icon={ThumbsDown}
                n={post.dislikes}
                label={t("dislikes", { count: post.dislikes })}
            />
        </div>
    );
}

/**
 * One post in the timeline with its replies. A repost shows the post it
 * passes on under the reposter's name, the way networks do; a quote embeds
 * what it quotes, and the embed goes to it.
 */
function FeedItem({
    post,
    author,
    cast,
    shift,
    highlighted,
}: {
    post: ScenarioPost;
    author: ScenarioPerson | undefined;
    cast: Cast;
    shift: ScenarioPerson["stance"] | null;
    highlighted: boolean;
}) {
    const t = useTranslations("scenarios.feed");
    const [open, setOpen] = useState(false);
    const repost = post.kind === "repost" && post.root !== null;
    const original = repost ? cast.posts.get(post.root!.id) : undefined;
    // What the row shows: the reposted post under its own author, or this post.
    const shownHandle = repost ? post.root!.authorHandle : post.authorHandle;
    const shownPerson = repost ? cast.byHandle.get(handleKey(shownHandle)) : author;
    const shownName = repost
        ? (original?.authorName ?? shownPerson?.name ?? atHandle(shownHandle))
        : post.authorName;
    const shownKind = repost ? (original?.authorKind ?? "agent") : post.authorKind;
    const text = repost ? post.root!.text : post.text;
    const seed = post.kind === "seed";
    const event = post.kind === "event";
    const replies = post.comments;
    const visible = open ? replies : replies.slice(0, REPLIES);
    const eyebrow = seed
        ? post.authorKind === "brand"
            ? t("tag.draft")
            : t("tag.situation")
        : event
          ? t("tag.event")
          : repost
            ? t("reposted", { name: post.authorName })
            : null;

    return (
        <article
            id={`scenario-post-${post.id}`}
            aria-label={
                eyebrow ? t("postAria", { name: post.authorName, tag: eyebrow }) : post.authorName
            }
            className={cn(
                "border-line-2 border-t px-4 pb-3 pt-3.5 transition-colors duration-500 first:border-t-0",
                event && "bg-warn-soft/40",
                highlighted && "bg-brand-soft"
            )}
        >
            {eyebrow && (
                <div
                    className={cn(
                        "mb-1.5 flex items-center gap-1.5 pl-[52px] text-xs",
                        event ? "text-warn-ink font-medium" : "text-ink-3"
                    )}
                >
                    {seed ? (
                        <Pin className="size-3.5" aria-hidden />
                    ) : event ? (
                        <Zap className="size-3.5" aria-hidden />
                    ) : (
                        <Repeat2 className="size-3.5" aria-hidden />
                    )}
                    {eyebrow}
                </div>
            )}
            <div className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-3">
                <div className="flex flex-col items-center">
                    <Face
                        handle={shownHandle}
                        person={shownPerson}
                        kind={shownKind}
                        size={40}
                        cast={cast}
                    />
                    {replies.length > 0 && (
                        <span
                            aria-hidden
                            className="bg-ink-4/35 mt-1.5 w-0.5 flex-1 rounded-full"
                        />
                    )}
                </div>
                <div className="min-w-0">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex min-w-0 items-baseline gap-x-1.5 text-[14px]">
                                <Name name={shownName} person={shownPerson} cast={cast} />
                                {shownKind === "agent" && (
                                    <span className="text-ink-3 truncate text-[13px]">
                                        {atHandle(shownHandle)}
                                    </span>
                                )}
                            </div>
                            {shownPerson?.role && (
                                <div className="text-ink-3 truncate text-xs">
                                    {shownPerson.role}
                                </div>
                            )}
                        </div>
                        {shift !== null && author && (
                            <Shift
                                from={author.stanceHistory[post.round - 1] ?? author.startStance}
                                to={shift}
                                className="@max-sm:hidden mt-0.5"
                            />
                        )}
                    </div>
                    {text && (
                        <p
                            className={cn(
                                "text-ink mt-1.5 whitespace-pre-wrap break-words leading-[1.5]",
                                seed || event ? "text-[15.5px] font-medium" : "text-[15px]"
                            )}
                        >
                            {text}
                        </p>
                    )}
                    {post.kind === "quote" && post.root && (
                        <QuotedPost root={post.root} cast={cast} />
                    )}
                    {repost ? (
                        original && <Actions post={original} t={t} />
                    ) : (
                        <Actions post={post} t={t} />
                    )}
                </div>
            </div>

            {visible.length > 0 && (
                <ol aria-label={t("commentsLabel")}>
                    {visible.map((comment, i) => (
                        <Reply
                            key={comment.id}
                            comment={comment}
                            postRound={post.round}
                            cast={cast}
                            last={i === visible.length - 1}
                        />
                    ))}
                </ol>
            )}
            {replies.length > REPLIES && (
                <div className="pl-[52px] pt-1.5">
                    <button
                        type="button"
                        onClick={() => setOpen(o => !o)}
                        aria-expanded={open}
                        className="text-brand-ink focus-visible:ring-brand/50 rounded-sm text-[13px] outline-none hover:underline focus-visible:ring-2"
                    >
                        {open
                            ? t("fewerReplies")
                            : t("moreReplies", { count: replies.length - REPLIES })}
                    </button>
                </div>
            )}
        </article>
    );
}

/** A reply under a post, joined to it by the thread line. */
function Reply({
    comment,
    postRound,
    cast,
    last,
}: {
    comment: ScenarioComment;
    postRound: number;
    cast: Cast;
    last: boolean;
}) {
    const t = useTranslations("scenarios.feed");
    const person = cast.byId.get(comment.authorId);
    return (
        <li className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-3">
            <div className="flex flex-col items-center">
                <span aria-hidden className="bg-ink-4/35 h-2.5 w-0.5" />
                <Face handle={comment.authorHandle} person={person} size={28} cast={cast} />
                {!last && <span aria-hidden className="bg-ink-4/35 w-0.5 flex-1" />}
            </div>
            <div className="min-w-0 pb-1 pt-2.5">
                <div className="flex min-w-0 items-baseline gap-x-1.5 text-[13.5px]">
                    <Name name={comment.authorName} person={person} cast={cast} />
                    <span className="text-ink-3 truncate text-[12.5px]">
                        {atHandle(comment.authorHandle)}
                        {comment.round !== postRound && (
                            <> · {t("roundLower", { round: comment.round })}</>
                        )}
                    </span>
                </div>
                <p className="text-ink mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-snug">
                    {comment.text}
                </p>
            </div>
        </li>
    );
}

/** The post a quote quotes, as a card that goes to it. */
function QuotedPost({ root, cast }: { root: NonNullable<ScenarioPost["root"]>; cast: Cast }) {
    const t = useTranslations("scenarios.feed");
    const original = cast.posts.get(root.id);
    const kind = original?.authorKind ?? "agent";
    const person = cast.byHandle.get(handleKey(root.authorHandle));
    const name = original?.authorName ?? person?.name ?? atHandle(root.authorHandle);
    const body = (
        <>
            <span className="flex min-w-0 items-center gap-1.5 text-[13px]">
                <Portrait handle={root.authorHandle} kind={kind} size={20} />
                <span className="text-ink truncate font-semibold">{name}</span>
                {kind === "agent" && (
                    <span className="text-ink-3 truncate">{atHandle(root.authorHandle)}</span>
                )}
            </span>
            <span className="text-ink-2 mt-1 line-clamp-4 block whitespace-pre-wrap text-[14px] leading-snug">
                {root.text}
            </span>
        </>
    );
    const className = "border-line mt-2.5 block w-full rounded-xl border px-3 py-2.5 text-left";
    return original ? (
        <button
            type="button"
            onClick={() => cast.jump(root.id)}
            aria-label={t("quotedAria", { name })}
            className={cn(
                className,
                "hover:bg-panel-2 focus-visible:ring-brand/50 outline-none transition-colors focus-visible:ring-2"
            )}
        >
            {body}
        </button>
    ) : (
        <div className={className}>{body}</div>
    );
}

/** The rounds to read, each with how the room felt after it. */
function RoundsNav({
    run,
    rounds,
    value,
    onChange,
}: {
    run: ScenarioDetail;
    rounds: number[];
    value: string;
    onChange: (round: string) => void;
}) {
    const t = useTranslations("scenarios.feed");
    const counts = new Map<number, number>();
    for (const p of run.posts) counts.set(p.round, (counts.get(p.round) ?? 0) + 1);
    const item = (key: string, label: string, n: number, stats?: ScenarioRoundStats) => (
        <li key={key}>
            <button
                type="button"
                onClick={() => onChange(key)}
                aria-current={value === key ? "true" : undefined}
                className={cn(
                    "focus-visible:ring-brand/50 flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] outline-none focus-visible:ring-2",
                    value === key
                        ? "bg-panel-2 text-ink font-medium"
                        : "text-ink-2 hover:bg-panel-2/60 hover:text-ink"
                )}
            >
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {stats && <MoodBar counts={stats.stanceCounts} className="w-10" />}
                <span className="text-ink-3 w-6 text-right text-xs tabular-nums">{n}</span>
            </button>
        </li>
    );
    return (
        <nav aria-label={t("showRound")}>
            <h3 className="text-ink-3 mb-1.5 px-2.5 text-xs font-medium">{t("rounds")}</h3>
            <ul className="flex flex-col gap-px">
                {item("all", t("allRounds"), run.posts.length)}
                {rounds.map(r =>
                    item(
                        String(r),
                        r === 0 ? t("opening") : t("round", { round: r }),
                        counts.get(r) ?? 0,
                        run.roundStats.find(s => s.round === r)
                    )
                )}
            </ul>
        </nav>
    );
}

/** The people who did the talking, as a social network's "who to follow". */
function MostVocal({
    run,
    onPerson,
}: {
    run: ScenarioDetail;
    onPerson: (personId: string) => void;
}) {
    const t = useTranslations("scenarios.feed");
    const people = useMemo(() => mostVocal(run.people, run.posts, 5), [run.people, run.posts]);
    if (people.length === 0) return null;
    return (
        <section>
            <h3 className="text-ink-3 mb-1.5 px-2.5 text-xs font-medium">{t("mostVocal")}</h3>
            <ul className="flex flex-col gap-px">
                {people.map(person => (
                    <li key={person.id}>
                        <button
                            type="button"
                            onClick={() => onPerson(person.id)}
                            className="hover:bg-panel-2/60 focus-visible:ring-brand/50 flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left outline-none focus-visible:ring-2"
                        >
                            <Portrait handle={person.handle} size={34} />
                            <span className="min-w-0 flex-1">
                                <span className="text-ink block truncate text-[13px] font-semibold">
                                    {person.name}
                                </span>
                                <span className="text-ink-3 block truncate text-xs">
                                    {person.role}
                                </span>
                            </span>
                            <StanceDot stance={person.stance} />
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}
