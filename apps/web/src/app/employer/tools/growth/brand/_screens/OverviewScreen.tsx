"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { Button } from "~/components/ui/button";
import { useResource } from "~/lib/tools/useResource";

import { useGrowthFormat } from "../../_lib/format";
import { useGrowthPaths } from "../../_lib/paths";
import { ChannelAvatar } from "../_components/ChannelAvatar";
import { NETWORK_LABEL, NetworkMark } from "../_components/NetworkMark";
import { PostRow, PostsReadOnly } from "../_components/PostRow";
import { StatStrip } from "../_components/StatStrip";
import { TrackRecordSection } from "../_components/TrackRecord";
import { tokenExpiry } from "../_lib/channels";
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
    const t = useTranslations("growth.brand");
    const tc = useTranslations("growth.common.counts");
    const tChannels = useTranslations("growth.brand.channels");
    const { compact } = useGrowthFormat();
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
            title: t("common.connectAccount"),
            detail: t("overview.connectDetail"),
            action: { label: t("common.openAccounts"), href: paths.brand("/accounts") },
            tone: "plain",
        });
    }
    for (const channel of channels.filter(c => c.status === "reconnect")) {
        attention.push({
            id: `reconnect:${channel.id}`,
            title: t("overview.reconnectTitle", { name: channel.name }),
            detail:
                channel.statusReason ??
                t("overview.reconnectDetail", { network: NETWORK_LABEL[channel.platform] }),
            action: { label: t("common.openAccounts"), href: paths.brand("/accounts") },
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
        const expiry = tokenExpiry(tChannels, connection);
        if (expiry.tone === "ok") continue;
        attention.push({
            id: `expiry:${connection.id}`,
            title: t("overview.expiryTitle", {
                account: connection.accountName ?? NETWORK_LABEL[connection.platform],
                network: NETWORK_LABEL[connection.platform],
                status: expiry.word.toLowerCase(),
            }),
            detail: t("overview.expiryDetail"),
            action: { label: t("common.openAccounts"), href: paths.brand("/accounts") },
            tone: expiry.tone,
            avatar: <NetworkMark platform={connection.platform} size={24} />,
        });
    }
    if (failed.length > 0) {
        attention.push({
            id: "failed",
            title: t("overview.failedTitle", { count: failed.length }),
            detail: failed[0]?.error ?? t("overview.notAccepted"),
            action: { label: t("overview.openCalendar"), href: paths.brand("/calendar") },
            tone: "danger",
        });
    }
    if (waiting > 0) {
        attention.push({
            id: "comments",
            title: t("overview.commentsTitle", { count: waiting }),
            detail: t("overview.commentsDetail", { count: waitingPosts }),
            action: { label: t("overview.openEngagement"), href: paths.brand("/engagement") },
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
              t("overview.comingUpCount", { count: upcoming.length - failed.length }),
              t("overview.outLastWeek", { count: wentOut.length }),
              accounts.data
                  ? tc("channels", { count: channels.filter(c => c.enabled).length })
                  : null,
          ]
              .filter(Boolean)
              .join(" · ")
        : undefined;

    return (
        <PostsReadOnly.Provider value={posts.data?.canPublish === false}>
            <div className="mx-auto flex max-w-[1100px] flex-col gap-7">
                <PageHeader
                    title={t("overview.title")}
                    accent={t("overview.accent")}
                    sub={sub}
                    actions={
                        <>
                            <Button asChild variant="outline" size="sm">
                                <ToolLink href={paths.brand("/campaigns")}>
                                    {t("overview.generateCampaign")}
                                </ToolLink>
                            </Button>
                            <Button asChild size="sm">
                                <ToolLink href={paths.brand("/compose")}>
                                    {t("common.compose")}
                                </ToolLink>
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
                            title={t("overview.needsAttention")}
                            aside={tc("items", { count: attention.length })}
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
                                                      ? "text-warn-ink text-sm font-medium"
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
                        title={t("overview.last30")}
                        aside={
                            <ToolLink href={paths.brand("/analytics")} className="hover:text-ink">
                                {t("overview.analytics")}
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
                            label={t("overview.last30")}
                            loading={insights.loading}
                            stats={[
                                {
                                    label: t("stats.impressions"),
                                    value: compact(totals?.impressions),
                                    hint: totals ? tc("posts", { count: totals.posts }) : undefined,
                                },
                                { label: t("stats.reactions"), value: compact(totals?.reactions) },
                                { label: t("stats.comments"), value: compact(totals?.comments) },
                                {
                                    label: t("stats.followers"),
                                    value: compact(followers),
                                    hint: followerChannels.length
                                        ? t("overview.acrossChannels", {
                                              count: followerChannels.length,
                                          })
                                        : undefined,
                                },
                            ]}
                        />
                    )}
                </section>

                <TrackRecordSection />

                <section>
                    <SectionHeading
                        title={t("overview.comingUp")}
                        aside={
                            failed.length > 0 ? (
                                <span className="text-danger">
                                    {t("overview.failedTitle", { count: failed.length })}
                                </span>
                            ) : undefined
                        }
                    />
                    {posts.loading ? (
                        <SkeletonRows rows={3} height={44} />
                    ) : upcoming.length === 0 ? (
                        <EmptyState
                            title={t("overview.nothingScheduled")}
                            body={t("overview.nothingScheduledBody")}
                            action={
                                <Button asChild size="sm" variant="outline">
                                    <ToolLink href={paths.brand("/compose")}>
                                        {t("common.composeAPost")}
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
                                    {t("overview.moreOnCalendar", { count: upcoming.length - 8 })}
                                </ToolLink>
                            )}
                        </div>
                    )}
                    {drafts.length > 0 && (
                        <div className="mt-4">
                            <SectionHeading
                                title={t("overview.drafts")}
                                aside={tc("drafts", { count: drafts.length })}
                            />
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
                    <SectionHeading title={t("overview.wentOut")} aside={t("overview.last7")} />
                    {posts.loading ? (
                        <SkeletonRows rows={2} height={44} />
                    ) : wentOut.length === 0 ? (
                        <p className="text-ink-3 text-[13px]">{t("overview.nothingPublished")}</p>
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
