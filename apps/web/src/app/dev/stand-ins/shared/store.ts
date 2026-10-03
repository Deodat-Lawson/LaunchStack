/**
 * In-memory worlds for the stand-ins. State lives on `globalThis` so it
 * survives Next dev HMR and is shared between the route handler and the
 * page (Next compiles them as separate module graphs; the process is one).
 */

/** The stand-ins' notion of "now". Tests replace `now`; nothing else should. */
export const standInClock = { now: (): number => Date.now() };

export interface GlobalSlot<T> {
    get(): T;
    reset(): T;
}

export function globalSlot<T extends { schema: number }>(
    key: string,
    schema: number,
    seed: () => T
): GlobalSlot<T> {
    const symbol = Symbol.for(`launchstack.dev.stand-in.${key}`);
    const holder = globalThis as unknown as Record<symbol, T | undefined>;
    return {
        get() {
            const current = holder[symbol];
            // A state shape from before an edit is reseeded rather than read.
            if (current?.schema === schema) return current;
            const fresh = seed();
            holder[symbol] = fresh;
            return fresh;
        },
        reset() {
            const fresh = seed();
            holder[symbol] = fresh;
            return fresh;
        },
    };
}
