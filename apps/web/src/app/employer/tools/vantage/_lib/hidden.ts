"use client";

import { useCallback, useEffect, useState } from "react";

import { addDaysIso, todayIso } from "./format";

/**
 * Suggestions the founder set aside that have no state of their own on the
 * server: a check-in snoozed until tomorrow, a nudge ignored for the week, a
 * next step they would rather not commit to. Topics are different — ignoring
 * one dismisses it on the agenda, where everyone sees it.
 *
 * Kept per browser in localStorage, as `{ id: hiddenUntil }`; an entry stops
 * hiding on its date and is pruned on the next write. Storage that throws
 * (private windows, blocked site data) means nothing stays hidden across a
 * reload, never a broken screen.
 */
const KEY = "vantage:hidden:v1";
const EVENT = "vantage:hidden";

type Store = Record<string, string>;

/** The page's own copy, used when storage is unavailable. */
let memory: Store = {};

function read(): Store {
    try {
        const raw = window.localStorage.getItem(KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === "object" ? (parsed as Store) : {};
    } catch {
        return memory;
    }
}

function write(store: Store) {
    memory = store;
    try {
        window.localStorage.setItem(KEY, JSON.stringify(store));
    } catch {
        // Hidden for this page only.
    }
    window.dispatchEvent(new Event(EVENT));
}

/** Ids hidden on `today`. */
export function hiddenOn(store: Store, today: string): Set<string> {
    return new Set(
        Object.entries(store)
            .filter(([, until]) => until > today)
            .map(([id]) => id)
    );
}

/** Hide `id` for `days` days from today (1 = until tomorrow). */
export function hideSuggestion(id: string, days: number, today = todayIso()) {
    const store = { ...read() };
    for (const [k, until] of Object.entries(store)) if (until <= today) delete store[k];
    store[id] = addDaysIso(today, days);
    write(store);
}

export function unhideSuggestion(id: string) {
    const store = { ...read() };
    delete store[id];
    write(store);
}

/** The ids hidden today, kept current across every screen that reads them. */
export function useHiddenSuggestions(): ReadonlySet<string> {
    // Read on the first render, so a snoozed card never flashes in first.
    // The tab is client-only (the workspace loads it with ssr: false).
    const [hidden, setHidden] = useState<ReadonlySet<string>>(() =>
        typeof window === "undefined" ? new Set() : hiddenOn(read(), todayIso())
    );
    const refresh = useCallback(() => setHidden(hiddenOn(read(), todayIso())), []);
    useEffect(() => {
        refresh();
        window.addEventListener(EVENT, refresh);
        window.addEventListener("storage", refresh);
        return () => {
            window.removeEventListener(EVENT, refresh);
            window.removeEventListener("storage", refresh);
        };
    }, [refresh]);
    return hidden;
}
