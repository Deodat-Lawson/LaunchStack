"use client";

import { useState } from "react";
import { Clock, KeyRound, MessageSquarePlus, RotateCcw, ShieldOff, TimerOff } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

import {
    Ago,
    CallLog,
    Monogram,
    StandInBanner,
    Stat,
    StoredImage,
    useStandInState,
} from "../shared/ui";
import type { BlueskySnapshot, BlueskySnapshotPost } from "./world";

type Act = (label: string, body: Record<string, unknown>) => Promise<void>;

/** What an app has posted to the Bluesky stand-in, with its replies and sessions. */
export function BlueskyStandIn({
    initial,
    base,
    origin,
}: {
    initial: BlueskySnapshot;
    base: string;
    origin: string;
}) {
    const { state, busy, error, act } = useStandInState(base, initial);
    const { now } = state;

    return (
        <div className="bg-surface text-ink min-h-dvh">
            <StandInBanner network="Bluesky" />
            <header className="border-line bg-panel border-b">
                <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4">
                    <div className="min-w-0">
                        <h1 className="display text-lg font-semibold">Bluesky stand-in</h1>
                        <p className="text-ink-3 text-sm">
                            Posts and replies on this development imitation of a Bluesky PDS and
                            AppView.
                        </p>
                    </div>
                    <div className="ml-auto flex flex-wrap gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={busy !== null}
                            onClick={() => void act("age", { action: "age", minutes: 60 })}
                        >
                            <Clock /> Age 1 hour
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={busy !== null}
                            onClick={() => void act("expire", { action: "expire-access" })}
                        >
                            <TimerOff /> Expire access tokens
                        </Button>
                        <Button
                            variant="destructive"
                            size="sm"
                            disabled={busy !== null}
                            onClick={() => void act("revoke", { action: "revoke-sessions" })}
                        >
                            <ShieldOff /> Revoke sessions
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy !== null}
                            onClick={() => void act("reset", { action: "reset" })}
                        >
                            <RotateCcw /> Reset
                        </Button>
                    </div>
                </div>
                {error ? (
                    <p className="text-danger mx-auto max-w-6xl px-4 pb-3 text-sm">{error}</p>
                ) : null}
            </header>

            <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                <section aria-label="Posts" className="flex min-w-0 flex-col gap-4">
                    <h2 className="text-ink-2 text-sm font-semibold">
                        Posts <span className="text-ink-3 font-normal">· {state.posts.length}</span>
                    </h2>
                    {state.posts.length === 0 ? (
                        <Card className="text-ink-3 items-center gap-2 px-6 py-10 text-center text-sm">
                            <p className="text-ink-2 font-medium">Nothing posted yet.</p>
                            <p>
                                Connect Bluesky in Growth › Brand › Accounts with{" "}
                                <span className="font-mono">{state.account.handle}</span> and any
                                app password like{" "}
                                <span className="font-mono">abcd-1234-efgh-5678</span>.
                            </p>
                        </Card>
                    ) : (
                        state.posts.map(post => (
                            <PostCard key={post.uri} post={post} now={now} act={act} busy={busy} />
                        ))
                    )}
                </section>

                <aside className="flex min-w-0 flex-col gap-4">
                    <Card className="gap-3 p-5">
                        <h2 className="text-ink-2 text-sm font-semibold">Account</h2>
                        <div className="flex items-center gap-3">
                            <Monogram
                                src={state.account.avatar}
                                name={state.account.displayName}
                                className="size-10"
                            />
                            <div className="min-w-0">
                                <p className="font-medium">{state.account.displayName}</p>
                                <p className="text-ink-3 truncate text-xs">
                                    @{state.account.handle}
                                </p>
                                <p className="text-ink-3 truncate font-mono text-[11px]">
                                    {state.account.did}
                                </p>
                            </div>
                            <span className="text-ink-3 ml-auto text-[11px] tabular-nums">
                                {state.account.followers} followers
                            </span>
                        </div>
                    </Card>

                    <Card className="gap-2 p-5">
                        <h2 className="text-ink-2 text-sm font-semibold">Point the app here</h2>
                        <pre className="bg-panel-2 border-line text-ink-2 whitespace-pre-wrap break-all rounded-md border p-3 font-mono text-[11px] leading-relaxed">
                            {`BLUESKY_SERVICE_URL=${origin}${base}\nBLUESKY_APPVIEW_URL=${origin}${base}`}
                        </pre>
                        <p className="text-ink-3 text-xs">
                            Handle <span className="font-mono">{state.account.handle}</span>; any
                            password shaped <span className="font-mono">xxxx-xxxx-xxxx-xxxx</span>{" "}
                            (lowercase letters and digits).
                        </p>
                    </Card>

                    <Card className="gap-3 p-5">
                        <h2 className="text-ink-2 flex items-center gap-2 text-sm font-semibold">
                            <KeyRound className="size-4" aria-hidden /> Sessions
                        </h2>
                        {state.sessions.length === 0 ? (
                            <p className="text-ink-3 text-sm">None yet.</p>
                        ) : (
                            <ul className="divide-line flex flex-col divide-y">
                                {state.sessions.map(session => (
                                    <li
                                        key={session.id}
                                        className="flex items-center gap-2 py-2 text-[11px]"
                                    >
                                        <Badge
                                            variant={
                                                session.status === "active"
                                                    ? "success"
                                                    : session.status === "expired"
                                                      ? "warn"
                                                      : "destructive"
                                            }
                                        >
                                            {session.status}
                                        </Badge>
                                        <span className="text-ink-3">
                                            opened <Ago at={session.createdAt} now={now} /> · access{" "}
                                            {session.status === "expired" ? "expired " : "expires "}
                                            <Ago at={session.accessExpiresAt} now={now} />
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Card>

                    <Card className="gap-2 p-5">
                        <h2 className="text-ink-2 text-sm font-semibold">Recent XRPC calls</h2>
                        <CallLog calls={state.calls} now={now} />
                    </Card>
                </aside>
            </main>
        </div>
    );
}

function PostCard({
    post,
    now,
    act,
    busy,
}: {
    post: BlueskySnapshotPost;
    now: number;
    act: Act;
    busy: string | null;
}) {
    const [draft, setDraft] = useState("");
    const deleted = post.deletedAt !== null;
    return (
        <Card className={cn("gap-4 py-5", deleted && "opacity-60")}>
            <PostBody post={post} now={now} />
            <div className="border-line flex flex-wrap gap-6 border-t px-5 pt-3">
                <Stat label="Likes" value={post.counts.likeCount} />
                <Stat label="Reposts" value={post.counts.repostCount} />
                <Stat label="Replies" value={post.counts.replyCount} />
                <Stat label="Quotes" value={post.counts.quoteCount} />
            </div>
            <div className="flex flex-col gap-3 px-5">
                {post.replies.length > 0 ? (
                    <ul className="border-line flex flex-col gap-3 border-l pl-3">
                        {post.replies.map(reply => (
                            <ReplyItem key={reply.uri} post={reply} now={now} />
                        ))}
                    </ul>
                ) : null}
                {!deleted ? (
                    <form
                        className="flex gap-2"
                        onSubmit={event => {
                            event.preventDefault();
                            void act(`reply:${post.uri}`, {
                                action: "reply",
                                uri: post.uri,
                                text: draft,
                            }).then(() => setDraft(""));
                        }}
                    >
                        <Input
                            value={draft}
                            onChange={event => setDraft(event.target.value)}
                            placeholder="Reply text (blank for a canned one)"
                            aria-label={`Reply to ${post.uri}`}
                            className="h-8 text-sm"
                        />
                        <Button type="submit" variant="outline" size="sm" disabled={busy !== null}>
                            <MessageSquarePlus /> Add a reply
                        </Button>
                    </form>
                ) : null}
            </div>
        </Card>
    );
}

function PostBody({ post, now }: { post: BlueskySnapshotPost; now: number }) {
    return (
        <>
            <div className="flex items-start gap-3 px-5">
                <Monogram src={post.authorAvatar} name={post.authorName} className="size-10" />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{post.authorName}</span>
                        <span className="text-ink-3 text-xs">@{post.authorHandle}</span>
                        {post.deletedAt !== null ? (
                            <Badge variant="destructive">Deleted</Badge>
                        ) : null}
                    </div>
                    <p className="text-ink-3 flex flex-wrap gap-x-2 text-xs">
                        <Ago at={post.createdAt} now={now} />
                        <span className="truncate font-mono">{post.uri}</span>
                    </p>
                </div>
            </div>
            <p className="whitespace-pre-wrap px-5 text-sm leading-relaxed">{post.text}</p>
            {post.images.length > 0 ? (
                <div
                    className={cn(
                        "grid gap-2 px-5",
                        post.images.length > 1 ? "grid-cols-2" : "grid-cols-1"
                    )}
                >
                    {post.images.map(img => (
                        <StoredImage key={img.url} src={img.url} alt={img.alt || null} />
                    ))}
                </div>
            ) : null}
        </>
    );
}

function ReplyItem({ post, now }: { post: BlueskySnapshotPost; now: number }) {
    return (
        <li className={cn("flex gap-2.5", post.pending && "opacity-50")}>
            <Monogram src={post.authorAvatar} name={post.authorName} className="size-7 shrink-0" />
            <div className="min-w-0 flex-1">
                <div className="bg-panel-2 rounded-lg px-3 py-2">
                    <p className="flex flex-wrap items-center gap-x-2 text-xs">
                        <span className="text-ink font-semibold">{post.authorName}</span>
                        <span className="text-ink-3">@{post.authorHandle}</span>
                        {post.pending ? (
                            <Badge variant="warn">
                                arrives <Ago at={post.createdAt} now={now} />
                            </Badge>
                        ) : (
                            <Ago at={post.createdAt} now={now} />
                        )}
                        {post.origin === "api" ? <Badge variant="info">via API</Badge> : null}
                    </p>
                    <p className="text-ink-2 mt-0.5 whitespace-pre-wrap text-sm">{post.text}</p>
                </div>
                {post.replies.length > 0 ? (
                    <ul className="border-line ml-1 mt-2 flex flex-col gap-2 border-l pl-3">
                        {post.replies.map(reply => (
                            <ReplyItem key={reply.uri} post={reply} now={now} />
                        ))}
                    </ul>
                ) : null}
            </div>
        </li>
    );
}
