"use client";

import { AUDIT_ACTIONS } from "~/lib/authz/audit-actions";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, Download } from "lucide-react";

import { ProfileAvatar } from "~/components/ProfileAvatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import type { Permission } from "~/lib/authz/permissions";
import { getSetting } from "~/lib/settings/registry";
import { useSettingCopier } from "~/lib/settings/useSettings";

import { peopleApi, type AuditEvent } from "./api";
import { actionLabel, auditSentence, useTimeFormat, type AuditNames } from "./format";
import {
    EmptyState,
    ErrorNote,
    LoadingNote,
    Panel,
    TabIntro,
    useErrorText,
    useRoleLabel,
} from "./ui";

interface AuditTabProps {
    can: (permission: Permission | undefined) => boolean;
}

/** Actions the filter always offers, whether or not the first page happens to contain them. */
const KNOWN_ACTIONS: readonly string[] = AUDIT_ACTIONS;

const ALL = "__all__";
const PAGE_SIZE = 50;

interface Filters {
    action: string;
    from: string;
    to: string;
}

const EMPTY_FILTERS: Filters = { action: ALL, from: "", to: "" };

export function AuditTab({ can }: AuditTabProps) {
    const t = useTranslations("settings.people.auditTab");
    const ta = useTranslations("settings.people.audit");
    const tc = useTranslations("common");
    const time = useTimeFormat();
    const errorText = useErrorText();
    const roleLabel = useRoleLabel();
    const copier = useSettingCopier();
    // Roles and settings named the way the rest of the screen names them.
    const names = useMemo<AuditNames>(
        () => ({
            role: (slug, customName) => roleLabel(slug, customName),
            setting: (key, stored) => {
                const definition = key ? getSetting(key) : undefined;
                return definition ? copier(definition).label : stored;
            },
        }),
        [roleLabel, copier]
    );
    const canView = can("audit.view");

    const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
    const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
    const [events, setEvents] = useState<AuditEvent[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

    const queryFor = useCallback(
        (filters: Filters) => ({
            action: filters.action === ALL ? undefined : filters.action,
            from: filters.from || undefined,
            to: filters.to || undefined,
        }),
        []
    );

    const load = useCallback(
        async (filters: Filters, cursor: string | null) => {
            const more = cursor !== null;
            if (more) setLoadingMore(true);
            else setLoading(true);
            setError(null);
            try {
                const res = await peopleApi.audit.list({
                    ...queryFor(filters),
                    cursor,
                    limit: PAGE_SIZE,
                });
                setEvents(prev => (more ? [...prev, ...res.events] : res.events));
                setNextCursor(res.nextCursor);
            } catch (err) {
                setError(errorText(err, t("loadFailed")));
            } finally {
                if (more) setLoadingMore(false);
                else setLoading(false);
            }
        },
        [queryFor, errorText, t]
    );

    useEffect(() => {
        if (!canView) {
            setLoading(false);
            return;
        }
        void load(applied, null);
    }, [canView, applied, load]);

    const actionOptions = useMemo(() => {
        const set = new Set<string>(KNOWN_ACTIONS);
        for (const e of events) set.add(e.action);
        return [...set].sort();
    }, [events]);

    const csvUrl = peopleApi.audit.csvUrl(queryFor(applied));
    const filtersDirty =
        draft.action !== applied.action || draft.from !== applied.from || draft.to !== applied.to;
    const filtersActive = applied.action !== ALL || applied.from !== "" || applied.to !== "";

    if (!canView) {
        return (
            <div>
                <TabIntro title={t("title")} />
                <Panel>
                    <EmptyState title={t("notAllowed.title")} body={t("notAllowed.body")} />
                </Panel>
            </div>
        );
    }

    return (
        <div>
            <TabIntro
                title={t("title")}
                description={t("description")}
                actions={
                    <Button asChild variant="outline" size="sm">
                        <a href={csvUrl} download>
                            <Download /> {t("exportCsv")}
                        </a>
                    </Button>
                }
            />

            <form
                className="mb-4 flex flex-wrap items-end gap-3"
                onSubmit={e => {
                    e.preventDefault();
                    setApplied(draft);
                }}
            >
                <div className="flex min-w-[220px] flex-col gap-1.5">
                    <Label htmlFor="audit-action">{t("action")}</Label>
                    <Select
                        value={draft.action}
                        onValueChange={value => setDraft(d => ({ ...d, action: value }))}
                    >
                        <SelectTrigger id="audit-action" size="sm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL}>{t("allActions")}</SelectItem>
                            {actionOptions.map(a => (
                                <SelectItem key={a} value={a}>
                                    {actionLabel(ta, a)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="audit-from">{t("from")}</Label>
                    <Input
                        id="audit-from"
                        type="date"
                        className="h-8"
                        value={draft.from}
                        max={draft.to || undefined}
                        onChange={e => setDraft(d => ({ ...d, from: e.target.value }))}
                    />
                </div>
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="audit-to">{t("to")}</Label>
                    <Input
                        id="audit-to"
                        type="date"
                        className="h-8"
                        value={draft.to}
                        min={draft.from || undefined}
                        onChange={e => setDraft(d => ({ ...d, to: e.target.value }))}
                    />
                </div>
                <Button type="submit" size="sm" variant="outline" disabled={!filtersDirty}>
                    {t("apply")}
                </Button>
                {(filtersActive || filtersDirty) && (
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                            setDraft(EMPTY_FILTERS);
                            setApplied(EMPTY_FILTERS);
                        }}
                    >
                        {tc("actions.reset")}
                    </Button>
                )}
            </form>

            {error && (
                <div className="mb-4">
                    <ErrorNote message={error} onRetry={() => void load(applied, null)} />
                </div>
            )}

            <Panel>
                {loading ? (
                    <LoadingNote label={t("loading")} />
                ) : events.length === 0 ? (
                    <EmptyState
                        title={filtersActive ? t("empty.filteredTitle") : t("empty.title")}
                        body={filtersActive ? t("empty.filteredBody") : t("empty.body")}
                    />
                ) : (
                    <ol className="m-0 list-none p-0">
                        {events.map(event => {
                            const isOpen = expanded.has(event.id);
                            const hasDetail =
                                event.detail !== null && Object.keys(event.detail).length > 0;
                            // A blank name reads as "no name": fall through to the email.
                            const trimmedName = event.actor?.name?.trim();
                            const actorName =
                                (trimmedName?.length ? trimmedName : undefined) ??
                                event.actor?.email ??
                                t("system");
                            return (
                                <li key={event.id} className="border-line border-b last:border-b-0">
                                    <div className="flex items-start gap-3 px-4 py-3">
                                        <ProfileAvatar
                                            name={actorName}
                                            email={event.actor?.email}
                                            src={event.actor?.avatarUrl}
                                            className="mt-0.5 size-7"
                                            fallbackClassName="text-[11px]"
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="text-ink text-[13.5px] leading-snug">
                                                {auditSentence(ta, event, names)}
                                            </div>
                                            <div className="text-ink-3 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
                                                {event.actor?.email && (
                                                    <span>{event.actor.email}</span>
                                                )}
                                                <time
                                                    dateTime={event.createdAt}
                                                    title={time.dateTime(event.createdAt)}
                                                >
                                                    {time.relative(event.createdAt)}
                                                </time>
                                                <Badge
                                                    variant="secondary"
                                                    className="mono text-[10px]"
                                                >
                                                    {event.action}
                                                </Badge>
                                            </div>
                                        </div>
                                        {hasDetail && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                aria-expanded={isOpen}
                                                aria-controls={`audit-${event.id}-detail`}
                                                onClick={() =>
                                                    setExpanded(prev => {
                                                        const next = new Set(prev);
                                                        if (next.has(event.id))
                                                            next.delete(event.id);
                                                        else next.add(event.id);
                                                        return next;
                                                    })
                                                }
                                            >
                                                {isOpen ? <ChevronDown /> : <ChevronRight />}
                                                {t("details")}
                                            </Button>
                                        )}
                                    </div>
                                    {hasDetail && isOpen && (
                                        <pre
                                            id={`audit-${event.id}-detail`}
                                            className="bg-panel-2 text-ink-2 mono m-0 overflow-x-auto px-4 py-3 text-[11.5px] leading-relaxed"
                                        >
                                            {JSON.stringify(event.detail, null, 2)}
                                        </pre>
                                    )}
                                </li>
                            );
                        })}
                    </ol>
                )}
                {nextCursor && !loading && (
                    <div className="border-line flex justify-center border-t px-4 py-3">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={loadingMore}
                            onClick={() => void load(applied, nextCursor)}
                        >
                            {loadingMore ? tc("status.loading") : t("loadMore")}
                        </Button>
                    </div>
                )}
            </Panel>
        </div>
    );
}
