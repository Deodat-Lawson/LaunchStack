"use client";

import { useMemo } from "react";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { Button } from "~/components/ui/button";
import { plural } from "~/lib/tools/format";
import { useResource } from "~/lib/tools/useResource";

import { useGrowthPaths } from "../../_lib/paths";
import { ChannelAvatar } from "../_components/ChannelAvatar";
import { NETWORK_LABEL, NetworkMark } from "../_components/NetworkMark";
import { PostRow, PostsReadOnly } from "../_components/PostRow";
import { StatStrip } from "../_components/StatStrip";
import { TrackRecordSection } from "../_components/TrackRecord";
import { tokenExpiry } from "../_lib/channels";
import { compact } from "../_lib/numbers";
import { openCount } from "../_lib/threads";
import { DAY, addDays, postMoment } from "../_lib/time";
import { brandApi } from "../api";

interface AttentionItem {
    id: string;
    title: string;
    detail: string;
    action: { label: string; href: string };
    tone: "danger" | "warn" | "plain";
    avatar?: React.ReactNode;
}

/**
 * The week at a glance: what needs someone, how the last month went, what
 * is due and what went out. Each "needs attention" line carries the button
 * that deals with it.
 */
export function OverviewScreen() {
    const paths = useGrowthPaths();
    const accounts = useResource("brand:accounts", () => brandApi.accounts());
    const window = useMemo(() => {
        const now = new Date();
        return {
            from: new Date(now.getTime() - 7 * DAY).toISOString(),
            to: addDays(now, 14).toISOString(),
        };
    }, []);
    const posts = useResource(
        `brand:overview:${window.from}`,
        () => brandApi.posts({ from: window.from, to: window.to }),
        { pollMs: 20_000 }
    );
    const insights = useResource("brand:insights:30", () => brandApi.insights({ days: 30 }));
    const comments = useResource("brand:comments:open", () =>
        brandApi.comments({ status: "open" })
    );

    const list = posts.data?.posts ?? [];
    const now = Date.now();
    const upcoming = list
        .filter(p => p.status === "scheduled" || p.status === "publishing" || p.status === "failed")
        .sort((a, b) => postMoment(a).getTime() - postMoment(b).getTime());
    const drafts = list.filter(p => p.status === "draft");
    const wentOut = list
        .filter(p => p.status === "published" && postMoment(p).getTime() >= now - 7 * DAY)
        .sort((a, b) => postMoment(b).getTime() - postMoment(a).getTime());
    const failed = upcoming.filter(p => p.status === "failed");
    const channels = accounts.data?.channels ?? [];
    const connections = accounts.data?.connections ?? [];
    const waiting = openCount(comments.data?.comments ?? []);
    const waitingPosts = new Set(
        (comments.data?.comments ?? []).filter(c => !c.isOwn && !c.handledAt).map(c => c.postId)
    ).size;

    const attention: AttentionItem[] = [];
    if (accounts.data && channels.length === 0) {
        attention.push({
            id: "connect",
            title: "Connect an account",
            detail: "Nothing can go out until a LinkedIn Page, profile or Bluesky account is connected.",
            action: { label: "Open Accounts", href: paths.brand("/accounts") },
            tone: "plain",
        });
    }
    for (const channel of channels.filter(c => c.status === "reconnect")) {
        attention.push({
            id: `reconnect:${channel.id}`,
            title: `Reconnect ${channel.name}`,
            detail:
                channel.statusReason ??
                `${NETWORK_LABEL[channel.platform]} refused the sign-in; nothing posts here until it is reconnected.`,
            action: { label: "Open Accounts", href: paths.brand("/accounts") },
            tone: "danger",
            avatar: (
                <ChannelAvatar
                    name={channel.name}
                    kind={channel.kind}
                    avatarUrl={channel.avatarUrl}
                    size={24}
                />
            ),
        });
    }
    for (const connection of connections) {
        const expiry = tokenExpiry(connection);
        if (expiry.tone === "ok") continue;
        attention.push({
            id: `expiry:${connection.id}`,
            title: `${connection.accountName ?? NETWORK_LABEL[connection.platform]}'s ${NETWORK_LABEL[connection.platform]} sign-in: ${expiry.word.toLowerCase()}`,
            detail: "Reconnect before it runs out, or scheduled posts on its channels will fail.",
            action: { label: "Open Accounts", href: paths.brand("/accounts") },
            tone: expiry.tone,
            avatar: <NetworkMark platform={connection.platform} size={24} />,
        });
    }
    if (failed.length > 0) {
        attention.push({
            id: "failed",
            title: `${plural(failed.length, "post")} failed`,
            detail: failed[0]?.error ?? "The network did not accept it.",
            action: { label: "Open calendar", href: paths.brand("/calendar") },
            tone: "danger",
        });
    }
    if (waiting > 0) {
        attention.push({
            id: "comments",
            title: `${plural(waiting, "comment")} waiting for a reply`,
            detail: `On ${plural(waitingPosts, "post")}. Reply as the channel, or mark them done.`,
            action: { label: "Open Engagement", href: paths.brand("/engagement") },
            tone: "plain",
        });
    }

    const totals = insights.data?.totals;
    const followerChannels = (insights.data?.channels ?? []).filter(c => c.followers !== null);
    const followers = followerChannels.length
        ? followerChannels.reduce((n, c) => n + (c.followers ?? 0), 0)
        : null;

    const sub = posts.data
        ? [
              `${plural(upcoming.length - failed.length, "post")} coming up`,
              `${plural(wentOut.length, "post")} out in the last 7 days`,
              accounts.data ? plural(channels.filter(c => c.enabled).length, "channel") : null,
          ]
              .filter(Boolean)
              .join(" · ")
        : undefined;

    return (
        <PostsReadOnly.Provider value={posts.data?.canPublish === false}>
            <div className="mx-auto flex max-w-[1100px] flex-col gap-7">
                <PageHeader
                    title="Your brand,"
                    accent="this week"
                    sub={sub}
                    actions={
                        <>
                            <Button asChild variant="outline" size="sm">
                                <ToolLink href={paths.brand("/campaigns")}>
                                    Generate a campaign
                                </ToolLink>
                            </Button>
                            <Button asChild size="sm">
                                <ToolLink href={paths.brand("/compose")}>Compose</ToolLink>
                            </Button>
                        </>
                    }
                />

                {posts.error && (
                    <InlineError message={posts.error} onRetry={() => void posts.reload()} />
                )}

                {attention.length > 0 && (
                    <section>
                        <SectionHeading
                            title="Needs attention"
                            aside={plural(attention.length, "item")}
                        />
                        <div className="border-line bg-panel overflow-hidden rounded-lg border">
                            {attention.map(item => (
                                <div
                                    key={item.id}
                                    className="border-line-2 flex items-center gap-3 border-t px-4 py-3 first:border-t-0"
                                >
                                    {item.avatar ?? (
                                        <span
                                            aria-hidden
                                            className={
                                                item.tone === "danger"
                                                    ? "bg-danger mx-[8.5px] size-[7px] shrink-0 rounded-full"
                                                    : item.tone === "warn"
                                                      ? "bg-warn mx-[8.5px] size-[7px] shrink-0 rounded-full"
                                                      : "bg-ink-3 mx-[8.5px] size-[7px] shrink-0 rounded-full"
                                            }
                                        />
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <div
                                            className={
                                                item.tone === "danger"
                                                    ? "text-danger text-sm font-medium"
                                                    : item.tone === "warn"
                                                      ? "text-warn text-sm font-medium"
                                                      : "text-ink text-sm font-medium"
                                            }
                                        >
                                            {item.title}
                                        </div>
                                        <div className="text-ink-3 truncate text-xs">
                                            {item.detail}
                                        </div>
                                    </div>
                                    <Button variant="outline" size="sm" asChild>
                                        <ToolLink href={item.action.href}>
                                            {item.action.label}
                                        </ToolLink>
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                <section>
                    <SectionHeading
                        title="Last 30 days"
                        aside={
                            <ToolLink href={paths.brand("/analytics")} className="hover:text-ink">
                                Analytics
                            </ToolLink>
                        }
                    />
                    {insights.error ? (
                        <InlineError
                            message={insights.error}
                            onRetry={() => void insights.reload()}
                        />
                    ) : (
                        <StatStrip
                            label="Last 30 days"
                            loading={insights.loading}
                            stats={[
                                {
                                    label: "Impressions",
                                    value: compact(totals?.impressions),
                                    hint: totals ? plural(totals.posts, "post") : undefined,
                                },
                                { label: "Reactions", value: compact(totals?.reactions) },
                                { label: "Comments", value: compact(totals?.comments) },
                                {
                                    label: "Followers",
                                    value: compact(followers),
                                    hint: followerChannels.length
                                        ? `across ${plural(followerChannels.length, "channel")}`
                                        : undefined,
                                },
                            ]}
                        />
                    )}
                </section>

                <TrackRecordSection />

                <section>
                    <SectionHeading
                        title="Coming up"
                        aside={
                            failed.length > 0 ? (
                                <span className="text-danger">
                                    {plural(failed.length, "post")} failed
                                </span>
                            ) : undefined
                        }
                    />
                    {posts.loading ? (
                        <SkeletonRows rows={3} height={44} />
                    ) : upcoming.length === 0 ? (
                        <EmptyState
                            title="Nothing scheduled"
                            body="Write a post and pick a time; it goes out on its own. Or generate a campaign from your documents and schedule the drafts."
                            action={
                                <Button asChild size="sm" variant="outline">
                                    <ToolLink href={paths.brand("/compose")}>
                                        Compose a post
                                    </ToolLink>
                                </Button>
                            }
                        />
                    ) : (
                        <div className="border-line bg-panel rounded-lg border">
                            {upcoming.slice(0, 8).map(post => (
                                <PostRow
                                    key={post.id}
                                    post={post}
                                    onChange={() => void posts.reload()}
                                />
                            ))}
                            {upcoming.length > 8 && (
                                <ToolLink
                                    href={paths.brand("/calendar")}
                                    className="text-ink-2 hover:text-ink border-line-2 block border-t px-4 py-2 text-[13px]"
                                >
                                    {upcoming.length - 8} more on the calendar
                                </ToolLink>
                            )}
                        </div>
                    )}
                    {drafts.length > 0 && (
                        <div className="mt-4">
                            <SectionHeading title="Drafts" aside={plural(drafts.length, "draft")} />
                            <div className="border-line bg-panel rounded-lg border">
                                {drafts.slice(0, 5).map(post => (
                                    <PostRow
                                        key={post.id}
                                        post={post}
                                        onChange={() => void posts.reload()}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </section>

                <section>
                    <SectionHeading title="Went out" aside="last 7 days" />
                    {posts.loading ? (
                        <SkeletonRows rows={2} height={44} />
                    ) : wentOut.length === 0 ? (
                        <p className="text-ink-3 text-[13px]">
                            Nothing published in the last week.
                        </p>
                    ) : (
                        <div className="border-line bg-panel rounded-lg border">
                            {wentOut.slice(0, 6).map(post => (
                                <PostRow
                                    key={post.id}
                                    post={post}
                                    onChange={() => void posts.reload()}
                                />
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </PostsReadOnly.Provider>
    );
}
