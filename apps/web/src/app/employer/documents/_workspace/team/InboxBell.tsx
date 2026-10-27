"use client";

/**
 * The inbox bell in the rail header (ADR-014 §7): an unread count, and a
 * popover listing what was shared with you — "Ada shared “Q3 plan” with you".
 * Opening an entry marks it read and opens the thing.
 *
 * It asks the server when it mounts, then once a minute and whenever the
 * window regains focus — but the minute poll skips while the tab is hidden: a
 * background tab polling all day is cost nobody sees, and focus is exactly
 * when the count matters.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, FileText, Folder, MessageSquare, MessageSquareText } from "lucide-react";
import { useTranslations } from "next-intl";

import { ProfileAvatar } from "~/components/ProfileAvatar";
import { Button } from "~/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Spinner } from "~/components/ui/spinner";
import {
    FEEDBACK_NOTIFICATION_TARGET,
    FEEDBACK_STATUSES,
    type FeedbackStatus,
} from "~/lib/feedback/contract";
import { usePeople } from "~/lib/profile/use-people";
import { cn } from "~/lib/utils";

import { useErrorText } from "../settings/people/ui";
import { teamApi, type InboxEntry } from "./api";
import { badgeCount, inboxSentence, inboxTarget, shortAgo, useTeamFormat } from "./format";
import type { TeamTarget } from "./types";

export const INBOX_POLL_MS = 60_000;

const TYPE_ICON = {
    document: FileText,
    folder: Folder,
    chat: MessageSquare,
    [FEEDBACK_NOTIFICATION_TARGET]: MessageSquareText,
} as const;

function isFeedbackEntry(entry: InboxEntry): boolean {
    return entry.targetType === FEEDBACK_NOTIFICATION_TARGET;
}

function feedbackStatusOf(entry: InboxEntry): FeedbackStatus | null {
    const status = entry.detail?.status;
    return typeof status === "string" && (FEEDBACK_STATUSES as readonly string[]).includes(status)
        ? (status as FeedbackStatus)
        : null;
}

function isHidden(): boolean {
    return typeof document !== "undefined" && document.visibilityState === "hidden";
}

export function InboxBell({
    onOpenTarget,
    onOpenFeedback,
}: {
    onOpenTarget: (target: TeamTarget) => void;
    /** Where a feedback entry goes: the report in the Feedback tab. */
    onOpenFeedback?: (reportId: number) => void;
}) {
    const t = useTranslations("team.inboxBell");
    const tFeedback = useTranslations("feedback.inbox");
    const tStatus = useTranslations("feedback.status");
    const errorText = useErrorText();
    const tTeam = useTranslations("team");
    const tc = useTranslations("common");
    const f = useTeamFormat();
    const [open, setOpen] = useState(false);
    const [entries, setEntries] = useState<InboxEntry[]>([]);
    const [unread, setUnread] = useState(0);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inflight = useRef(false);

    const refresh = useCallback(async () => {
        if (inflight.current) return;
        inflight.current = true;
        try {
            const res = await teamApi.inbox.list();
            setEntries(res.entries);
            setUnread(res.unread);
            setError(null);
        } catch (err) {
            setError(errorText(err, t("loadError")));
        } finally {
            inflight.current = false;
            setLoaded(true);
        }
    }, [t, errorText]);

    useEffect(() => {
        // Always once on mount: a page opened in a background tab (or a
        // webview that reports itself hidden) still needs its count. Only the
        // repeat waits for the tab to be visible.
        void refresh();
        const timer = window.setInterval(() => {
            if (!isHidden()) void refresh();
        }, INBOX_POLL_MS);
        const onFocus = () => void refresh();
        const onVisibility = () => {
            if (!isHidden()) void refresh();
        };
        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [refresh]);

    const people = usePeople(entries.map(e => e.actorUserId));

    const openEntry = (entry: InboxEntry) => {
        if (!entry.read) {
            setEntries(prev => prev.map(e => (e.id === entry.id ? { ...e, read: true } : e)));
            setUnread(n => Math.max(0, n - 1));
            void teamApi.inbox.markRead([entry.id]).catch(() => void refresh());
        }
        setOpen(false);
        if (isFeedbackEntry(entry)) {
            if (/^\d+$/.test(entry.targetId)) onOpenFeedback?.(Number(entry.targetId));
            return;
        }
        const target = inboxTarget(entry);
        if (target) onOpenTarget(target);
    };

    /** "Ada replied to your report “Upload stalls”" / "… marked it Done". */
    const feedbackSentence = (entry: InboxEntry, actor: string): string => {
        const status = feedbackStatusOf(entry);
        return entry.detail?.event === "status" && status
            ? tFeedback("status", { actor, name: entry.targetLabel, status: tStatus(status) })
            : tFeedback("reply", { actor, name: entry.targetLabel });
    };

    const markAllRead = () => {
        setEntries(prev => prev.map(e => ({ ...e, read: true })));
        setUnread(0);
        void teamApi.inbox.markRead().catch(() => void refresh());
    };

    return (
        <Popover
            open={open}
            onOpenChange={next => {
                setOpen(next);
                if (next) void refresh();
            }}
        >
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    data-testid="inbox-bell"
                    aria-label={unread > 0 ? t("labelUnread", { count: unread }) : t("title")}
                    title={t("title")}
                    className="text-ink-3 hover:text-ink relative size-[26px] rounded-md"
                >
                    <Bell className="size-[15px]" />
                    {unread > 0 && (
                        <span
                            data-testid="inbox-count"
                            aria-hidden
                            className="bg-brand text-brand-fg ring-panel absolute -right-1 -top-1 grid h-[15px] min-w-[15px] place-items-center rounded-full px-[3px] text-[9.5px] font-semibold leading-none ring-2"
                        >
                            {badgeCount(unread)}
                        </span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                sideOffset={6}
                className="w-[320px] max-w-[calc(100vw-24px)] p-0"
                data-testid="inbox-popover"
            >
                <div className="border-line flex h-10 items-center justify-between border-b pl-3.5 pr-1.5">
                    <h2 className="text-ink m-0 text-[13px] font-semibold">{t("title")}</h2>
                    {unread > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-ink-2 h-7 gap-1 px-2 text-[12px]"
                            onClick={markAllRead}
                        >
                            <CheckCheck className="size-3.5" />
                            {t("markAllRead")}
                        </Button>
                    )}
                </div>
                <div className="max-h-[min(420px,60vh)] overflow-y-auto py-1">
                    {!loaded ? (
                        <div className="text-ink-3 flex items-center gap-2 px-3.5 py-4 text-[12.5px]">
                            <Spinner className="size-3.5" /> {tc("status.loading")}
                        </div>
                    ) : error && entries.length === 0 ? (
                        <p className="text-danger m-0 px-3.5 py-4 text-[12.5px]" role="alert">
                            {error}
                        </p>
                    ) : entries.length === 0 ? (
                        <p className="text-ink-3 m-0 px-3.5 py-5 text-[12.5px] leading-relaxed">
                            {t("empty")}
                        </p>
                    ) : (
                        <ul className="m-0 list-none p-0">
                            {entries.map(entry => {
                                const actor = people[entry.actorUserId];
                                // A triager is an operator, often not a member of
                                // this workspace, so there may be nobody to look up.
                                const actorName =
                                    actor?.displayName ??
                                    (isFeedbackEntry(entry) ? tFeedback("team") : tTeam("someone"));
                                const Icon = TYPE_ICON[entry.targetType] ?? FileText;
                                const level = entry.detail?.level;
                                return (
                                    <li key={entry.id}>
                                        <button
                                            type="button"
                                            data-testid="inbox-entry"
                                            data-unread={entry.read ? undefined : "true"}
                                            onClick={() => openEntry(entry)}
                                            className="hover:bg-panel-2 focus-visible:bg-panel-2 flex w-full items-start gap-2.5 px-3.5 py-2 text-left outline-none"
                                        >
                                            <ProfileAvatar
                                                name={actorName}
                                                src={actor?.avatarUrl}
                                                className="mt-0.5 size-7"
                                                fallbackClassName="text-[10px]"
                                            />
                                            <span className="min-w-0 flex-1">
                                                <span
                                                    className={cn(
                                                        "block break-words text-[12.5px] leading-snug",
                                                        entry.read
                                                            ? "text-ink-2"
                                                            : "text-ink font-medium"
                                                    )}
                                                >
                                                    {isFeedbackEntry(entry)
                                                        ? feedbackSentence(entry, actorName)
                                                        : inboxSentence(f, actorName, entry)}
                                                </span>
                                                <span className="text-ink-3 mt-0.5 flex items-center gap-1 text-[11.5px]">
                                                    <Icon className="size-3 shrink-0" aria-hidden />
                                                    {level === "view" ||
                                                    level === "edit" ||
                                                    level === "manage"
                                                        ? `${tTeam(`levels.${level}`)} · `
                                                        : ""}
                                                    {shortAgo(f, entry.at)}
                                                </span>
                                            </span>
                                            {!entry.read && (
                                                <span
                                                    className="bg-brand mt-1.5 size-2 shrink-0 rounded-full"
                                                    aria-label={t("unread")}
                                                />
                                            )}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
