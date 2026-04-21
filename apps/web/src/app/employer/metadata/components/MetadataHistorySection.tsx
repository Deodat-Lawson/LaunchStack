"use client";

import React, { useState, useEffect, useCallback } from "react";
import { History, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "~/app/employer/documents/components/ui/card";
import { cn } from "~/lib/utils";
import type { MetadataDiff, ChangeType } from "@launchstack/features/company-metadata";

interface HistoryEntry {
    id: number;
    changeType: ChangeType;
    diff: MetadataDiff;
    changedBy: string;
    documentId: bigint | null;
    createdAt: string;
}

interface HistoryResponse {
    history: HistoryEntry[];
    error?: string;
}

const changeTypeConfig: Record<ChangeType, { label: string; className: string }> = {
    extraction: {
        label: "AI Extraction",
        className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    },
    merge: {
        label: "Merge",
        className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    },
    manual_override: {
        label: "Manual Edit",
        className: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
    },
    deprecation: {
        label: "Deprecation",
        className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    },
};

function DiffSummary({ diff, expanded }: { diff: MetadataDiff; expanded: boolean }) {
    const totalChanges = diff.added.length + diff.updated.length + diff.deprecated.length;
    if (totalChanges === 0) {
        return <p className="text-xs text-muted-foreground">No field changes recorded.</p>;
    }

    return (
        <div className="space-y-1">
            {/* Summary chips */}
            <div className="flex gap-2 flex-wrap">
                {diff.added.length > 0 && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        +{diff.added.length} added
                    </span>
                )}
                {diff.updated.length > 0 && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                        ~{diff.updated.length} updated
                    </span>
                )}
                {diff.deprecated.length > 0 && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                        -{diff.deprecated.length} deprecated
                    </span>
                )}
            </div>

            {/* Expanded field paths */}
            {expanded && (
                <div className="mt-2 space-y-1 border-l-2 border-border pl-3">
                    {diff.added.map((entry, i) => (
                        <div key={i} className="text-xs text-green-700 dark:text-green-400 font-mono">
                            + {entry.path}
                            {entry.new && (
                                <span className="text-muted-foreground ml-2">
                                    → {String((entry.new as { value?: unknown }).value ?? "").slice(0, 60)}
                                </span>
                            )}
                        </div>
                    ))}
                    {diff.updated.map((entry, i) => (
                        <div key={i} className="text-xs text-blue-700 dark:text-blue-400 font-mono">
                            ~ {entry.path}
                            {entry.old && entry.new && (
                                <span className="text-muted-foreground ml-2">
                                    {String((entry.old as { value?: unknown }).value ?? "").slice(0, 30)}
                                    {" → "}
                                    {String((entry.new as { value?: unknown }).value ?? "").slice(0, 30)}
                                </span>
                            )}
                        </div>
                    ))}
                    {diff.deprecated.map((entry, i) => (
                        <div key={i} className="text-xs text-amber-700 dark:text-amber-400 font-mono">
                            - {entry.path}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function HistoryEntryRow({ entry }: { entry: HistoryEntry }) {
    const [expanded, setExpanded] = useState(false);
    const config = changeTypeConfig[entry.changeType];
    const totalChanges = entry.diff.added.length + entry.diff.updated.length + entry.diff.deprecated.length;
    const date = new Date(entry.createdAt);
    const dateStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    const timeStr = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

    return (
        <div className="relative pl-6">
            {/* Timeline dot */}
            <div className="absolute left-0 top-1.5 w-3 h-3 rounded-full border-2 border-border bg-background" />

            <div className="pb-4">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", config.className)}>
                            {config.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                            {dateStr} at {timeStr}
                        </span>
                    </div>
                    {totalChanges > 0 && (
                        <button
                            onClick={() => setExpanded((v) => !v)}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        >
                            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            {expanded ? "Hide" : "Details"}
                        </button>
                    )}
                </div>

                <div className="mt-1.5">
                    <DiffSummary diff={entry.diff} expanded={expanded} />
                </div>
            </div>
        </div>
    );
}

export function MetadataHistorySection() {
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showAll, setShowAll] = useState(false);

    const INITIAL_SHOW = 10;

    const fetchHistory = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/company/metadata/history");
            const data = (await res.json()) as HistoryResponse;
            if (data.error) throw new Error(data.error);
            setHistory(data.history);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load history");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void fetchHistory();
    }, [fetchHistory]);

    const displayed = showAll ? history : history.slice(0, INITIAL_SHOW);

    return (
        <Card className="border-none shadow-sm">
            <CardHeader className="border-b border-border pb-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-slate-600 rounded-lg">
                            <History className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <CardTitle className="text-lg font-bold">Change History</CardTitle>
                            <p className="text-sm text-muted-foreground">
                                Audit log of all metadata updates
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => void fetchHistory()}
                        disabled={loading}
                        className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                        title="Refresh history"
                    >
                        <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                    </button>
                </div>
            </CardHeader>
            <CardContent className="pt-6">
                {loading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Loading history...
                    </div>
                ) : error ? (
                    <p className="text-sm text-destructive py-4">{error}</p>
                ) : history.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">No history yet. Changes will appear here after extractions or manual edits.</p>
                ) : (
                    <>
                        {/* Timeline */}
                        <div className="relative border-l-2 border-border ml-1.5">
                            {displayed.map((entry) => (
                                <HistoryEntryRow key={entry.id} entry={entry} />
                            ))}
                        </div>

                        {history.length > INITIAL_SHOW && (
                            <button
                                onClick={() => setShowAll((v) => !v)}
                                className="mt-3 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                            >
                                {showAll ? (
                                    <><ChevronUp className="w-3 h-3" /> Show less</>
                                ) : (
                                    <><ChevronDown className="w-3 h-3" /> Show {history.length - INITIAL_SHOW} more</>
                                )}
                            </button>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
}
