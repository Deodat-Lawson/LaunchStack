"use client";

import { useEffect, useId } from "react";
import { clearTarget, setTarget, TARGET_ATTR, type ContextTarget } from "~/lib/context-menu";

/**
 * Declares what an element is, so right-click (and Shift+F10, and long-press)
 * on it opens the right menu. Spread the result on the element:
 *
 *     const ctx = useContextTarget({ kind: "source", id: source.id, items: () => … });
 *     <li {...ctx}>
 *
 * Pass `null` to declare nothing (a row that has no actions in this view).
 * The descriptor is re-read on every render, so `items` sees current props.
 */
export function useContextTarget<TData = unknown>(
    target: ContextTarget<TData> | null | undefined
): { [TARGET_ATTR]?: string } {
    const id = useId();
    useEffect(() => {
        if (target) setTarget(id, target as ContextTarget);
        else clearTarget(id);
    });
    useEffect(() => () => clearTarget(id), [id]);
    return target ? { [TARGET_ATTR]: id } : {};
}
