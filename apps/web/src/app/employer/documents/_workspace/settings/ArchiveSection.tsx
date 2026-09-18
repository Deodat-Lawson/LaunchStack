"use client";

/**
 * Archive and retention.
 *
 * Body only. One list for everything the workspace has put away, grouped by
 * kind, searchable, with restore and permanent delete on rows and on a
 * selection. Deleting for good asks once and names the count. The retention
 * row is a registry setting; the list says what it removed on this read.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Card, Section } from "~/components/layout/page-shell";
import { usePermissions } from "~/lib/use-permissions";
import { cn } from "~/lib/utils";

import { usePublishedActions, type SettingsSectionProps } from "./contract";
import { relativeTime } from "./people/format";
import { ConfirmDialog } from "./people/ui";
import { SettingRow } from "./SettingRow";
import { StatusNote } from "./ui";

type ArchiveKind = "mindmap" | "artifact" | "agent" | "channel";

interface ArchivedItem {
    kind: ArchiveKind;
    id: string;
    title: string;
    detail: string | null;
    archivedAt: string | null;
    deletable: boolean;
}

interface ArchiveOverview {
    items: ArchivedItem[];
    trashDays: number | null;
    purged: number;
}

const KIND_LABEL: Record<ArchiveKind, string> = {
    mindmap: "Mindmap",
    artifact: "Artifact",
    agent: "Retired agent",
    channel: "Archived channel",
};

const KIND_ORDER: ArchiveKind[] = ["mindmap", "artifact", "channel", "agent"];

function itemKey(item: { kind: ArchiveKind; id: string }): string {
    return `${item.kind}:${item.id}`;
}

export function ArchiveSection({ onActions }: SettingsSectionProps) {
    const { can } = usePermissions();
    const [overview, setOverview] = useState<ArchiveOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [pending, setPending] = useState<{
        action: "restore" | "delete";
        items: ArchivedItem[];
    } | null>(null);
    const [busy, setBusy] = useState(false);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/settings/archive");
            const body = (await res.json().catch(() => ({}))) as ArchiveOverview & {
                error?: string;
            };
            if (!res.ok)
                throw new Error(body.error ?? `Could not load the archive (${res.status}).`);
            setOverview(body);
            setError(null);
            setSelected(new Set());
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not load the archive.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    usePublishedActions(
        onActions,
        {
            primaryLabel: "Refresh",
            primaryBusyLabel: "Refreshing…",
            onPrimary: refresh,
            busy: loading,
        },
        [refresh, loading]
    );

    const items = useMemo(() => {
        const all = overview?.items ?? [];
        const q = query.trim().toLowerCase();
        if (!q) return all;
        // Every term must match somewhere; a hit on the title outranks the detail.
        const terms = q.split(/\s+/);
        return all
            .map(item => {
                const hay =
                    `${item.title} ${item.detail ?? ""} ${KIND_LABEL[item.kind]}`.toLowerCase();
                if (!terms.every(term => hay.includes(term))) return null;
                const score = terms.filter(term => item.title.toLowerCase().includes(term)).length;
                return { item, score };
            })
            .filter((entry): entry is { item: ArchivedItem; score: number } => entry !== null)
            .sort((a, b) => b.score - a.score)
            .map(entry => entry.item);
    }, [overview, query]);

    const grouped = useMemo(
        () =>
            KIND_ORDER.map(kind => ({
                kind,
                items: items.filter(item => item.kind === kind),
            })).filter(g => g.items.length > 0),
        [items]
    );

    const selectedItems = items.filter(item => selected.has(itemKey(item)));
    const canDelete = can("documents.delete");

    const run = async (action: "restore" | "delete", targets: ArchivedItem[]) => {
        setBusy(true);
        try {
            const res = await fetch("/api/settings/archive", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action,
                    items: targets.map(item => ({ kind: item.kind, id: item.id })),
                }),
            });
            const body = (await res.json().catch(() => ({}))) as {
                done?: number;
                failed?: Array<{ reason: string }>;
                error?: string;
            };
            if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
            const done = body.done ?? 0;
            const failed = body.failed ?? [];
            if (done > 0) {
                toast.success(
                    action === "restore"
                        ? `Restored ${done} ${done === 1 ? "item" : "items"}`
                        : `Deleted ${done} ${done === 1 ? "item" : "items"} for good`
                );
            }
            if (failed.length > 0) toast.error(failed[0]!.reason);
            await refresh();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "That did not work.");
        } finally {
            setBusy(false);
            setPending(null);
        }
    };

    return (
        <>
            {error && <StatusNote tone="danger">{error}</StatusNote>}
            {overview && overview.purged > 0 && (
                <StatusNote tone="warn">
                    The retention window removed {overview.purged}{" "}
                    {overview.purged === 1 ? "item" : "items"} older than {overview.trashDays} days
                    when this page loaded.
                </StatusNote>
            )}

            <Section
                title="Retention"
                description="What the trash empties on its own. Retired agents and archived channels are never removed automatically."
            >
                <Card>
                    <SettingRow settingKey="retention.trashDays" />
                </Card>
            </Section>

            <Section
                title="Put away"
                description={
                    overview
                        ? `${overview.items.length} ${overview.items.length === 1 ? "item" : "items"}. Restore puts a thing back where it was; delete is for good.`
                        : "Loading…"
                }
            >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search the archive"
                        className="max-w-[320px]"
                        aria-label="Search the archive"
                    />
                    <div className="flex-1" />
                    {selectedItems.length > 0 && (
                        <>
                            <span className="text-ink-3 text-[12px]">
                                {selectedItems.length} selected
                            </span>
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() =>
                                    setPending({ action: "restore", items: selectedItems })
                                }
                            >
                                Restore
                            </Button>
                            <Button
                                size="sm"
                                variant="destructive"
                                disabled={
                                    busy ||
                                    !canDelete ||
                                    selectedItems.some(item => !item.deletable)
                                }
                                title={
                                    !canDelete
                                        ? "Deleting for good needs documents.delete."
                                        : selectedItems.some(item => !item.deletable)
                                          ? "Agents and channels cannot be deleted for good."
                                          : undefined
                                }
                                onClick={() =>
                                    setPending({ action: "delete", items: selectedItems })
                                }
                            >
                                Delete for good
                            </Button>
                        </>
                    )}
                </div>

                {loading && !overview ? (
                    <StatusNote tone="muted">Loading the archive…</StatusNote>
                ) : items.length === 0 ? (
                    <Card>
                        <div className="text-ink-3 py-6 text-center text-[13px]">
                            {query ? "Nothing matches." : "Nothing is put away."}
                        </div>
                    </Card>
                ) : (
                    grouped.map(group => (
                        <Card key={group.kind} padding={0} className="mb-3">
                            <div className="border-line text-ink-3 mono border-b px-5 py-2 text-[10px] font-bold uppercase tracking-[0.08em]">
                                {KIND_LABEL[group.kind]}
                                {group.items.length > 1 ? "s" : ""} · {group.items.length}
                            </div>
                            {group.items.map((item, index) => {
                                const key = itemKey(item);
                                const checked = selected.has(key);
                                return (
                                    <div
                                        key={key}
                                        className={cn(
                                            "flex items-center gap-3 px-5 py-2.5",
                                            index > 0 && "border-line border-t"
                                        )}
                                    >
                                        <Checkbox
                                            checked={checked}
                                            onCheckedChange={value => {
                                                setSelected(prev => {
                                                    const next = new Set(prev);
                                                    if (value) next.add(key);
                                                    else next.delete(key);
                                                    return next;
                                                });
                                            }}
                                            aria-label={`Select ${item.title}`}
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="text-ink truncate text-[13px] font-semibold">
                                                {item.title}
                                            </div>
                                            <div className="text-ink-3 text-[12px]">
                                                {item.detail}
                                                {item.archivedAt
                                                    ? ` · ${relativeTime(item.archivedAt)}`
                                                    : ""}
                                            </div>
                                        </div>
                                        {!item.deletable && (
                                            <Badge variant="secondary">Keeps its history</Badge>
                                        )}
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            disabled={busy}
                                            onClick={() => void run("restore", [item])}
                                        >
                                            Restore
                                        </Button>
                                        {item.deletable && (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="text-danger"
                                                disabled={busy || !canDelete}
                                                onClick={() =>
                                                    setPending({ action: "delete", items: [item] })
                                                }
                                            >
                                                Delete
                                            </Button>
                                        )}
                                    </div>
                                );
                            })}
                        </Card>
                    ))
                )}
            </Section>

            <ConfirmDialog
                open={pending !== null}
                title={
                    pending?.action === "delete"
                        ? `Delete ${pending.items.length === 1 ? `“${pending.items[0]!.title}”` : `${pending.items.length} items`} for good?`
                        : `Restore ${pending?.items.length === 1 ? `“${pending.items[0]!.title}”` : `${pending?.items.length ?? 0} items`}?`
                }
                body={
                    pending?.action === "delete"
                        ? "This removes the item and everything attached to it. There is no undo."
                        : "Each item goes back to where it was."
                }
                confirmLabel={pending?.action === "delete" ? "Delete for good" : "Restore"}
                busyLabel={pending?.action === "delete" ? "Deleting…" : "Restoring…"}
                danger={pending?.action === "delete"}
                busy={busy}
                onClose={() => setPending(null)}
                onConfirm={() => {
                    if (pending) void run(pending.action, pending.items);
                }}
            />
        </>
    );
}
