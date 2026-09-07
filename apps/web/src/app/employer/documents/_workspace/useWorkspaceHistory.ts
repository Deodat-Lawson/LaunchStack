"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { HistoryEntry, HistoryKind } from "~/lib/workspace-history";

import type { SessionMessagePayload, StoredSession } from "./sessionApi";
import * as sessionApi from "./sessionApi";

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
}

/**
 * The History feed behind the sidebar.
 *
 * One endpoint, one list. It refetches when the workspace changes and after
 * every mutation the rail performs, and it never polls: a run that finishes
 * while you are looking at the sidebar is not worth a request every few
 * seconds, and the refresh button (and any send) brings it in.
 */
export function useWorkspaceHistory(enabled: boolean): WorkspaceHistoryState {
    const [entries, setEntries] = useState<HistoryEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [degraded, setDegraded] = useState<HistoryKind[]>([]);
    /** Guards against a slow response from an earlier fetch overwriting a newer one. */
    const requestId = useRef(0);

    const refresh = useCallback(async () => {
        if (!enabled) return;
        const id = ++requestId.current;
        setLoading(true);
        try {
            const page = await sessionApi.fetchHistory();
            if (id !== requestId.current) return;
            setEntries(page.entries);
            setDegraded(page.degraded);
            setError(null);
        } catch (err) {
            if (id !== requestId.current) return;
            setError(err instanceof Error ? err.message : "Couldn't load history");
        } finally {
            if (id === requestId.current) setLoading(false);
        }
    }, [enabled]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const removeEntry = useCallback((id: string) => {
        setEntries(prev => prev.filter(entry => entry.id !== id));
    }, []);

    const renameEntry = useCallback((id: string, title: string) => {
        setEntries(prev => prev.map(entry => (entry.id === id ? { ...entry, title } : entry)));
    }, []);

    return { entries, loading, error, degraded, refresh, removeEntry, renameEntry };
}

export type { SessionMessagePayload, StoredSession };
