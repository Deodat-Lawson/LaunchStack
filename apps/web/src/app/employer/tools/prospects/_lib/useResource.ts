"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ProspectsApiError } from "../api";

export interface Resource<T> {
    data: T | null;
    loading: boolean;
    error: string | null;
    /** Re-fetch without dropping the current data (no skeleton flash). */
    reload: () => Promise<void>;
    /** Optimistic local update; the next reload replaces it. */
    mutate: (updater: (current: T) => T) => void;
}

/**
 * The one data hook every Prospects screen uses. Keyed by a string so a
 * change of segment or filter refetches; `pollMs` keeps a running run live.
 * Loading is true only for the first fetch of a key, so filters and the
 * primary button stay interactive while a list refreshes.
 */
export function useResource<T>(
    key: string | null,
    fetcher: () => Promise<T>,
    options: { pollMs?: number | null } = {}
): Resource<T> {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState<boolean>(key !== null);
    const [error, setError] = useState<string | null>(null);
    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;
    const keyRef = useRef(key);
    const seq = useRef(0);

    const load = useCallback(async (first: boolean) => {
        const mine = ++seq.current;
        if (first) setLoading(true);
        try {
            const next = await fetcherRef.current();
            if (mine !== seq.current) return;
            setData(next);
            setError(null);
        } catch (e) {
            if (mine !== seq.current) return;
            setError(
                e instanceof ProspectsApiError
                    ? e.message
                    : e instanceof Error
                      ? e.message
                      : "Something went wrong"
            );
        } finally {
            if (mine === seq.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        keyRef.current = key;
        if (key === null) {
            setData(null);
            setLoading(false);
            return;
        }
        void load(true);
    }, [key, load]);

    useEffect(() => {
        if (!options.pollMs || key === null) return;
        const id = window.setInterval(() => void load(false), options.pollMs);
        return () => window.clearInterval(id);
    }, [options.pollMs, key, load]);

    const reload = useCallback(() => load(false), [load]);
    const mutate = useCallback((updater: (current: T) => T) => {
        setData(current => (current === null ? current : updater(current)));
    }, []);

    return { data, loading, error, reload, mutate };
}
