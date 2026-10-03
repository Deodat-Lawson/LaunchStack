"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { vantageApi, type AgendaDto } from "../api";

/**
 * Vantage drafts the week on its own. When a screen opens on the next
 * meeting's week, finds no agenda and has something on file to draft from,
 * it asks for the draft without waiting for a click, and the founder lands
 * on suggestions instead of a "Prepare" button.
 *
 * One request per week per page: the promise is shared by week, so a
 * re-render, React's double effect in development, or opening the agenda
 * while This week is still drafting all wait on the same call. A failure
 * forgets the week, so Retry (or the next visit) asks again.
 */
const drafts = new Map<string, Promise<AgendaDto>>();

export function draftWeekOnce(week: string): Promise<AgendaDto> {
    let pending = drafts.get(week);
    if (!pending) {
        pending = vantageApi.prepare(week).then(r => r.agenda);
        drafts.set(week, pending);
        pending.catch(() => drafts.delete(week));
    }
    return pending;
}

/** Tests only: forget every week. */
export function resetAutoDraftForTests() {
    drafts.clear();
}

export interface AutoDraft {
    drafting: boolean;
    error: string | null;
    /** Ask again after a failure (or for a week that was not drafted on its own). */
    draft: () => void;
}

export function useAutoDraft(args: {
    /** The week to draft; null while it is not known yet. */
    week: string | null;
    /** True when this week should be drafted without a click. */
    auto: boolean;
    onDrafted: (agenda: AgendaDto) => void;
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
        draftWeekOnce(week).then(
            agenda => {
                setDrafting(false);
                onDrafted.current(agenda);
            },
            (e: unknown) => {
                setDrafting(false);
                setError(e instanceof Error ? e.message : "Vantage could not draft the week");
            }
        );
    }, [week]);

    useEffect(() => {
        if (auto && week) draft();
    }, [auto, week, draft]);

    return { drafting, error, draft };
}
