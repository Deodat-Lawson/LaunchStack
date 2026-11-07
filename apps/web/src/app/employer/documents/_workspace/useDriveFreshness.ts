"use client";

/**
 * Keeps an open Drive-backed document current. Edits made in Google Drive
 * come back as new versions — a linked file through its pull, a connector
 * import through the connection's sync — but nothing told a viewer that was
 * already open, so its preview kept the copy it opened with until the page
 * was reloaded.
 *
 * - Opening a linked file, and coming back to the tab (from editing it in
 *   Google Docs, usually), pulls it at once: the same pull as Sync now, which
 *   only downloads when Drive's revision moved. At most once a minute per
 *   document, so tab-switching stays inside the route's rate limit.
 * - While the tab is visible, `onCheck` runs every minute, which is how a
 *   background sync of either kind reaches the preview.
 */

import { useEffect, useRef } from "react";

const PULL_INTERVAL_MS = 60_000;
const CHECK_INTERVAL_MS = 60_000;

export function useDriveFreshness({
    documentId,
    linked,
    watch,
    onPulled,
    onCheck,
}: {
    documentId: number | null;
    /** A Drive-linked file, which this viewer may pull itself. */
    linked: boolean;
    /** Anything Drive syncs into: a linked file or a connector import. */
    watch: boolean;
    /** After a pull settles — the Drive line's last-synced time moved. */
    onPulled: () => Promise<void> | void;
    /** Look for a new version and show it if there is one. */
    onCheck: () => Promise<void> | void;
}): void {
    // Read through refs so a new callback identity does not restart the timers.
    const onPulledRef = useRef(onPulled);
    onPulledRef.current = onPulled;
    const onCheckRef = useRef(onCheck);
    onCheckRef.current = onCheck;

    useEffect(() => {
        if (documentId === null || !watch) return;
        let lastPullAt = 0;
        let pulling = false;
        let cancelled = false;

        const check = () => {
            if (!cancelled) void onCheckRef.current();
        };

        const pull = async () => {
            if (!linked || pulling || Date.now() - lastPullAt < PULL_INTERVAL_MS) return false;
            pulling = true;
            lastPullAt = Date.now();
            try {
                await fetch(`/api/documents/${documentId}/google-docs/sync`, { method: "POST" });
            } catch {
                // Offline or refused (a reader who can't edit it): the minute
                // check still shows what the background sync brings.
            } finally {
                pulling = false;
            }
            if (!cancelled) void onPulledRef.current();
            return true;
        };

        // On open the viewer has just read its versions; only a pull can
        // have made a newer one.
        const refreshNow = async (opening: boolean) => {
            if (document.visibilityState !== "visible") return;
            const pulled = await pull();
            if (pulled || !opening) check();
        };

        void refreshNow(true);
        const onVisibility = () => void refreshNow(false);
        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("focus", onVisibility);
        const timer = window.setInterval(() => {
            if (document.visibilityState === "visible") check();
        }, CHECK_INTERVAL_MS);

        return () => {
            cancelled = true;
            document.removeEventListener("visibilitychange", onVisibility);
            window.removeEventListener("focus", onVisibility);
            window.clearInterval(timer);
        };
    }, [documentId, linked, watch]);
}
