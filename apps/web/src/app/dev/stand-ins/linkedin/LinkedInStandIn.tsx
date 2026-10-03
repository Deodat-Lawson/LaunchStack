"use client";

import { useState } from "react";
import {
    Clock,
    KeyRound,
    MessageSquarePlus,
    RotateCcw,
    ShieldOff,
    TimerOff,
    TriangleAlert,
} from "lucide-react";

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
import type { LinkedInSnapshot, LinkedInSnapshotComment, LinkedInSnapshotPost } from "./world";

type Act = (label: string, body: Record<string, unknown>) => Promise<void>;

/**
 * What an app has done to the LinkedIn stand-in — its posts as a feed, the
 * comments people left, the tokens it holds — plus the levers a tester
 * pulls: revoke or expire tokens, add a comment, age the world, reset.
 */
export function LinkedInStandIn({
    initial,
    base,
    origin,
}: {
    initial: LinkedInSnapshot;
    base: string;
    origin: string;
}) {
    const { state, busy, error, act } = useStandInState(base, initial);
    const { now } = state;

    return (
        <div className="bg-surface text-ink min-h-dvh">
            <StandInBanner network="LinkedIn" />
            <header className="border-line bg-panel border-b">
                <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4">
                    <div className="min-w-0">
                        <h1 className="display text-lg font-semibold">LinkedIn stand-in</h1>
                        <p className="text-ink-3 text-sm">
                            Everything an app has posted, and the tokens it holds, on this
                            development imitation of LinkedIn.
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
                            onClick={() => void act("revoke", { action: "revoke-all" })}
                        >
                            <ShieldOff /> Revoke all tokens
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
                <section aria-label="Feed" className="flex min-w-0 flex-col gap-4">
                    <h2 className="text-ink-2 text-sm font-semibold">
                        Feed{" "}
                        <span className="text-ink-3 font-normal">
                            · {state.posts.length} {state.posts.length === 1 ? "post" : "posts"}
                        </span>
                    </h2>
                    {state.posts.length === 0 ? (
                        <Card className="text-ink-3 items-center gap-2 px-6 py-10 text-center text-sm">
                            <p className="text-ink-2 font-medium">Nothing posted yet.</p>
                            <p>
                                Connect LinkedIn in Growth › Brand › Accounts and publish a post; it
                                lands here.
                            </p>
                        </Card>
                    ) : (
                        state.posts.map(post => (
                            <PostCard key={post.urn} post={post} now={now} act={act} busy={busy} />
                        ))
                    )}
                </section>

                <aside className="flex min-w-0 flex-col gap-4">
                    <Card className="gap-3 p-5">
                        <h2 className="text-ink-2 text-sm font-semibold">Signed-in member</h2>
                        <div className="flex items-center gap-3">
                            <Monogram
                                src={state.member.picture}
                                name={state.member.name}
                                className="size-10"
                            />
                            <div className="min-w-0">
                                <p className="font-medium">{state.member.name}</p>
                                <p className="text-ink-3 truncate text-xs">{state.member.email}</p>
                                <p className="text-ink-3 truncate font-mono text-[11px]">
                                    {state.member.urn}
                                </p>
                            </div>
                        </div>
                    </Card>

                    <Card className="gap-3 p-5">
                        <h2 className="text-ink-2 text-sm font-semibold">Pages Dana manages</h2>
                        <ul className="flex flex-col gap-3">
                            {state.orgs.map(org => (
                                <li key={org.urn} className="flex items-center gap-3">
                                    <Monogram
                                        src={org.logo}
                                        name={org.name}
                                        className="size-9 rounded-md"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate font-medium">{org.name}</p>
                                        <p className="text-ink-3 truncate font-mono text-[11px]">
                                            {org.urn}
                                        </p>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        <Badge
                                            variant={
                                                org.role === "ADMINISTRATOR" ? "info" : "secondary"
                                            }
                                        >
                                            {org.role === "ADMINISTRATOR"
                                                ? "Admin"
                                                : "Content admin"}
                                        </Badge>
                                        <span className="text-ink-3 text-[11px] tabular-nums">
                                            {org.followers.toLocaleString("en-US")} followers
                                        </span>
                                    </div>
                                </li>
                            ))}
                        </ul>
                        <p className="text-ink-3 text-xs">
                            Statistics need the Admin role, as on LinkedIn: LaunchStack Labs posts
                            have none.
                        </p>
                    </Card>

                    <Card className="gap-2 p-5">
                        <h2 className="text-ink-2 text-sm font-semibold">Point the app here</h2>
                        <pre className="bg-panel-2 border-line text-ink-2 whitespace-pre-wrap break-all rounded-md border p-3 font-mono text-[11px] leading-relaxed">
                            {`LINKEDIN_OAUTH_BASE_URL=${origin}${base}/oauth/v2\nLINKEDIN_API_BASE_URL=${origin}${base}`}
                        </pre>
                        <p className="text-ink-3 text-xs">
                            Any client id and secret work; the first secret used for a client id
                            sticks until Reset.
                        </p>
                    </Card>

                    <Card className="gap-3 p-5">
                        <h2 className="text-ink-2 flex items-center gap-2 text-sm font-semibold">
                            <KeyRound className="size-4" aria-hidden /> Issued tokens
                        </h2>
                        {state.tokens.length === 0 ? (
                            <p className="text-ink-3 text-sm">None yet.</p>
                        ) : (
                            <ul className="divide-line flex flex-col divide-y">
                                {state.tokens.map(token => (
                                    <li key={token.id} className="flex flex-col gap-1.5 py-2.5">
                                        <div className="flex items-center gap-2">
                                            <Badge variant="outline">{token.kind}</Badge>
                                            <Badge
                                                variant={
                                                    token.status === "active"
                                                        ? "success"
                                                        : token.status === "expired"
                                                          ? "warn"
                                                          : "destructive"
                                                }
                                            >
                                                {token.status}
                                            </Badge>
                                            <span className="text-ink-2 ml-auto font-mono text-[11px]">
                                                {token.preview}
                                            </span>
                                        </div>
                                        <p className="text-ink-3 text-[11px]">
                                            client {token.clientId} · issued{" "}
                                            <Ago at={token.issuedAt} now={now} /> ·{" "}
                                            {token.status === "expired" ? "expired " : "expires "}
                                            <Ago at={token.expiresAt} now={now} />
                                        </p>
                                        <div className="flex flex-wrap gap-1">
                                            {token.scopes.map(scope => (
                                                <span
                                                    key={scope}
                                                    className="bg-panel-2 text-ink-2 rounded px-1.5 py-0.5 font-mono text-[10px]"
                                                >
                                                    {scope}
                                                </span>
                                            ))}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Card>

                    <Card className="gap-2 p-5">
                        <h2 className="text-ink-2 text-sm font-semibold">Recent API calls</h2>
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
    post: LinkedInSnapshotPost;
    now: number;
    act: Act;
    busy: string | null;
}) {
    const [draft, setDraft] = useState("");
    const deleted = post.deletedAt !== null;
    const commentCount = countComments(post.comments, now);

    return (
        <Card className={cn("gap-4 py-5", deleted && "opacity-60")}>
            <div className="flex items-start gap-3 px-5">
                <Monogram
                    src={post.authorPicture}
                    name={post.authorName}
                    className="size-10 rounded-md"
                />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{post.authorName}</span>
                        <Badge variant="outline">{post.visibility}</Badge>
                        {post.lifecycleState !== "PUBLISHED" ? (
                            <Badge variant="secondary">{post.lifecycleState}</Badge>
                        ) : null}
                        {deleted ? <Badge variant="destructive">Deleted</Badge> : null}
                    </div>
                    <p className="text-ink-3 flex flex-wrap gap-x-2 text-xs">
                        <Ago at={post.createdAt} now={now} />
                        <span className="truncate font-mono">{post.urn}</span>
                    </p>
                </div>
            </div>

            <p className="whitespace-pre-wrap px-5 text-sm leading-relaxed">
                {post.text || <span className="text-ink-3 italic">(no text)</span>}
            </p>

            {post.issues.length > 0 ? (
                <div className="border-warn/40 bg-warn-soft text-warn mx-5 flex flex-col gap-1 rounded-md border p-3 text-xs">
                    <p className="flex items-center gap-1.5 font-semibold">
                        <TriangleAlert className="size-3.5" aria-hidden /> Little-text escaping
                    </p>
                    <ul className="list-disc pl-4">
                        {post.issues.map(issue => (
                            <li key={issue}>{issue}</li>
                        ))}
                    </ul>
                    <p className="text-ink-2 break-all font-mono">Sent: {post.commentary}</p>
                </div>
            ) : null}

            {post.images.length > 0 ? (
                <div
                    className={cn(
                        "grid gap-2 px-5",
                        post.images.length > 1 ? "grid-cols-2" : "grid-cols-1"
                    )}
                >
                    {post.images.map(img => (
                        <StoredImage key={img.url} src={img.url} alt={img.alt} />
                    ))}
                </div>
            ) : null}

            <div className="border-line flex flex-wrap gap-6 border-t px-5 pt-3">
                {post.stats ? (
                    <>
                        <Stat
                            label="Impressions"
                            value={post.stats.impressionCount.toLocaleString("en-US")}
                        />
                        <Stat label="Reactions" value={post.stats.likeCount} />
                        <Stat label="Clicks" value={post.stats.clickCount} />
                        <Stat label="Comments" value={post.stats.commentCount} />
                        <Stat label="Reposts" value={post.stats.shareCount} />
                        <Stat
                            label="Engagement"
                            value={`${(post.stats.engagement * 100).toFixed(1)}%`}
                        />
                    </>
                ) : (
                    <p className="text-ink-3 text-xs">
                        No activity yet — LinkedIn leaves this post out of statistics for its first
                        minute.
                    </p>
                )}
            </div>

            <div className="flex flex-col gap-3 px-5">
                <h3 className="text-ink-2 text-xs font-semibold">
                    Comments <span className="text-ink-3 font-normal">· {commentCount}</span>
                </h3>
                {post.comments.length > 0 ? (
                    <ul className="flex flex-col gap-3">
                        {post.comments.map(comment => (
                            <CommentItem key={comment.id} comment={comment} now={now} />
                        ))}
                    </ul>
                ) : null}
                {!deleted ? (
                    <form
                        className="flex gap-2"
                        onSubmit={event => {
                            event.preventDefault();
                            void act(`comment:${post.urn}`, {
                                action: "comment",
                                postUrn: post.urn,
                                text: draft,
                            }).then(() => setDraft(""));
                        }}
                    >
                        <Input
                            value={draft}
                            onChange={event => setDraft(event.target.value)}
                            placeholder="Comment text (blank for a canned one)"
                            aria-label={`Comment on ${post.urn}`}
                            className="h-8 text-sm"
                        />
                        <Button type="submit" variant="outline" size="sm" disabled={busy !== null}>
                            <MessageSquarePlus /> Add a comment
                        </Button>
                    </form>
                ) : null}
            </div>
        </Card>
    );
}

function countComments(comments: LinkedInSnapshotComment[], now: number): number {
    return comments.reduce(
        (n, c) => n + (c.createdAt <= now ? 1 : 0) + countComments(c.replies, now),
        0
    );
}

function CommentItem({ comment, now }: { comment: LinkedInSnapshotComment; now: number }) {
    return (
        <li className={cn("flex gap-2.5", comment.pending && "opacity-50")}>
            <Monogram
                src={comment.actorPicture}
                name={comment.actorName}
                className="size-7 shrink-0"
            />
            <div className="min-w-0 flex-1">
                <div className="bg-panel-2 rounded-lg px-3 py-2">
                    <p className="flex flex-wrap items-center gap-x-2 text-xs">
                        <span className="text-ink font-semibold">{comment.actorName}</span>
                        {comment.pending ? (
                            <Badge variant="warn">
                                arrives <Ago at={comment.createdAt} now={now} />
                            </Badge>
                        ) : (
                            <Ago at={comment.createdAt} now={now} />
                        )}
                        {comment.origin === "api" ? <Badge variant="info">via API</Badge> : null}
                    </p>
                    <p className="text-ink-2 mt-0.5 whitespace-pre-wrap text-sm">{comment.text}</p>
                </div>
                {comment.replies.length > 0 ? (
                    <ul className="border-line ml-1 mt-2 flex flex-col gap-2 border-l pl-3">
                        {comment.replies.map(reply => (
                            <CommentItem key={reply.id} comment={reply} now={now} />
                        ))}
                    </ul>
                ) : null}
            </div>
        </li>
    );
}
