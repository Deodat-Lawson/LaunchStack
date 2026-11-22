"use client";

import { useCallback, useSyncExternalStore } from "react";

import type { EditorStore } from "../../model/store";
import { menuOf, subscribeMenu, type PickMenu } from "./menu";

/** The open pick menu for this editor, or null. Re-renders when it changes. */
export function usePickMenu(store: EditorStore): PickMenu | null {
    const subscribe = useCallback((fn: () => void) => subscribeMenu(store, fn), [store]);
    const get = useCallback(() => menuOf(store), [store]);
    return useSyncExternalStore(subscribe, get, get);
}
