"use client";

import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import { useTranslations } from "next-intl";

interface BacklinkRow {
    sourceNoteId: number;
    title: string | null;
    snippet: string;
    linkedAs: string;
    sourceDocumentId?: string | null;
}

interface BacklinksPanelProps {
    /** Either a note id (loads `/api/notes/:id/backlinks`) or a document id
     *  (loads `/api/documents/:id/backlinks`). Provide one — not both. */
    noteId?: number;
    documentId?: string;
    /** Called when the user clicks an incoming row. */
    onOpenNote?: (noteId: number) => void;
}

/**
 * Compact incoming-references list. Shown alongside a note or document so
 * users can see what else in their notebook references this thing.
 */
export function BacklinksPanel({ noteId, documentId, onOpenNote }: BacklinksPanelProps) {
    const t = useTranslations("notes.backlinks");
    const [rows, setRows] = useState<BacklinkRow[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const url = noteId
            ? `/api/notes/${noteId}/backlinks`
            : documentId
              ? `/api/documents/${encodeURIComponent(documentId)}/backlinks`
              : null;
        if (!url) {
            setRows([]);
            return;
        }

        setRows(null);
        setError(null);
        void fetch(url)
            .then(async res => {
                if (!res.ok) throw new Error(t("requestFailed", { status: res.status }));
                const data = (await res.json()) as { incoming: BacklinkRow[] };
                if (!cancelled) setRows(data.incoming ?? []);
            })
            .catch(err => {
                if (!cancelled) setError(err instanceof Error ? err.message : t("failed"));
            });
        return () => {
            cancelled = true;
        };
    }, [noteId, documentId, t]);

    if (rows === null && !error) {
        return (
            <div
                style={{
                    padding: "10px 12px",
                    fontSize: 11,
                    color: "var(--ink-3)",
                }}
            >
                {t("loading")}
            </div>
        );
    }

    if (error) {
        return (
            <div
                style={{
                    padding: "10px 12px",
                    fontSize: 11,
                    color: "oklch(0.45 0.18 30)",
                }}
            >
                {t("error", { error })}
            </div>
        );
    }

    if (!rows || rows.length === 0) {
        return null;
    }

    return (
        <div
            style={{
                margin: "10px 6px 0",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px dashed var(--line-2)",
                background: "var(--panel-2)",
            }}
        >
            <div
                className="mono"
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    color: "var(--ink-3)",
                    textTransform: "uppercase",
                    marginBottom: 6,
                }}
            >
                <Link2 size={11} /> {t("heading", { count: rows.length })}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {rows.map(r => (
                    <button
                        key={r.sourceNoteId}
                        type="button"
                        onClick={() => onOpenNote?.(r.sourceNoteId)}
                        style={{
                            textAlign: "left",
                            padding: "6px 8px",
                            borderRadius: 6,
                            border: "1px solid var(--line-2)",
                            background: "var(--panel)",
                            color: "var(--ink)",
                            cursor: onOpenNote ? "pointer" : "default",
                            fontSize: 11,
                            lineHeight: 1.4,
                        }}
                    >
                        <div style={{ fontWeight: 600 }}>
                            {(r.title ?? "") || t("untitledNote")}
                        </div>
                        {r.snippet && (
                            <div
                                style={{
                                    fontSize: 10,
                                    color: "var(--ink-2)",
                                    marginTop: 2,
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-word",
                                }}
                            >
                                {r.snippet}
                            </div>
                        )}
                        <div
                            style={{
                                marginTop: 4,
                                fontSize: 9,
                                color: "var(--ink-3)",
                                fontStyle: "italic",
                            }}
                        >
                            {t("linkedAs", { name: r.linkedAs })}
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}
