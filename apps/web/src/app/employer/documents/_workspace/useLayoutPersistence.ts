"use client";

import { useEffect, useRef } from "react";

import { openTabIds, sanitizeLayout, type PaneLayout } from "./paneLayout";

/**
 * The workspace centre comes back as it was left: which panes, split how and
 * how wide, holding which tabs. Like cmux's session restore, minus the
 * processes — an app reopens in its tab, it does not resume mid-request.
 *
 * Kept on this device, per member and workspace. `scope` is null until both
 * are known; nothing is read or written before then, so one workspace's
 * layout can never be saved under another's name.
 */
const STORAGE_PREFIX = "workspace.layout.v1:";

export function useLayoutPersistence({
    scope,
    layout,
    restore,
    keep,
    paused = false,
}: {
    scope: string | null;
    layout: PaneLayout;
    restore: (saved: PaneLayout) => void;
    /** Whether a saved tab id can be reopened (see sanitizeLayout). */
    keep: (tabId: string) => boolean;
    /**
     * True while the window is too narrow for panes and the workspace folds
     * them into one. The fold is for this window size, not a new arrangement,
     * so it is never saved — and when the window widens again, the saved one
     * comes back.
     */
    paused?: boolean;
}) {
    /** The scope whose saved layout has been read — and may now be written. */
    const restoredScope = useRef<string | null>(null);
    /** Set while a restore is in flight, so the layout it replaces is not saved over it. */
    const restoring = useRef(false);
    const keepRef = useRef(keep);
    keepRef.current = keep;
    const layoutRef = useRef(layout);
    layoutRef.current = layout;
    const wasPaused = useRef(paused);

    useEffect(() => {
        if (!scope || restoredScope.current === scope) return;
        restoredScope.current = scope;
        try {
            const raw = localStorage.getItem(STORAGE_PREFIX + scope);
            if (!raw) return;
            const saved = sanitizeLayout(JSON.parse(raw), id => keepRef.current(id));
            if (saved) {
                restoring.current = true;
                restore(saved);
            }
        } catch {
            // Unreadable storage or a corrupt entry: start from what is open.
        }
    }, [scope, restore]);

    useEffect(() => {
        const resumed = wasPaused.current && !paused;
        wasPaused.current = paused;
        if (!resumed || !scope || restoredScope.current !== scope) return;
        // Wide again. Storage still holds the arrangement from before the
        // fold; bring it back with only the tabs that are open now — one
        // closed on the narrow screen stays closed — and the restore adds
        // any opened there.
        try {
            const raw = localStorage.getItem(STORAGE_PREFIX + scope);
            if (!raw) return;
            const open = new Set(openTabIds(layoutRef.current));
            const saved = sanitizeLayout(
                JSON.parse(raw),
                id => open.has(id) && keepRef.current(id)
            );
            if (saved) restore(saved);
        } catch {
            // Unreadable storage: stay folded until something is split again.
        }
    }, [paused, scope, restore]);

    useEffect(() => {
        if (!scope || restoredScope.current !== scope || paused) return;
        if (restoring.current) {
            restoring.current = false;
            return;
        }
        try {
            // A zoom is a moment's focus, not part of the arrangement.
            localStorage.setItem(
                STORAGE_PREFIX + scope,
                JSON.stringify({ ...layout, zoomedGroupId: null })
            );
        } catch {
            // Quota / private mode — the layout holds for this visit only.
        }
        // `paused` is read, not tracked: widening must not save the fold
        // before the restore above has replaced it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope, layout]);
}
