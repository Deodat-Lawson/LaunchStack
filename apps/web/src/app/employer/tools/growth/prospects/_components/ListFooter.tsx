"use client";

import { Button } from "~/components/ui/button";

/** The end of a paged list: how much of it is here, and the way to more. */
export function ListFooter({
    shown,
    total,
    noun,
    hasMore,
    loadingMore,
    onMore,
}: {
    shown: number;
    total: number;
    noun: string;
    hasMore: boolean;
    loadingMore: boolean;
    onMore: () => void;
}) {
    if (total === 0) return null;
    return (
        <div className="text-ink-3 flex items-center justify-between gap-3 px-1 text-xs tabular-nums">
            <span>
                Showing {shown.toLocaleString()} of {total.toLocaleString()} {noun}
            </span>
            {hasMore && (
                <Button size="sm" variant="outline" disabled={loadingMore} onClick={onMore}>
                    {loadingMore ? "Loading…" : "Show more"}
                </Button>
            )}
        </div>
    );
}
