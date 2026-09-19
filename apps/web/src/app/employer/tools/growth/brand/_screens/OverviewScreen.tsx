"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import { EmptyState, InlineError } from "../../_components/EmptyState";
import { PageHeader, SectionHeading } from "../../_components/PageHeader";
import { SkeletonRows } from "../../_components/SkeletonRows";
import { plural } from "../../_lib/format";
import { useGrowthPaths } from "../../_lib/paths";
import { useResource } from "../../_lib/useResource";
import { NETWORK_LABEL, NetworkMark } from "../_components/NetworkMark";
import { PostRow } from "../_components/PostRow";
import { DAY, addDays, postMoment } from "../_lib/time";
import { brandApi } from "../api";

/**
 * The week at a glance: what is due, what went out, which networks can be
 * posted to. No tiles; three short lists and the two things to do next.
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

    const list = posts.data?.posts ?? [];
    const now = Date.now();
    const upcoming = list
        .filter(p => p.status === "scheduled" || p.status === "publishing" || p.status === "failed")
        .sort((a, b) => postMoment(a).getTime() - postMoment(b).getTime());
    const drafts = list.filter(p => p.status === "draft");
    const wentOut = list
        .filter(p => p.status === "published" && postMoment(p).getTime() >= now - 7 * DAY)
        .sort((a, b) => postMoment(b).getTime() - postMoment(a).getTime());
    const connected = (accounts.data?.accounts ?? []).filter(a => a.configured);
    const failed = upcoming.filter(p => p.status === "failed").length;

    const sub = posts.data
        ? [
              plural(upcoming.length - failed, "post") + " coming up",
              plural(wentOut.length, "post") + " out in the last 7 days",
              accounts.data
                  ? `${connected.length} of ${accounts.data.accounts.length} networks connected`
                  : null,
          ]
              .filter(Boolean)
              .join(" · ")
        : undefined;

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-7">
            <PageHeader
                title="Your brand,"
                accent="this week"
                sub={sub}
                actions={
                    <>
                        <Button asChild variant="outline" size="sm">
                            <Link href={paths.brand("/campaigns")}>Generate a campaign</Link>
                        </Button>
                        <Button asChild size="sm">
                            <Link href={paths.brand("/compose")}>Compose</Link>
                        </Button>
                    </>
                }
            />

            {posts.error && (
                <InlineError message={posts.error} onRetry={() => void posts.reload()} />
            )}

            <section>
                <SectionHeading
                    title="Coming up"
                    aside={
                        failed > 0 ? (
                            <span className="text-danger">{plural(failed, "post")} failed</span>
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
                                <Link href={paths.brand("/compose")}>Compose a post</Link>
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
                            <Link
                                href={paths.brand("/calendar")}
                                className="text-ink-2 hover:text-ink border-line-2 block border-t px-4 py-2 text-[13px]"
                            >
                                {upcoming.length - 8} more on the calendar
                            </Link>
                        )}
                    </div>
                )}
            </section>

            {drafts.length > 0 && (
                <section>
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
                </section>
            )}

            <section>
                <SectionHeading title="Went out" aside="last 7 days" />
                {posts.loading ? (
                    <SkeletonRows rows={2} height={44} />
                ) : wentOut.length === 0 ? (
                    <p className="text-ink-3 text-[13px]">Nothing published in the last week.</p>
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

            <section>
                <SectionHeading
                    title="Networks"
                    aside={
                        <Link href={paths.brand("/accounts")} className="hover:text-ink">
                            Accounts
                        </Link>
                    }
                />
                {accounts.error && (
                    <InlineError message={accounts.error} onRetry={() => void accounts.reload()} />
                )}
                <div className="flex flex-wrap gap-2">
                    {(accounts.data?.accounts ?? []).map(a => (
                        <span
                            key={a.platform}
                            className={cn(
                                "border-line inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-[13px]",
                                a.configured ? "bg-panel text-ink" : "text-ink-3"
                            )}
                        >
                            <NetworkMark platform={a.platform} size={16} muted={!a.configured} />
                            {NETWORK_LABEL[a.platform]}
                            {a.configured ? (
                                <Check className="text-success size-3.5" aria-label="connected" />
                            ) : (
                                <span className="text-[11.5px]">not connected</span>
                            )}
                        </span>
                    ))}
                </div>
            </section>
        </div>
    );
}
