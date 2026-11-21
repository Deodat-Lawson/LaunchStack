"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { useErrorText } from "./errorText";

export interface Resource<T> {
    data: T | null;
    loading: boolean;
    error: string | null;
    /**
     * The HTTP status behind `error`, when the API client reported one — so a
     * screen can tell "this record is gone" (404) from "try again".
     */
    errorStatus: number | null;
    /** Re-fetch without dropping the current data (no skeleton flash). */
    reload: () => Promise<void>;
    /** Optimistic local update; the next reload replaces it. */
    mutate: (updater: (current: T) => T) => void;
}

/**
 * The one data hook the tool apps use. Keyed by a string so a change of
 * segment or filter refetches; `pollMs` keeps a running run live. Loading
 * is true only for the first fetch of a key, so filters and the primary
 * button stay interactive while a list refreshes.
 *
 * A poll never overlaps itself: when a response takes longer than the
 * interval (a dev server compiling, a slow network), the next tick is
 * skipped rather than started. Without that, the "latest request wins"
 * guard below discards every response that lands after a newer request
 * began, and a run sheet polling a slow endpoint never updates at all.
 *
 * `keepAcrossMounts` remembers the last result per key for this page load,
 * so a screen that is left and reopened (a tab switch) shows it at once and
 * refreshes in the background instead of starting from a skeleton.
 */
export function useResource<T>(
    key: string | null,
    fetcher: () => Promise<T>,
    options: { pollMs?: number | null; keepAcrossMounts?: boolean } = {}
): Resource<T> {
    const keep = options.keepAcrossMounts === true;
    const [data, setData] = useState<T | null>(() =>
        keep && key !== null ? ((remembered.get(key) as T | undefined) ?? null) : null
    );
    const [loading, setLoading] = useState<boolean>(key !== null && !(keep && remembered.has(key)));
    const [error, setError] = useState<string | null>(null);
    const [errorStatus, setErrorStatus] = useState<number | null>(null);
    const t = useTranslations("tools.resource");
    const errorText = useErrorText();
    const describe = useRef((e: unknown) => errorText(e, t("error")));
    describe.current = (e: unknown) => errorText(e, t("error"));
    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;
    const keyRef = useRef(key);
    const seq = useRef(0);
    const inflight = useRef(false);
    const lastShown = useRef<T | null>(data);
    const keepRef = useRef(keep);
    keepRef.current = keep;

    const load = useCallback(async (first: boolean) => {
        const mine = ++seq.current;
        inflight.current = true;
        if (first) setLoading(true);
        try {
            const fetched = await fetcherRef.current();
            if (mine !== seq.current) return;
            // A refresh that brings back what is on screen keeps the same
            // object, so lists don't re-render (and pictures don't flicker)
            // every time a screen is reopened or a poll lands.
            const next = sameAsShown(lastShown.current, fetched) ? lastShown.current! : fetched;
            lastShown.current = next;
            if (keepRef.current && keyRef.current !== null) remember(keyRef.current, next);
            setData(next);
            setError(null);
            setErrorStatus(null);
        } catch (e) {
            if (mine !== seq.current) return;
            setError(describe.current(e));
            const status = (e as { status?: unknown } | null)?.status;
            setErrorStatus(typeof status === "number" ? status : null);
        } finally {
            if (mine === seq.current) {
                setLoading(false);
                inflight.current = false;
            }
        }
    }, []);

    useEffect(() => {
        keyRef.current = key;
        if (key === null) {
            setData(null);
            setLoading(false);
            return;
        }
        // A remembered result shows now; this fetch only refreshes it.
        const known = keepRef.current && remembered.has(key);
        lastShown.current = known ? (remembered.get(key) as T) : null;
        if (known) {
            setData(remembered.get(key) as T);
            setLoading(false);
        }
        void load(!known);
    }, [key, load]);

    useEffect(() => {
        if (!options.pollMs || key === null) return;
        const id = window.setInterval(() => {
            if (inflight.current) return;
            void load(false);
        }, options.pollMs);
        return () => window.clearInterval(id);
    }, [options.pollMs, key, load]);

    const reload = useCallback(() => load(false), [load]);
    const mutate = useCallback((updater: (current: T) => T) => {
        setData(current => {
            if (current === null) return current;
            const next = updater(current);
            lastShown.current = next;
            if (keepRef.current && keyRef.current !== null) remember(keyRef.current, next);
            return next;
        });
    }, []);

    return { data, loading, error, errorStatus, reload, mutate };
}

/** Last results by key, for `keepAcrossMounts`; the oldest goes past the cap. */
const remembered = new Map<string, unknown>();
const REMEMBER_MAX = 40;

function remember(key: string, value: unknown): void {
    remembered.delete(key);
    remembered.set(key, value);
    if (remembered.size > REMEMBER_MAX) remembered.delete(remembered.keys().next().value!);
}

/** Forget remembered results (sign-out, workspace switch, tests). */
export function forgetResources(): void {
    remembered.clear();
}

/**
 * Fetch a result into the `keepAcrossMounts` memory before its screen opens
 * (the tab next door), so opening it shows data at once. Does nothing when
 * the key is already remembered; failures are left for the screen to show.
 */
export function preloadResource<T>(key: string, fetcher: () => Promise<T>): void {
    if (remembered.has(key) || preloading.has(key)) return;
    preloading.add(key);
    void fetcher()
        .then(value => {
            if (!remembered.has(key)) remember(key, value);
        })
        .catch(() => undefined)
        .finally(() => preloading.delete(key));
}
const preloading = new Set<string>();

function sameAsShown(shown: unknown, fetched: unknown): boolean {
    if (shown === null || shown === undefined) return false;
    try {
        return JSON.stringify(shown) === JSON.stringify(fetched);
    } catch {
        return false;
    }
}
