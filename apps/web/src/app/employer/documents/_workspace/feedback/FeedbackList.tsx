"use client";

/**
 * The three list screens of the Feedback tab. One component, because they
 * differ only in whose reports they ask for and which filters make sense:
 *
 * - **My reports** — newest activity first, both kinds, so a reply is at the top.
 * - **Ideas** — the shared board: most votes first, vote from the row.
 * - **Triage** — everything, with who filed it, from where, and whether the
 *   last word in the thread is theirs (a dot: it wants an answer).
 *
 * Filters live in the screen's query (`?status=planned&q=export`), so Back,
 * Forward and "Copy link" keep them.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Bug, Lightbulb, MessageSquare, Paperclip } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { useFeedback } from "~/components/feedback/FeedbackProvider";
import { feedbackKeys } from "~/components/feedback/keys";
import { KindIcon, SeverityBadge, StatusBadge } from "~/components/feedback/labels";
import { VoteButton } from "~/components/feedback/VoteButton";
import { EmptyState } from "~/components/tools/EmptyState";
import { PageHeader } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { useToolActive, useToolNav, useToolSearchParams } from "~/components/tool-app/nav";
import { Button } from "~/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { FeedbackApiError, listFeedback, onFeedbackChanged } from "~/lib/feedback/api";
import {
    FEEDBACK_KINDS,
    FEEDBACK_STATUSES,
    type FeedbackKind,
    type FeedbackListItem,
    type FeedbackScreen,
    type FeedbackStatus,
} from "~/lib/feedback/contract";
import { cn } from "~/lib/utils";

import { ErrorLine, FilterInput } from "../team/ui";
import { feedbackPaths } from "./screens";

const ALL = "all";

function readStatus(value: string | null): FeedbackStatus | undefined {
    return value && (FEEDBACK_STATUSES as readonly string[]).includes(value)
        ? (value as FeedbackStatus)
        : undefined;
}

function readKind(value: string | null): FeedbackKind | undefined {
    return value && (FEEDBACK_KINDS as readonly string[]).includes(value)
        ? (value as FeedbackKind)
        : undefined;
}

export function FeedbackList({ screen }: { screen: FeedbackScreen }) {
    const t = useTranslations("feedback.list");
    const ts = useTranslations("feedback.status");
    const tk = useTranslations("feedback.kind");
    const feedback = useFeedback();
    const { navigate } = useToolNav();
    const params = useToolSearchParams();
    const active = useToolActive();

    const status = readStatus(params.get("status"));
    const kind = screen === "triage" ? readKind(params.get("kind")) : undefined;
    const sort =
        screen === "ideas" && params.get("sort") !== "recent"
            ? "votes"
            : ("recent" as "votes" | "recent");
    const [query, setQuery] = useState(params.get("q") ?? "");
    const [debounced, setDebounced] = useState(query);
    const [items, setItems] = useState<FeedbackListItem[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        const timer = window.setTimeout(() => setDebounced(query), 250);
        return () => window.clearTimeout(timer);
    }, [query]);

    const setFilter = useCallback(
        (next: Record<string, string | null>) => {
            const search = new URLSearchParams(params);
            for (const [key, value] of Object.entries(next)) {
                if (value === null) search.delete(key);
                else search.set(key, value);
            }
            const text = search.toString();
            navigate(text ? `?${text}` : "?", { replace: true });
        },
        [navigate, params]
    );

    useEffect(() => {
        const controller = new AbortController();
        setError(null);
        listFeedback(
            { scope: screen, status, kind, q: debounced, sort, limit: 100 },
            controller.signal
        )
            .then(next => setItems(next))
            .catch(err => {
                if (controller.signal.aborted) return;
                setError(
                    err instanceof FeedbackApiError && err.message ? err.message : t("loadFailed")
                );
                setItems(current => current ?? []);
            });
        return () => controller.abort();
    }, [screen, status, kind, debounced, sort, reloadKey, t]);

    // A report sent from the dialog, a vote from another row, a reply: reload.
    useEffect(() => onFeedbackChanged(() => setReloadKey(k => k + 1)), []);
    // Coming back to the tab is when a reply from the team is most likely new.
    useEffect(() => {
        if (active) setReloadKey(k => k + 1);
    }, [active]);

    const filtered = status !== undefined || kind !== undefined || debounced.trim() !== "";

    const header = (() => {
        if (screen === "mine")
            return (
                <PageHeader
                    title={t("mine.title")}
                    sub={t("mine.sub")}
                    actions={
                        <>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => feedback.open({ kind: "idea" })}
                            >
                                <Lightbulb aria-hidden />
                                {t("requestFeature")}
                            </Button>
                            <Button
                                size="sm"
                                onClick={() => feedback.open({ kind: "bug" })}
                                data-testid="feedback-list-report-bug"
                            >
                                <Bug aria-hidden />
                                {t("reportBug")}
                            </Button>
                        </>
                    }
                />
            );
        if (screen === "ideas")
            return (
                <PageHeader
                    title={t("ideas.title")}
                    sub={t("ideas.sub")}
                    actions={
                        <Button
                            size="sm"
                            onClick={() => feedback.open({ kind: "idea" })}
                            data-testid="feedback-list-request"
                        >
                            <Lightbulb aria-hidden />
                            {t("requestFeature")}
                        </Button>
                    }
                />
            );
        return <PageHeader title={t("triage.title")} sub={t("triage.sub")} />;
    })();

    return (
        <div
            className="mx-auto flex max-w-[1100px] flex-col gap-5"
            data-testid={`feedback-${screen}`}
        >
            {header}
            <div className="flex flex-wrap items-center gap-2">
                <FilterInput
                    value={query}
                    onChange={value => {
                        setQuery(value);
                        setFilter({ q: value.trim() ? value : null });
                    }}
                    placeholder={t("filterPlaceholder")}
                />
                {screen === "triage" && (
                    <Select
                        value={kind ?? ALL}
                        onValueChange={v => setFilter({ kind: v === ALL ? null : v })}
                    >
                        <SelectTrigger
                            className="@max-md:w-full h-8 w-40 text-xs"
                            aria-label={t("kindLabel")}
                            data-testid="feedback-filter-kind"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL}>{t("allKinds")}</SelectItem>
                            {FEEDBACK_KINDS.map(k => (
                                <SelectItem key={k} value={k}>
                                    {tk(`${k}Plural`)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
                <Select
                    value={status ?? ALL}
                    onValueChange={v => setFilter({ status: v === ALL ? null : v })}
                >
                    <SelectTrigger
                        className="@max-md:w-full h-8 w-40 text-xs"
                        aria-label={t("statusLabel")}
                        data-testid="feedback-filter-status"
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL}>{t("allStatuses")}</SelectItem>
                        {FEEDBACK_STATUSES.map(s => (
                            <SelectItem key={s} value={s}>
                                {ts(s)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {screen === "ideas" && (
                    <ToggleGroup
                        type="single"
                        variant="outline"
                        size="sm"
                        value={sort}
                        onValueChange={v => v && setFilter({ sort: v === "votes" ? null : v })}
                        aria-label={t("sortLabel")}
                        className="@max-md:ml-0 ml-auto"
                    >
                        <ToggleGroupItem value="votes" className="shrink-0 px-2.5 text-xs">
                            {t("sortVotes")}
                        </ToggleGroupItem>
                        <ToggleGroupItem value="recent" className="shrink-0 px-2.5 text-xs">
                            {t("sortRecent")}
                        </ToggleGroupItem>
                    </ToggleGroup>
                )}
            </div>
            {error && <ErrorLine flush message={error} onRetry={() => setReloadKey(k => k + 1)} />}
            {items === null ? (
                <SkeletonRows rows={5} height={62} />
            ) : items.length === 0 ? (
                <EmptyState
                    title={filtered ? t("emptyFiltered") : t(`${screen}.emptyTitle`)}
                    body={
                        filtered
                            ? undefined
                            : screen === "mine"
                              ? t("mine.emptyBody", { report: feedbackKeys().report })
                              : t(`${screen}.emptyBody`)
                    }
                />
            ) : (
                <ul
                    className="border-line bg-panel m-0 list-none overflow-hidden rounded-lg border p-0"
                    data-testid="feedback-rows"
                >
                    {items.map(item => (
                        <li key={item.id} className="border-line-2 border-t first:border-t-0">
                            <FeedbackRow item={item} screen={screen} />
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function FeedbackRow({ item, screen }: { item: FeedbackListItem; screen: FeedbackScreen }) {
    const t = useTranslations("feedback.list");
    const format = useFormatter();
    const showVote = item.kind === "idea" && screen !== "triage";
    return (
        <ToolLink
            href={feedbackPaths.report(screen, item.id)}
            data-testid="feedback-row"
            className="hover:bg-panel-2 focus-visible:ring-brand flex min-w-0 items-center gap-3 px-4 py-3 no-underline outline-none focus-visible:ring-2 focus-visible:ring-inset"
        >
            {showVote ? (
                <VoteButton id={item.id} votes={item.votes} voted={item.voted} />
            ) : (
                <span className="bg-panel-2 flex size-8 shrink-0 items-center justify-center rounded-md">
                    <KindIcon kind={item.kind} />
                </span>
            )}
            <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-ink flex min-w-0 items-center gap-2 text-[13.5px] font-medium">
                    {screen === "triage" && item.awaitingReply && (
                        <span
                            className="bg-brand size-2 shrink-0 rounded-full"
                            title={t("awaitingReply")}
                            aria-label={t("awaitingReply")}
                            role="img"
                        />
                    )}
                    <span className="truncate">{item.title}</span>
                </span>
                <span className="text-ink-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
                    <span className="tabular-nums">#{item.id}</span>
                    <span aria-hidden>·</span>
                    <span>{format.relativeTime(new Date(item.updatedAt), new Date())}</span>
                    {screen === "triage" && item.reporter && (
                        <>
                            <span aria-hidden>·</span>
                            <span className="truncate">
                                {item.reporter.name || item.reporter.email}
                                {item.workspaceName ? ` — ${item.workspaceName}` : ""}
                            </span>
                        </>
                    )}
                    {screen === "mine" && item.kind === "idea" && (
                        <>
                            <span aria-hidden>·</span>
                            <span>{t("votes", { count: item.votes })}</span>
                        </>
                    )}
                    {item.replies > 0 && (
                        <span
                            className="inline-flex items-center gap-1"
                            title={t("replies", { count: item.replies })}
                        >
                            <MessageSquare className="size-3" aria-hidden />
                            <span className="tabular-nums">{item.replies}</span>
                        </span>
                    )}
                    {item.attachments > 0 && (
                        <span
                            className="inline-flex items-center gap-1"
                            title={t("attachments", { count: item.attachments })}
                        >
                            <Paperclip className="size-3" aria-hidden />
                            <span className="tabular-nums">{item.attachments}</span>
                        </span>
                    )}
                </span>
            </span>
            <span
                className={cn(
                    "flex shrink-0 items-center gap-1.5",
                    "@max-sm:flex-col @max-sm:items-end"
                )}
            >
                {screen === "triage" && item.severity && <SeverityBadge severity={item.severity} />}
                <StatusBadge status={item.status} />
            </span>
        </ToolLink>
    );
}
