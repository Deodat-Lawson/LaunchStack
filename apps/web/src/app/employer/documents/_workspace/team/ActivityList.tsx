"use client";

/**
 * The team feed: "Ada added Q3 plan.pdf · 2h". Rows come from
 * `/api/workspace/activity`, already filtered to what the reader can see; a
 * target that is still there is a link, one that is gone reads as text.
 *
 * Used twice: the Activity screen (everyone, grouped by day, narrowed by
 * person and kind) and a person's page (`actor`, a short list).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { ProfileAvatar } from "~/components/ProfileAvatar";
import { Button } from "~/components/ui/button";
import { usePeople } from "~/lib/profile/use-people";
import { cn } from "~/lib/utils";
import type { ActivityKind } from "~/lib/workspace-activity-kinds";

import { useErrorText } from "../settings/people/ui";
import { teamApi, type ActivityRow } from "./api";
import {
    activityMessage,
    activitySentence,
    activityTarget,
    dayKey,
    dayLabel,
    fullDateTime,
    shortAgo,
    timeOfDay,
    useTeamFormat,
    type TeamFormat,
} from "./format";
import type { TeamTarget } from "./types";
import { EmptyLine, ErrorLine, LoadingRows } from "./ui";

export interface ActivityListProps {
    /** Narrow to one person (auth subject id). */
    actor?: string;
    /** Narrow to one kind of activity (the server filters on its verbs). */
    kind?: ActivityKind;
    /** Rows per page. */
    pageSize?: number;
    /** Filter text, matched against each row's sentence. */
    query?: string;
    /** Day headings ("Today", "Yesterday", …) with the time on each row. */
    groupByDay?: boolean;
    /** What to say when there is nothing. */
    emptyText: string;
    onOpenTarget: (target: TeamTarget) => void;
    /** A group row opens the group's page. */
    onOpenGroup?: (groupId: number) => void;
}

export function ActivityList({
    actor,
    kind,
    pageSize = 30,
    query = "",
    groupByDay = false,
    emptyText,
    onOpenTarget,
    onOpenGroup,
}: ActivityListProps) {
    const t = useTranslations("team.activityList");
    const errorText = useErrorText();
    const tTeam = useTranslations("team");
    const tc = useTranslations("common");
    const f = useTeamFormat();
    const [rows, setRows] = useState<ActivityRow[]>([]);
    const [next, setNext] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await teamApi.activity({ limit: pageSize, actor, kind });
            setRows(res.entries);
            setNext(res.nextBefore);
        } catch (err) {
            setError(errorText(err, t("loadError")));
        } finally {
            setLoading(false);
        }
    }, [actor, kind, pageSize, t, errorText]);

    useEffect(() => {
        void load();
    }, [load]);

    const loadMore = async () => {
        if (next === null) return;
        setLoadingMore(true);
        try {
            const res = await teamApi.activity({ limit: pageSize, actor, kind, before: next });
            setRows(prev => [...prev, ...res.entries.filter(r => !prev.some(p => p.id === r.id))]);
            setNext(res.nextBefore);
        } catch (err) {
            setError(errorText(err, t("loadMoreError")));
        } finally {
            setLoadingMore(false);
        }
    };

    const people = usePeople(rows.map(r => r.actorUserId));
    const nameOf = useCallback(
        (authUserId: string) => people[authUserId]?.displayName ?? tTeam("someone"),
        [people, tTeam]
    );

    const needle = query.trim().toLowerCase();
    const shown = useMemo(
        () =>
            needle
                ? rows.filter(r =>
                      activitySentence(f, nameOf(r.actorUserId), r).toLowerCase().includes(needle)
                  )
                : rows,
        [rows, needle, nameOf, f]
    );

    /** Consecutive rows that fall on the same local day; the feed is newest first. */
    const days = useMemo(() => {
        const out: { key: string; label: string; rows: ActivityRow[] }[] = [];
        for (const row of shown) {
            const key = dayKey(row.at);
            const last = out[out.length - 1];
            if (last && last.key === key) last.rows.push(row);
            else out.push({ key, label: dayLabel(f, row.at), rows: [row] });
        }
        return out;
    }, [shown, f]);

    if (loading) return <LoadingRows rows={5} />;
    if (error && rows.length === 0)
        return <ErrorLine message={error} onRetry={() => void load()} />;
    if (rows.length === 0) return <EmptyLine>{emptyText}</EmptyLine>;

    const item = (row: ActivityRow) => (
        <ActivityItem
            key={row.id}
            row={row}
            actorName={nameOf(row.actorUserId)}
            actorAvatar={people[row.actorUserId]?.avatarUrl ?? null}
            when={groupByDay ? timeOfDay(f.locale, row.at) : shortAgo(f, row.at)}
            format={f}
            onOpenTarget={onOpenTarget}
            onOpenGroup={onOpenGroup}
        />
    );

    return (
        <div>
            {shown.length === 0 ? (
                <EmptyLine>{t("noMatch", { query: query.trim() })}</EmptyLine>
            ) : groupByDay ? (
                <div data-testid="team-activity">
                    {days.map(day => (
                        <section
                            key={day.key}
                            aria-label={day.label}
                            data-testid="team-activity-day"
                        >
                            <h3 className="text-ink-3 bg-panel sticky top-0 z-[1] m-0 px-3.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.04em]">
                                {day.label}
                            </h3>
                            <ul className="m-0 list-none p-0">{day.rows.map(item)}</ul>
                        </section>
                    ))}
                </div>
            ) : (
                <ul className="m-0 list-none p-0" data-testid="team-activity">
                    {shown.map(item)}
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
                        {loadingMore ? tc("status.loading") : t("showOlder")}
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
    when,
    format: f,
    onOpenTarget,
    onOpenGroup,
}: {
    row: ActivityRow;
    actorName: string;
    actorAvatar: string | null;
    /** "2h" in a short list, "2:14 PM" under a day heading. */
    when: string;
    format: TeamFormat;
    onOpenTarget: (target: TeamTarget) => void;
    onOpenGroup?: (groupId: number) => void;
}) {
    const { key, values } = activityMessage(f, row);
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

    // The whole row is the control when there is something to open: a button
    // inside the sentence renders as an inline-block and breaks a long name
    // onto its own centred lines in a narrow column.
    const content = (
        <>
            <ProfileAvatar
                name={actorName}
                src={actorAvatar}
                className="mt-px size-6"
                fallbackClassName="text-[9px]"
            />
            <span className="text-ink-2 min-w-0 flex-1 break-words text-[12.5px] leading-snug">
                {f.t.rich(`activity.${key}`, {
                    ...values,
                    actor: actorName,
                    person: chunks => <span className="text-ink font-medium">{chunks}</span>,
                    target: chunks => (
                        <span
                            className={cn(
                                "text-ink font-medium",
                                onClick &&
                                    "decoration-line group-hover/act:text-brand-ink underline underline-offset-2 group-hover/act:decoration-current"
                            )}
                        >
                            {chunks}
                        </span>
                    ),
                })}
            </span>
            <time
                dateTime={row.at}
                title={fullDateTime(f.locale, row.at)}
                className="text-ink-3 mt-px shrink-0 text-[11px] tabular-nums"
            >
                {when}
            </time>
        </>
    );

    return (
        <li data-testid="team-activity-row">
            {onClick ? (
                <button
                    type="button"
                    onClick={onClick}
                    className="group/act hover:bg-panel-2 focus-visible:bg-panel-2 flex w-full items-start gap-2.5 px-3.5 py-1.5 text-left outline-none"
                >
                    {content}
                </button>
            ) : (
                <div className="flex items-start gap-2.5 px-3.5 py-1.5">{content}</div>
            )}
        </li>
    );
}
