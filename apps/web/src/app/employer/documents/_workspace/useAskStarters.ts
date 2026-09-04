"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AskStartersPayload } from "~/lib/ask-starters/contract";

/**
 * Loads the workspace's starter questions for the Ask panel's empty state.
 *
 * `revisionKey` names the evidence the caller can see (workspace id, source
 * count): when it changes the set is fetched again; the server's own cache
 * decides whether that costs a model call. The last payload per key is kept
 * in module scope so "New chat" — which remounts the empty state — paints the
 * same four cards instantly instead of a skeleton.
 */

export interface AskStartersState {
    data: AskStartersPayload | null;
    /** True until the first payload for this revision arrives. */
    loading: boolean;
    /** True while a Shuffle request is in flight; `data` still holds the previous set. */
    refreshing: boolean;
    error: string | null;
    refresh: () => void;
}

const memo = new Map<string, AskStartersPayload>();

/** Tests render several workspaces in one process. */
export function resetAskStartersMemo(): void {
    memo.clear();
}

async function fetchStarters(refresh: boolean, signal: AbortSignal): Promise<AskStartersPayload> {
    const response = await fetch(`/api/ask/starters${refresh ? "?refresh=1" : ""}`, { signal });
    if (!response.ok) {
        throw new Error(`Starter questions unavailable (${response.status})`);
    }
    const body = (await response.json()) as {
        success?: boolean;
        data?: AskStartersPayload;
        message?: string;
    };
    if (!body.success || !body.data) {
        throw new Error(body.message ?? "Starter questions unavailable");
    }
    return body.data;
}

export function useAskStarters(revisionKey: string): AskStartersState {
    const [data, setData] = useState<AskStartersPayload | null>(
        () => memo.get(revisionKey) ?? null
    );
    const [loading, setLoading] = useState(() => !memo.has(revisionKey));
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inFlight = useRef<AbortController | null>(null);

    const load = useCallback(
        (refresh: boolean) => {
            inFlight.current?.abort();
            const controller = new AbortController();
            inFlight.current = controller;

            if (refresh) setRefreshing(true);
            else if (!memo.has(revisionKey)) setLoading(true);
            setError(null);

            fetchStarters(refresh, controller.signal)
                .then(payload => {
                    if (controller.signal.aborted) return;
                    memo.set(revisionKey, payload);
                    setData(payload);
                })
                .catch((err: unknown) => {
                    if (controller.signal.aborted) return;
                    setError(err instanceof Error ? err.message : "Starter questions unavailable");
                })
                .finally(() => {
                    if (controller.signal.aborted) return;
                    setLoading(false);
                    setRefreshing(false);
                });
        },
        [revisionKey]
    );

    useEffect(() => {
        const known = memo.get(revisionKey);
        if (known) {
            setData(known);
            setLoading(false);
        }
        // Revalidate even on a memo hit: a fresh upload changes the key, but a
        // profile extraction does not, and the server cache knows about both.
        load(false);
        return () => inFlight.current?.abort();
    }, [revisionKey, load]);

    const refresh = useCallback(() => load(true), [load]);

    return { data, loading, refreshing, error, refresh };
}
