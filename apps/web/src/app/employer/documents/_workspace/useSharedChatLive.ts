"use client";

import { useEffect, useRef } from "react";

import * as sessionApi from "./sessionApi";

/**
 * Keep a chat someone shared with you current while it's open (ADR-014 §4:
 * a reader sees the transcript live, not a snapshot). The owner may still be
 * working in it, so this re-reads it when the tab comes back into view and
 * every `intervalMs` while it's visible, and hands over a fresh copy only when
 * the transcript actually changed. If the read comes back empty the chat was
 * deleted or unshared, and `onGone` says so once.
 *
 * Owners never need this: their own writes are what changes their chat.
 */
export function useSharedChatLive(input: {
    /** The shared chat on screen, or null when none is. */
    sessionId: string | null;
    /** How many turns are on screen now, to tell a change from a re-read. */
    shownCount: () => number;
    onFresh: (sessionId: string, stored: sessionApi.StoredSession) => void;
    onGone: (sessionId: string) => void;
    intervalMs?: number;
}): void {
    const latest = useRef(input);
    latest.current = input;
    const { sessionId, intervalMs = 15_000 } = input;

    useEffect(() => {
        if (!sessionId) return;
        let stopped = false;
        let inFlight = false;

        const check = async () => {
            if (stopped || inFlight || document.visibilityState !== "visible") return;
            inFlight = true;
            try {
                const stored = await sessionApi.fetchSession(sessionId);
                if (stopped) return;
                if (!stored) {
                    stopped = true;
                    latest.current.onGone(sessionId);
                    return;
                }
                if (
                    (stored.messages?.length ?? stored.messageCount) !== latest.current.shownCount()
                ) {
                    latest.current.onFresh(sessionId, stored);
                }
            } catch {
                // A dropped poll is not news; the next one tries again.
            } finally {
                inFlight = false;
            }
        };

        const timer = window.setInterval(() => void check(), intervalMs);
        const onVisible = () => {
            if (document.visibilityState === "visible") void check();
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            stopped = true;
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [sessionId, intervalMs]);
}
