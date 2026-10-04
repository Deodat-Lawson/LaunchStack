"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { vantageApi, type AgendaDto } from "../api";

/**
 * Vantage drafts the week on its own. When a screen opens on the next
 * meeting's week, finds no agenda and has something on file to draft from,
 * it asks for the draft without waiting for a click, and the founder lands
 * on suggestions instead of a "Prepare" button.
 *
 * Two guards keep that to one request. While a draft is in flight, every
 * caller for that week shares it — a re-render, React's double effect in
 * development, or opening the agenda while This week is still drafting.
 * And a screen drafts a week on its own at most once while it is open, so
 * an answer that does not show up in the next read (a workspace switched
 * mid-draft, say) cannot set off another request, let alone a loop; the
 * screen offers "Draft it now" instead. A finished or failed draft is
 * forgotten, so the next request — Retry, or another workspace's same
 * week — really goes to the server.
 */
const inFlight = new Map<string, Promise<AgendaDto>>();

export function draftWeek(week: string): Promise<AgendaDto> {
    let pending = inFlight.get(week);
    if (!pending) {
        pending = vantageApi
            .prepare(week)
            .then(r => r.agenda)
            .finally(() => inFlight.delete(week));
        inFlight.set(week, pending);
    }
    return pending;
}

/** Tests only: forget every draft in flight. */
export function resetAutoDraftForTests() {
    inFlight.clear();
}

export interface AutoDraft {
    drafting: boolean;
    error: string | null;
    /** Draft now: Retry after a failure, or a week that was not drafted on its own. */
    draft: () => void;
}

export function useAutoDraft(args: {
    /** The week to draft; null while it is not known yet. */
    week: string | null;
    /** True when this week should be drafted without a click. */
    auto: boolean;
    /**
     * Take in the new agenda. When it returns a promise (a screen reloading
     * its data), "drafting" lasts until it settles, so the screen never
     * flashes its no-agenda state between the draft and the fresh data.
     */
    onDrafted: (agenda: AgendaDto) => unknown;
}): AutoDraft {
    const { week, auto } = args;
    const [drafting, setDrafting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const onDrafted = useRef(args.onDrafted);
    onDrafted.current = args.onDrafted;

    const draft = useCallback(() => {
        if (!week) return;
        setDrafting(true);
        setError(null);
        void draftWeek(week)
            .then(agenda => onDrafted.current(agenda))
            .catch((e: unknown) =>
                setError(e instanceof Error ? e.message : "Vantage could not draft the week")
            )
            .finally(() => setDrafting(false));
    }, [week]);

    // Weeks this screen has drafted on its own since it opened.
    const attempted = useRef(new Set<string>());
    useEffect(() => {
        if (!auto || !week || attempted.current.has(week)) return;
        attempted.current.add(week);
        draft();
    }, [auto, week, draft]);

    return { drafting, error, draft };
}
