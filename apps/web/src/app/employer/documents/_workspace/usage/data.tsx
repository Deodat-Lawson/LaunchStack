"use client";

/**
 * The Usage tab's shared state and its one way of loading data.
 *
 * The window (7, 30 or 90 days, or a custom range) and the group filter
 * belong to the tab, not to a screen: moving from Overview to People keeps
 * them, the way Cursor's dashboard keeps its date range across pages. A link
 * that names a window (`?days=7`, `?from=…&to=…`) starts the tab there.
 */

import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

import { useToolSearchParams } from "~/components/tool-app/nav";
import {
    DEFAULT_USAGE_DAYS,
    USAGE_PRESETS,
    parseUsageWindow,
    type UsagePreset,
} from "~/lib/usage/range";

export type WindowChoice =
    | { kind: "preset"; days: UsagePreset }
    | { kind: "custom"; from: string; to: string };

/** The query a route reads the window from. */
export function windowQuery(choice: WindowChoice): URLSearchParams {
    return choice.kind === "preset"
        ? new URLSearchParams({ days: String(choice.days) })
        : new URLSearchParams({ from: choice.from, to: choice.to });
}

/** The window a link asks for, or the default. */
export function choiceFromQuery(params: URLSearchParams): WindowChoice {
    const days = Number(params.get("days"));
    if ((USAGE_PRESETS as readonly number[]).includes(days)) {
        return { kind: "preset", days: days as UsagePreset };
    }
    const from = params.get("from");
    const to = params.get("to");
    if (from && to && parseUsageWindow(new URLSearchParams({ from, to })).ok) {
        return { kind: "custom", from, to };
    }
    return { kind: "preset", days: DEFAULT_USAGE_DAYS };
}

interface UsageFilters {
    choice: WindowChoice;
    setChoice: (choice: WindowChoice) => void;
    /** A workspace group the team screens are narrowed to, or null for everyone. */
    groupId: number | null;
    setGroupId: (id: number | null) => void;
}

const UsageFiltersContext = createContext<UsageFilters | null>(null);

export function UsageFiltersProvider({ children }: { children: React.ReactNode }) {
    const params = useToolSearchParams();
    // Read once: the tab owns the window after that, and a screen's own query
    // (`?person=`) must not reset it.
    const [choice, setChoice] = useState<WindowChoice>(() => choiceFromQuery(params));
    const [groupId, setGroupId] = useState<number | null>(() => {
        const raw = params.get("group");
        return raw && /^\d+$/.test(raw) ? Number(raw) : null;
    });
    const value = useMemo(() => ({ choice, setChoice, groupId, setGroupId }), [choice, groupId]);
    return <UsageFiltersContext.Provider value={value}>{children}</UsageFiltersContext.Provider>;
}

/** The tab's filters, or null outside the Usage tab (a section drawn on its own in a test). */
export function useOptionalUsageFilters(): UsageFilters | null {
    return useContext(UsageFiltersContext);
}

export function useUsageFilters(): UsageFilters {
    const value = useContext(UsageFiltersContext);
    if (!value) throw new Error("useUsageFilters must be used inside UsageFiltersProvider");
    return value;
}

export interface UsageLoad<T> {
    data: T | null;
    /** True while a request is out; `data` keeps the last answer meanwhile. */
    loading: boolean;
    /** The HTTP status of a failed load (0 for a network failure), or null. */
    failed: number | null;
    reload: () => void;
}

/**
 * GET `path?query` as JSON. A new query replaces the old answer only when it
 * arrives, so a screen dims rather than blanks while the window changes, and
 * an answer to an older query is dropped. `path` null loads nothing.
 */
export function useUsageLoad<T>(path: string | null, query?: URLSearchParams): UsageLoad<T> {
    const url = path ? `${path}${query && query.size > 0 ? `?${query.toString()}` : ""}` : null;
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(Boolean(url));
    const [failed, setFailed] = useState<number | null>(null);
    const [nonce, setNonce] = useState(0);
    const latest = useRef(0);

    useEffect(() => {
        if (!url) return;
        const request = ++latest.current;
        const controller = new AbortController();
        setLoading(true);
        fetch(url, { signal: controller.signal, cache: "no-store" })
            .then(async res => {
                if (request !== latest.current) return;
                if (!res.ok) {
                    setFailed(res.status);
                    return;
                }
                setData((await res.json()) as T);
                setFailed(null);
            })
            .catch((error: unknown) => {
                if (controller.signal.aborted || request !== latest.current) return;
                console.warn("[usage] load failed:", error);
                setFailed(0);
            })
            .finally(() => {
                if (request === latest.current) setLoading(false);
            });
        return () => controller.abort();
    }, [url, nonce]);

    const reload = useCallback(() => setNonce(n => n + 1), []);
    return { data, loading, failed, reload };
}
