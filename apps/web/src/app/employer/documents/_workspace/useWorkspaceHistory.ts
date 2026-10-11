"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
    applyPinOrder,
    byPinOrder,
    type HistoryEntry,
    type HistoryKind,
} from "~/lib/workspace-history";

import type { SessionMessagePayload, StoredSession } from "./sessionApi";
import * as sessionApi from "./sessionApi";

export interface ArchivedHistoryState {
    /** The Archived view is showing in place of the list. */
    open: boolean;
    entries: HistoryEntry[];
    loading: boolean;
    error: string | null;
    /** How many chats are archived, when the server said; null while unknown. */
    count: number | null;
}

export interface WorkspaceHistoryState {
    entries: HistoryEntry[];
    loading: boolean;
    error: string | null;
    /** Kinds whose loader failed on the last fetch — shown as an honest partial list. */
    degraded: HistoryKind[];
    refresh: () => Promise<void>;
    /** Drop a chat from the list without waiting for a round trip. */
    removeEntry: (id: string) => void;
    /** Rewrite one chat's title in place, for an optimistic rename. */
    renameEntry: (id: string, title: string) => void;
    /** Pin or unpin a chat for me (ADR-014 §5); a new pin goes on top. */
    setPinned: (entry: HistoryEntry, pinned: boolean) => void;
    /** Archive (hide) or restore a chat, for me only. */
    setArchived: (entry: HistoryEntry, archived: boolean) => void;
    /** Rewrite my pinned order, top first (session ids). */
    reorderPins: (ids: readonly string[]) => void;
    /** I opened a chat shared with me: clear its unread dot. */
    markSeen: (sessionId: string) => void;
    archived: ArchivedHistoryState;
    setArchivedOpen: (open: boolean) => void;
}

const message = (err: unknown, fallback: string) =>
    err instanceof Error && err.message ? err.message : fallback;

/**
 * The History feed behind the sidebar.
 *
 * One endpoint, one list. It refetches when the workspace changes and after
 * every mutation the rail performs, and it never polls: a run that finishes
 * while you are looking at the sidebar is not worth a request every few
 * seconds, and the refresh button (and any send) brings it in.
 *
 * Organising (pin, archive, reorder) is optimistic: the row moves now and
 * moves back, with a toast, if the server says no.
 */
export function useWorkspaceHistory(enabled: boolean): WorkspaceHistoryState {
    const [entries, setEntries] = useState<HistoryEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [degraded, setDegraded] = useState<HistoryKind[]>([]);
    const [archived, setArchivedState] = useState<ArchivedHistoryState>({
        open: false,
        entries: [],
        loading: false,
        error: null,
        count: null,
    });
    /** Guards against a slow response from an earlier fetch overwriting a newer one. */
    const requestId = useRef(0);
    const archivedRequestId = useRef(0);
    /** Read inside callbacks that must not re-create on every list change. */
    const entriesRef = useRef(entries);
    entriesRef.current = entries;
    const archivedRef = useRef(archived);
    archivedRef.current = archived;

    const refresh = useCallback(async () => {
        if (!enabled) return;
        const id = ++requestId.current;
        setLoading(true);
        try {
            const page = await sessionApi.fetchHistory();
            if (id !== requestId.current) return;
            setEntries(page.entries);
            setDegraded(page.degraded);
            if (typeof page.archivedCount === "number") {
                const count = page.archivedCount;
                setArchivedState(prev => ({ ...prev, count }));
            }
            setError(null);
        } catch (err) {
            if (id !== requestId.current) return;
            setError(message(err, "Couldn't load history"));
        } finally {
            if (id === requestId.current) setLoading(false);
        }
    }, [enabled]);

    const loadArchived = useCallback(async () => {
        if (!enabled) return;
        const id = ++archivedRequestId.current;
        setArchivedState(prev => ({ ...prev, loading: true }));
        try {
            const page = await sessionApi.fetchHistory({ archived: true });
            if (id !== archivedRequestId.current) return;
            setArchivedState(prev => ({
                ...prev,
                entries: page.entries,
                count: page.entries.length,
                loading: false,
                error: null,
            }));
        } catch (err) {
            if (id !== archivedRequestId.current) return;
            setArchivedState(prev => ({
                ...prev,
                loading: false,
                error: message(err, "Couldn't load archived chats"),
            }));
        }
    }, [enabled]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const setArchivedOpen = useCallback(
        (open: boolean) => {
            setArchivedState(prev => ({ ...prev, open }));
            if (open) void loadArchived();
        },
        [loadArchived]
    );

    const removeEntry = useCallback((id: string) => {
        setEntries(prev => prev.filter(entry => entry.id !== id));
        setArchivedState(prev =>
            prev.entries.some(entry => entry.id === id)
                ? {
                      ...prev,
                      entries: prev.entries.filter(entry => entry.id !== id),
                      count: prev.count === null ? null : Math.max(0, prev.count - 1),
                  }
                : prev
        );
    }, []);

    const renameEntry = useCallback((id: string, title: string) => {
        setEntries(prev => prev.map(entry => (entry.id === id ? { ...entry, title } : entry)));
    }, []);

    const patchEntry = useCallback((id: string, patch: Partial<HistoryEntry>) => {
        setEntries(prev => prev.map(entry => (entry.id === id ? { ...entry, ...patch } : entry)));
    }, []);

    const setPinned = useCallback(
        (entry: HistoryEntry, pinned: boolean) => {
            const before = { pinned: entry.pinned, pinRank: entry.pinRank };
            const top = entriesRef.current
                .filter(other => other.pinned && other.id !== entry.id)
                .sort(byPinOrder)[0];
            patchEntry(
                entry.id,
                pinned
                    ? { pinned: true, pinRank: (top?.pinRank ?? 0) - 1, archived: false }
                    : { pinned: false, pinRank: null }
            );
            sessionApi
                .updateSessionState(entry.refId, { pinned })
                .then(state =>
                    patchEntry(entry.id, { pinned: state.pinned, pinRank: state.pinRank })
                )
                .catch(err => {
                    patchEntry(entry.id, before);
                    toast.error(
                        message(err, pinned ? "Couldn't pin that chat" : "Couldn't unpin that chat")
                    );
                });
        },
        [patchEntry]
    );

    // The Undo on the archive toast calls back into the newest `setArchived`.
    const setArchivedRef = useRef<(entry: HistoryEntry, archive: boolean) => void>(() => undefined);
    const setArchived = useCallback((entry: HistoryEntry, archive: boolean) => {
        const listSnapshot = entriesRef.current;
        const archivedSnapshot = archivedRef.current;
        if (archive) {
            setEntries(prev => prev.filter(other => other.id !== entry.id));
            setArchivedState(prev => ({
                ...prev,
                entries: [
                    { ...entry, archived: true, pinned: false, pinRank: null },
                    ...prev.entries.filter(other => other.id !== entry.id),
                ],
                count: (prev.count ?? 0) + 1,
            }));
        } else {
            setArchivedState(prev => ({
                ...prev,
                entries: prev.entries.filter(other => other.id !== entry.id),
                count: prev.count === null ? null : Math.max(0, prev.count - 1),
            }));
            setEntries(prev =>
                [
                    { ...entry, archived: false },
                    ...prev.filter(other => other.id !== entry.id),
                ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
            );
        }
        sessionApi
            .updateSessionState(entry.refId, { archived: archive })
            .then(() => {
                if (archive)
                    toast.success("Archived", {
                        description: "Find it under Archived at the bottom of History.",
                        action: {
                            label: "Undo",
                            onClick: () => setArchivedRef.current(entry, false),
                        },
                    });
            })
            .catch(err => {
                setEntries(listSnapshot);
                setArchivedState(prev => ({
                    ...prev,
                    entries: archivedSnapshot.entries,
                    count: archivedSnapshot.count,
                }));
                toast.error(
                    message(
                        err,
                        archive ? "Couldn't archive that chat" : "Couldn't restore that chat"
                    )
                );
            });
    }, []);
    setArchivedRef.current = setArchived;

    const reorderPins = useCallback((ids: readonly string[]) => {
        const snapshot = entriesRef.current;
        setEntries(prev => applyPinOrder(prev, ids));
        sessionApi.orderPins(ids).catch(err => {
            setEntries(snapshot);
            toast.error(message(err, "Couldn't reorder pinned chats"));
        });
    }, []);

    const markSeen = useCallback(
        (sessionId: string) => {
            patchEntry(`chat:${sessionId}`, { unread: false });
            // Best effort: a missed "seen" only leaves a dot until the next open.
            sessionApi.updateSessionState(sessionId, { seen: true }).catch(() => undefined);
        },
        [patchEntry]
    );

    return {
        entries,
        loading,
        error,
        degraded,
        refresh,
        removeEntry,
        renameEntry,
        setPinned,
        setArchived,
        reorderPins,
        markSeen,
        archived,
        setArchivedOpen,
    };
}

export type { SessionMessagePayload, StoredSession };
