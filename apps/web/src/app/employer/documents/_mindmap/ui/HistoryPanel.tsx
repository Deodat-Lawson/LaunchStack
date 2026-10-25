"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
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

/**
 * The label the editor stores on the snapshot of a freshly seeded template.
 * Snapshot labels are shared data, so they are stored in English and shown in
 * the reader's language — this one, and the server's "Restored from v3".
 */
export const SEED_SNAPSHOT_LABEL = "Created from template";
const RESTORED_LABEL = /^Restored from v(\d+)$/;

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
    const t = useTranslations("mindmap.history");
    const tc = useTranslations("common");
    const format = useFormatter();
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
            toast.error(t("loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [mindmapId, t]);

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
            toast.success(t("restored", { revision: row.revision }));
            void load();
        } catch {
            toast.error(t("restoreFailed"));
        } finally {
            setRestoring(null);
        }
    };

    return (
        <div className="flex h-full flex-col">
            <div className="border-line flex items-center justify-between border-b px-3 py-2">
                <span className="text-ink-3 font-mono text-[10px] font-semibold uppercase tracking-[0.08em]">
                    {t("versions")}
                </span>
                <Button variant="ghost" size="sm" onClick={() => void load()} className="h-6 px-2">
                    {tc("actions.refresh")}
                </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1">
                <div className="p-2">
                    {loading && (
                        <div className="text-ink-3 flex items-center justify-center gap-2 py-8 text-[13px]">
                            <Loader2 className="size-4 animate-spin" />
                            {tc("status.loading")}
                        </div>
                    )}
                    {!loading && rows.length === 0 && (
                        <div className="text-ink-3 px-3 py-8 text-center text-[13px]">
                            <History className="mx-auto mb-2 size-5" />
                            {t("empty")}
                        </div>
                    )}
                    {rows.map(row => (
                        <div
                            key={row.id}
                            className="hover:bg-panel-2 group flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px]"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="text-ink truncate font-medium">
                                    {revisionLabel(row, t)}
                                </div>
                                <div className="text-ink-3 text-[11px]">
                                    {t("meta", {
                                        when: format.dateTime(new Date(row.createdAt), {
                                            year: "numeric",
                                            month: "numeric",
                                            day: "numeric",
                                            hour: "numeric",
                                            minute: "2-digit",
                                            second: "2-digit",
                                        }),
                                        count: row.nodeCount,
                                    })}
                                </div>
                            </div>
                            <button
                                type="button"
                                title={t("restore", { revision: row.revision })}
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

/** A snapshot's name: the stored label in the reader's language, else its number. */
function revisionLabel(
    row: RevisionRow,
    t: ReturnType<typeof useTranslations<"mindmap.history">>
): string {
    if (row.label === null) return t("version", { revision: row.revision });
    if (row.label === SEED_SNAPSHOT_LABEL) return t("createdFromTemplate");
    const restored = RESTORED_LABEL.exec(row.label);
    if (restored) return t("restoredFrom", { revision: Number(restored[1]) });
    return row.label;
}
