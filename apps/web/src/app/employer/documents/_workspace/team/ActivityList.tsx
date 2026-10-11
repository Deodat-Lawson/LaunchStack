"use client";

/**
 * The team feed: "Ada added Q3 plan.pdf · 2h". Rows come from
 * `/api/workspace/activity`, already filtered to what the reader can see; a
 * target that is still there is a link, one that is gone reads as text.
 *
 * Used twice: the Activity view (everyone) and a person's page (`actor`).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";

import { ProfileAvatar } from "~/components/ProfileAvatar";
import { Button } from "~/components/ui/button";
import { usePeople } from "~/lib/profile/use-people";

import { errorMessage } from "../settings/people/api";
import { teamApi, type ActivityRow } from "./api";
import { activityParts, activitySentence, activityTarget, shortAgo } from "./format";
import type { TeamTarget } from "./types";
import { EmptyLine, ErrorLine, LoadingRows } from "./ui";

export interface ActivityListProps {
    /** Narrow to one person (auth subject id). */
    actor?: string;
    /** Rows per page. */
    pageSize?: number;
    /** The rail's filter text. */
    query?: string;
    /** What to say when there is nothing. */
    emptyText: string;
    onOpenTarget: (target: TeamTarget) => void;
    /** A group row opens the group inside the Team tab. */
    onOpenGroup?: (groupId: number) => void;
}

export function ActivityList({
    actor,
    pageSize = 30,
    query = "",
    emptyText,
    onOpenTarget,
    onOpenGroup,
}: ActivityListProps) {
    const [rows, setRows] = useState<ActivityRow[]>([]);
    const [next, setNext] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await teamApi.activity({ limit: pageSize, actor });
            setRows(res.entries);
            setNext(res.nextBefore);
        } catch (err) {
            setError(errorMessage(err, "Couldn't load activity."));
        } finally {
            setLoading(false);
        }
    }, [actor, pageSize]);

    useEffect(() => {
        void load();
    }, [load]);

    const loadMore = async () => {
        if (next === null) return;
        setLoadingMore(true);
        try {
            const res = await teamApi.activity({ limit: pageSize, actor, before: next });
            setRows(prev => [...prev, ...res.entries.filter(r => !prev.some(p => p.id === r.id))]);
            setNext(res.nextBefore);
        } catch (err) {
            setError(errorMessage(err, "Couldn't load more activity."));
        } finally {
            setLoadingMore(false);
        }
    };

    const people = usePeople(rows.map(r => r.actorUserId));
    const nameOf = useCallback(
        (authUserId: string) => people[authUserId]?.displayName ?? "Someone",
        [people]
    );

    const needle = query.trim().toLowerCase();
    const shown = useMemo(
        () =>
            needle
                ? rows.filter(r =>
                      activitySentence(nameOf(r.actorUserId), r).toLowerCase().includes(needle)
                  )
                : rows,
        [rows, needle, nameOf]
    );

    if (loading) return <LoadingRows rows={5} />;
    if (error && rows.length === 0)
        return <ErrorLine message={error} onRetry={() => void load()} />;
    if (rows.length === 0) return <EmptyLine>{emptyText}</EmptyLine>;

    return (
        <div>
            {shown.length === 0 ? (
                <EmptyLine>Nothing here matches “{query.trim()}”.</EmptyLine>
            ) : (
                <ul className="m-0 list-none p-0" data-testid="team-activity">
                    {shown.map(row => (
                        <ActivityItem
                            key={row.id}
                            row={row}
                            actorName={nameOf(row.actorUserId)}
                            actorAvatar={people[row.actorUserId]?.avatarUrl ?? null}
                            onOpenTarget={onOpenTarget}
                            onOpenGroup={onOpenGroup}
                        />
                    ))}
                </ul>
            )}
            {error && <ErrorLine message={error} />}
            {next !== null && (
                <div className="px-3.5 pb-3 pt-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-ink-2 h-7 w-full text-[12px]"
                        disabled={loadingMore}
                        onClick={() => void loadMore()}
                    >
                        {loadingMore ? "Loading…" : "Show older"}
                    </Button>
                </div>
            )}
        </div>
    );
}

function ActivityItem({
    row,
    actorName,
    actorAvatar,
    onOpenTarget,
    onOpenGroup,
}: {
    row: ActivityRow;
    actorName: string;
    actorAvatar: string | null;
    onOpenTarget: (target: TeamTarget) => void;
    onOpenGroup?: (groupId: number) => void;
}) {
    const { before, target, after } = activityParts(row);
    const opens = activityTarget(row);
    const groupId =
        row.targetType === "group" && row.openable && row.targetId && /^\d+$/.test(row.targetId)
            ? Number(row.targetId)
            : null;
    const onClick = opens
        ? () => onOpenTarget(opens)
        : groupId !== null && onOpenGroup
          ? () => onOpenGroup(groupId)
          : null;

    return (
        <li className="flex items-start gap-2.5 px-3.5 py-1.5" data-testid="team-activity-row">
            <ProfileAvatar
                name={actorName}
                src={actorAvatar}
                className="mt-px size-6"
                fallbackClassName="text-[9px]"
            />
            <p className="text-ink-2 m-0 min-w-0 flex-1 break-words text-[12.5px] leading-snug">
                <span className="text-ink font-medium">{actorName}</span> {before}{" "}
                {onClick ? (
                    <button
                        type="button"
                        onClick={onClick}
                        className="text-ink hover:text-brand-ink focus-visible:ring-brand/50 decoration-line rounded-sm font-medium underline underline-offset-2 outline-none hover:decoration-current focus-visible:ring-2"
                    >
                        {target}
                    </button>
                ) : (
                    <span className="text-ink font-medium">{target}</span>
                )}
                {after}
            </p>
            <time
                dateTime={row.at}
                title={new Date(row.at).toLocaleString()}
                className="text-ink-3 mt-px shrink-0 text-[11px] tabular-nums"
            >
                {shortAgo(row.at)}
            </time>
        </li>
    );
}
