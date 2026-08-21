"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import { exportSvg, svgToThumbnail } from "../lib/export";
import { activePage, pageBounds } from "../model/doc";
import type { EditorStore } from "../model/store";

/**
 * Autosave.
 *
 * Debounced writes with optimistic-concurrency on `revision`. If another tab
 * saved in between, the server answers 409 and we surface it instead of
 * overwriting — silently winning that race is how people lose an afternoon.
 *
 * A save carries a fresh thumbnail only every few minutes: rasterising the
 * canvas is the expensive part, and a slightly stale card in the gallery costs
 * nothing.
 */

const DEBOUNCE_MS = 1600;
const THUMBNAIL_INTERVAL_MS = 3 * 60 * 1000;
/** Explicit ⌘S saves also write a version-history snapshot. */
const SNAPSHOT_ON_MANUAL = true;

export interface AutosaveApi {
    /** Save immediately (⌘S, before navigating away). */
    saveNow: (options?: { snapshot?: boolean; label?: string }) => Promise<void>;
    /** Current server revision, for callers that need to reconcile. */
    revision: () => number;
    /** Adopt a revision produced elsewhere (a history restore). */
    setRevision: (next: number) => void;
}

export function useAutosave(
    store: EditorStore,
    mindmapId: number,
    initialRevision: number,
    getSvgElement: () => SVGSVGElement | null
): AutosaveApi {
    const revision = useRef(initialRevision);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const inFlight = useRef(false);
    const lastThumbnailAt = useRef(0);
    /** Set when a save was requested while another was still running. */
    const queued = useRef(false);

    const buildThumbnail = useCallback(async (): Promise<string | null> => {
        const el = getSvgElement();
        if (!el) return null;
        try {
            const page = activePage(store.getState().doc);
            const svg = exportSvg(el, {
                bounds: pageBounds(page) ?? undefined,
                background: page.background.color,
            });
            return await svgToThumbnail(svg, 480);
        } catch {
            // A missing thumbnail is cosmetic; never let it fail the save.
            return null;
        }
    }, [getSvgElement, store]);

    const save = useCallback(
        async (options: { snapshot?: boolean; label?: string } = {}): Promise<void> => {
            if (inFlight.current) {
                queued.current = true;
                return;
            }
            const state = store.getState();
            if (!state.dirty && !options.snapshot) return;

            inFlight.current = true;
            store.setSaving(true);
            const doc = state.doc;

            const now = Date.now();
            const wantThumbnail =
                options.snapshot === true || now - lastThumbnailAt.current > THUMBNAIL_INTERVAL_MS;
            const thumbnail = wantThumbnail ? await buildThumbnail() : null;

            try {
                const res = await fetch(`/api/mindmaps/${mindmapId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        doc,
                        baseRevision: revision.current,
                        snapshot: options.snapshot ?? false,
                        snapshotLabel: options.label,
                        ...(thumbnail ? { thumbnail } : {}),
                    }),
                });

                if (res.status === 409) {
                    store.setSaving(false);
                    toast.error("This mindmap changed in another tab", {
                        description: "Reload to pick up the newer version before editing further.",
                        action: { label: "Reload", onClick: () => window.location.reload() },
                        duration: 12000,
                    });
                    return;
                }
                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                const body = (await res.json()) as { mindmap: { revision: number } };
                revision.current = body.mindmap.revision;
                if (thumbnail) lastThumbnailAt.current = now;

                // Only clear the dirty flag when the document has not moved on
                // while the request was in flight.
                if (store.getState().doc === doc) store.markSaved();
                else store.setSaving(false);
            } catch {
                store.setSaving(false);
                toast.error("Couldn't save — retrying shortly");
                // Leave `dirty` set: the debounce below will try again on the
                // next edit, and ⌘S still works.
            } finally {
                inFlight.current = false;
                if (queued.current) {
                    queued.current = false;
                    void save();
                }
            }
        },
        [buildThumbnail, mindmapId, store]
    );

    // Debounced autosave, driven by the store's dirty flag.
    useEffect(() => {
        const schedule = () => {
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => {
                void save();
            }, DEBOUNCE_MS);
        };
        const unsubscribe = store.subscribe(() => {
            if (store.getState().dirty) schedule();
        });
        return () => {
            unsubscribe();
            if (timer.current) clearTimeout(timer.current);
        };
    }, [save, store]);

    // Last-chance save on unload. `sendBeacon` survives the page teardown that
    // would abort a normal fetch, and the route accepts the same JSON body.
    useEffect(() => {
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            if (!store.getState().dirty) return;
            const payload = JSON.stringify({
                doc: store.getState().doc,
                baseRevision: revision.current,
            });
            navigator.sendBeacon?.(
                `/api/mindmaps/${mindmapId}`,
                new Blob([payload], { type: "application/json" })
            );
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, [mindmapId, store]);

    const saveNow = useCallback(
        (options: { snapshot?: boolean; label?: string } = {}) =>
            save({ snapshot: options.snapshot ?? SNAPSHOT_ON_MANUAL, label: options.label }),
        [save]
    );

    // Stable identity: callers put this object in `useMemo`/`useEffect` deps.
    return useMemo(
        () => ({
            saveNow,
            revision: () => revision.current,
            setRevision: (next: number) => {
                revision.current = next;
            },
        }),
        [saveNow]
    );
}
