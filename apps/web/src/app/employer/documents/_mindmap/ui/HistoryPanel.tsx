"use client";

import React, { useCallback, useEffect, useState } from "react";
import { History, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";

import { parseDoc } from "../model/serialize";
import { useStore } from "./EditorContext";

/**
 * Version history.
 *
 * Snapshots are written server-side on explicit saves, so this panel is a thin
 * reader: fetch, list, restore. Restoring goes through the API rather than
 * replacing the document locally, because it also has to bump the row's
 * revision — otherwise the next autosave would 409 against itself.
 */

export interface RevisionRow {
    id: number;
    revision: number;
    label: string | null;
    authorUserId: string | null;
    nodeCount: number;
    createdAt: string;
}

export function HistoryPanel({
    mindmapId,
    onRestored,
}: {
    mindmapId: number;
    onRestored: (revision: number) => void;
}) {
    const store = useStore();
    const [rows, setRows] = useState<RevisionRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [restoring, setRestoring] = useState<number | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/mindmaps/${mindmapId}/revisions`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = (await res.json()) as { revisions: RevisionRow[] };
            setRows(body.revisions);
        } catch {
            toast.error("Couldn't load version history");
        } finally {
            setLoading(false);
        }
    }, [mindmapId]);

    useEffect(() => {
        void load();
    }, [load]);

    const restore = async (row: RevisionRow) => {
        setRestoring(row.id);
        try {
            const res = await fetch(`/api/mindmaps/${mindmapId}/revisions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ revisionId: row.id }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = (await res.json()) as {
                mindmap: { doc: unknown; revision: number; title: string };
            };
            store.replaceDoc(parseDoc(body.mindmap.doc, body.mindmap.title), {
                label: `Restore v${row.revision}`,
            });
            store.markSaved();
            onRestored(body.mindmap.revision);
            toast.success(`Restored version ${row.revision}`);
            void load();
        } catch {
            toast.error("Couldn't restore that version");
        } finally {
            setRestoring(null);
        }
    };

    return (
        <div className="flex h-full flex-col">
            <div className="border-line flex items-center justify-between border-b px-3 py-2">
                <span className="text-ink-3 font-mono text-[10px] font-semibold uppercase tracking-[0.08em]">
                    Versions
                </span>
                <Button variant="ghost" size="sm" onClick={() => void load()} className="h-6 px-2">
                    Refresh
                </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1">
                <div className="p-2">
                    {loading && (
                        <div className="text-ink-3 flex items-center justify-center gap-2 py-8 text-[13px]">
                            <Loader2 className="size-4 animate-spin" />
                            Loading…
                        </div>
                    )}
                    {!loading && rows.length === 0 && (
                        <div className="text-ink-3 px-3 py-8 text-center text-[13px]">
                            <History className="mx-auto mb-2 size-5" />
                            No snapshots yet. Saving with ⌘S records one.
                        </div>
                    )}
                    {rows.map(row => (
                        <div
                            key={row.id}
                            className="hover:bg-panel-2 group flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px]"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="text-ink truncate font-medium">
                                    {row.label ?? `Version ${row.revision}`}
                                </div>
                                <div className="text-ink-3 text-[11px]">
                                    {new Date(row.createdAt).toLocaleString()} · {row.nodeCount}{" "}
                                    shape{row.nodeCount === 1 ? "" : "s"}
                                </div>
                            </div>
                            <button
                                type="button"
                                title={`Restore version ${row.revision}`}
                                disabled={restoring !== null}
                                onClick={() => void restore(row)}
                                className="text-ink-3 hover:bg-brand-soft hover:text-brand-ink shrink-0 rounded-md p-1 opacity-0 transition-opacity disabled:opacity-40 group-hover:opacity-100"
                            >
                                {restoring === row.id ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                    <RotateCcw className="size-3.5" />
                                )}
                            </button>
                        </div>
                    ))}
                </div>
            </ScrollArea>
        </div>
    );
}
