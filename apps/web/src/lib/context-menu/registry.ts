import type { ActionDefinition } from "./types";

/**
 * One registry for the whole app. Static actions register at module load;
 * screens register theirs while mounted (`useRegisterActions`) and unregister
 * on unmount. A later registration with the same id shadows an earlier one
 * until it is removed, so a workspace can specialise an app-wide verb.
 */
const actions = new Map<string, ActionDefinition[]>();

export function registerActions(defs: readonly ActionDefinition[]): () => void {
    for (const def of defs) {
        const stack = actions.get(def.id) ?? [];
        stack.push(def);
        actions.set(def.id, stack);
    }
    return () => {
        for (const def of defs) {
            const stack = actions.get(def.id);
            if (!stack) continue;
            const idx = stack.lastIndexOf(def);
            if (idx >= 0) stack.splice(idx, 1);
            if (stack.length === 0) actions.delete(def.id);
        }
    };
}

/** The live definition for each id, in first-registration order. */
export function listActions(): ActionDefinition[] {
    const out: ActionDefinition[] = [];
    for (const stack of actions.values()) {
        const top = stack[stack.length - 1];
        if (top) out.push(top);
    }
    return out;
}

export function getAction(id: string): ActionDefinition | undefined {
    const stack = actions.get(id);
    return stack?.[stack.length - 1];
}

export function resetActionsForTests(): void {
    actions.clear();
}
