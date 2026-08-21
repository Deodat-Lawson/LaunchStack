"use client";

import React, {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useRef,
    useSyncExternalStore,
} from "react";

import { activePage } from "../model/doc";
import type { EditorState, EditorStore } from "../model/store";
import type { DiagramPage, MindmapDoc } from "../model/types";

const StoreContext = createContext<EditorStore | null>(null);

export function EditorProvider({
    store,
    children,
}: {
    store: EditorStore;
    children: React.ReactNode;
}) {
    return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): EditorStore {
    const store = useContext(StoreContext);
    if (!store) throw new Error("useStore must be used inside <EditorProvider>");
    return store;
}

/**
 * Subscribe to a slice of editor state.
 *
 * `selector` must be stable across renders — a module-level function or one
 * wrapped in `useCallback`. An inline arrow would re-subscribe every render and
 * defeat the memoisation that keeps pointer-move updates cheap.
 */
export function useEditor<T>(
    selector: (state: EditorState) => T,
    isEqual: (a: T, b: T) => boolean = Object.is
): T {
    const store = useStore();
    const cache = useRef<{ state: EditorState; value: T } | null>(null);

    const getSnapshot = useCallback((): T => {
        const state = store.getState();
        const cached = cache.current;
        if (cached && cached.state === state) return cached.value;
        const next = selector(state);
        if (cached && isEqual(cached.value, next)) {
            // Same value from a new state object — keep the old reference so
            // React can bail out of the re-render.
            cache.current = { state, value: cached.value };
            return cached.value;
        }
        cache.current = { state, value: next };
        return next;
    }, [store, selector, isEqual]);

    return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

// ---------------------------------------------------------------------------
// Common selectors
// ---------------------------------------------------------------------------

const selectDoc = (s: EditorState): MindmapDoc => s.doc;
const selectSelection = (s: EditorState) => s.selection;
const selectViewport = (s: EditorState) => s.viewport;
const selectTool = (s: EditorState) => s.tool;

export function useDoc(): MindmapDoc {
    return useEditor(selectDoc);
}

export function usePage(): DiagramPage {
    const doc = useDoc();
    return useMemo(() => activePage(doc), [doc]);
}

export function useSelection() {
    return useEditor(selectSelection);
}

export function useViewport() {
    return useEditor(selectViewport);
}

export function useTool() {
    return useEditor(selectTool);
}

/** Shallow array comparison, for selectors that derive id lists. */
export function shallowArrayEqual<T>(a: readonly T[], b: readonly T[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

const selectSelectedNodeIds = (s: EditorState): string[] =>
    s.selection.filter(r => r.kind === "node").map(r => r.id);

export function useSelectedNodeIds(): string[] {
    return useEditor(selectSelectedNodeIds, shallowArrayEqual);
}

const selectSelectedEdgeIds = (s: EditorState): string[] =>
    s.selection.filter(r => r.kind === "edge").map(r => r.id);

export function useSelectedEdgeIds(): string[] {
    return useEditor(selectSelectedEdgeIds, shallowArrayEqual);
}
