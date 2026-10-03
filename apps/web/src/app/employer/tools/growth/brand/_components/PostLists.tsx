"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "~/components/ui/button";

import { EmptyState } from "../../_components/EmptyState";
import { SectionHeading } from "../../_components/PageHeader";
import { SkeletonRows } from "../../_components/SkeletonRows";
import { plural } from "../../_lib/format";
import { PostRow } from "./PostRow";
import { DAY, postMoment } from "../_lib/time";
import type { BrandPost } from "../api";

const SHOWN = 8;

/** A bordered list of post rows, the first eight, then the rest on request. */
function List({ posts, onChange }: { posts: BrandPost[]; onChange: () => void }) {
    const [expanded, setExpanded] = useState(false);
    const visible = expanded ? posts : posts.slice(0, SHOWN);
    const hidden = posts.length - visible.length;
    return (
        <div className="border-line bg-panel rounded-lg border">
            {visible.map(post => (
                <PostRow key={post.id} post={post} onChange={onChange} />
            ))}
            {hidden > 0 && (
                <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="text-ink-2 hover:text-ink border-line-2 focus-visible:ring-brand/50 block w-full rounded-b-lg border-t px-4 py-2 text-left text-[13px] outline-none focus-visible:ring-[3px]"
                >
                    Show {plural(hidden, "more post")}
                </button>
            )}
        </div>
    );
}

/**
 * The week in three short lists under the calendar: what is due, what is
 * still a draft, what went out. Every row opens the same actions the
 * calendar does.
 */
export function PostLists({
    posts,
    loading,
    onChange,
    onCompose,
    campaignsHref,
}: {
    posts: BrandPost[];
    loading: boolean;
    onChange: () => void;
    onCompose: () => void;
    campaignsHref: string;
}) {
    const now = Date.now();
    const upcoming = posts
        .filter(p => p.status === "scheduled" || p.status === "publishing" || p.status === "failed")
        .sort((a, b) => postMoment(a).getTime() - postMoment(b).getTime());
    const drafts = posts
        .filter(p => p.status === "draft")
        .sort((a, b) => postMoment(b).getTime() - postMoment(a).getTime());
    const wentOut = posts
        .filter(p => p.status === "published" && postMoment(p).getTime() >= now - 7 * DAY)
        .sort((a, b) => postMoment(b).getTime() - postMoment(a).getTime());
    const failed = upcoming.filter(p => p.status === "failed").length;

    return (
        <div className="grid gap-7 lg:grid-cols-3 lg:gap-5">
            <section>
                <SectionHeading
                    title="Coming up"
                    aside={
                        failed > 0 ? (
                            <span className="text-danger">{plural(failed, "post")} failed</span>
                        ) : loading ? undefined : (
                            plural(upcoming.length, "post")
                        )
                    }
                />
                {loading ? (
                    <SkeletonRows rows={3} height={44} />
                ) : upcoming.length === 0 ? (
                    <EmptyState
                        title="Nothing scheduled"
                        body="Write a post and pick a time; it goes out on its own."
                        action={
                            <Button size="sm" variant="outline" onClick={onCompose}>
                                Compose a post
                            </Button>
                        }
                    />
                ) : (
                    <List posts={upcoming} onChange={onChange} />
                )}
            </section>

            <section>
                <SectionHeading
                    title="Drafts"
                    aside={loading ? undefined : plural(drafts.length, "draft")}
                />
                {loading ? (
                    <SkeletonRows rows={2} height={44} />
                ) : drafts.length === 0 ? (
                    <EmptyState
                        title="No drafts"
                        body="Generate a campaign from your documents and its drafts land here, ready to schedule."
                        action={
                            <Button asChild size="sm" variant="outline">
                                <Link href={campaignsHref}>Generate a campaign</Link>
                            </Button>
                        }
                    />
                ) : (
                    <List posts={drafts} onChange={onChange} />
                )}
            </section>

            <section>
                <SectionHeading title="Went out" aside="last 7 days" />
                {loading ? (
                    <SkeletonRows rows={2} height={44} />
                ) : wentOut.length === 0 ? (
                    <EmptyState
                        title="Nothing published this week"
                        body="Posts that went out in the last seven days show here, with a link to each."
                        action={
                            <Button size="sm" variant="outline" onClick={onCompose}>
                                Publish something
                            </Button>
                        }
                    />
                ) : (
                    <List posts={wentOut} onChange={onChange} />
                )}
            </section>
        </div>
    );
}
