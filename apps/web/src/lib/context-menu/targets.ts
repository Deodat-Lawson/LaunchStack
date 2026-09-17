import type { ContextTarget } from "./types";

/**
 * Elements carry only an id; the descriptor (with its live `items` closure)
 * lives here, refreshed on every render of the declaring component. Keeping
 * descriptors out of the DOM means a right-click reads current state, not
 * whatever was serialised when the row mounted.
 */
export const TARGET_ATTR = "data-ctx";

const store = new Map<string, ContextTarget>();

export function setTarget(id: string, target: ContextTarget): void {
    store.set(id, target);
}

export function clearTarget(id: string): void {
    store.delete(id);
}

export function getTarget(id: string): ContextTarget | undefined {
    return store.get(id);
}

export interface TargetChain {
    /** Innermost first. */
    targets: ContextTarget[];
    /** The element each target was declared on, same order. */
    elements: Element[];
}

/** Walks up from `start`, collecting every declared target on the way to the root. */
export function targetChainFor(start: Element | null): TargetChain {
    const targets: ContextTarget[] = [];
    const elements: Element[] = [];
    let node: Element | null = start?.closest(`[${TARGET_ATTR}]`) ?? null;
    while (node) {
        const id = node.getAttribute(TARGET_ATTR);
        const target = id ? store.get(id) : undefined;
        if (target) {
            targets.push(target);
            elements.push(node);
        }
        node = node.parentElement?.closest(`[${TARGET_ATTR}]`) ?? null;
    }
    return { targets, elements };
}

export function resetTargetsForTests(): void {
    store.clear();
}
