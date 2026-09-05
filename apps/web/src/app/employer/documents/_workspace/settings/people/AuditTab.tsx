"use client";

import { AUDIT_ACTIONS } from "~/lib/authz/audit-actions";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download } from "lucide-react";

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

import { errorMessage, peopleApi, type AuditEvent } from "./api";
import { actionLabel, auditSentence, formatDateTime, relativeTime } from "./format";
import { EmptyState, ErrorNote, LoadingNote, Panel, TabIntro } from "./ui";

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
                setError(errorMessage(err, "Could not load the audit log."));
            } finally {
                if (more) setLoadingMore(false);
                else setLoading(false);
            }
        },
        [queryFor]
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
                <TabIntro title="Audit log" />
                <Panel>
                    <EmptyState
                        title="The audit log is not part of your role"
                        body="Ask an admin for the “Read the audit log” permission if you need it."
                    />
                </Panel>
            </div>
        );
    }

    return (
        <div>
            <TabIntro
                title="Audit log"
                description="Who changed what, newest first: roles, memberships, invitations, groups, and folder access. Filter by action or date, or export the current view."
                actions={
                    <Button asChild variant="outline" size="sm">
                        <a href={csvUrl} download>
                            <Download /> Export CSV
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
                    <Label htmlFor="audit-action">Action</Label>
                    <Select
                        value={draft.action}
                        onValueChange={value => setDraft(d => ({ ...d, action: value }))}
                    >
                        <SelectTrigger id="audit-action" size="sm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL}>All actions</SelectItem>
                            {actionOptions.map(a => (
                                <SelectItem key={a} value={a}>
                                    {actionLabel(a)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="audit-from">From</Label>
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
                    <Label htmlFor="audit-to">To</Label>
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
                    Apply filters
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
                        Reset
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
                    <LoadingNote label="Loading the audit log…" />
                ) : events.length === 0 ? (
                    <EmptyState
                        title={
                            filtersActive ? "Nothing matches these filters" : "Nothing recorded yet"
                        }
                        body={
                            filtersActive
                                ? "Widen the date range or pick a different action."
                                : "Changes to people, roles, groups, and folder access will show up here."
                        }
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
                                "System";
                            return (
                                <li key={event.id} className="border-line border-b last:border-b-0">
                                    <div className="flex items-start gap-3 px-4 py-3">
                                        <span
                                            aria-hidden
                                            className="bg-brand-soft text-brand-ink mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                                        >
                                            {actorName.charAt(0).toUpperCase()}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <div className="text-ink text-[13.5px] leading-snug">
                                                {auditSentence(event)}
                                            </div>
                                            <div className="text-ink-3 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
                                                {event.actor?.email && (
                                                    <span>{event.actor.email}</span>
                                                )}
                                                <time
                                                    dateTime={event.createdAt}
                                                    title={formatDateTime(event.createdAt)}
                                                >
                                                    {relativeTime(event.createdAt)}
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
                                                Details
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
                            {loadingMore ? "Loading…" : "Load more"}
                        </Button>
                    </div>
                )}
            </Panel>
        </div>
    );
}
