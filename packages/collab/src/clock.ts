/**
 * Clock and id generation, injectable so meetings replay deterministically in
 * tests. Production callers use `systemClock` / `randomIdFactory`.
 */

import { randomUUID } from "node:crypto";

export interface Clock {
    /** Milliseconds since epoch. */
    now(): number;
    /** ISO-8601 timestamp for `now()`. */
    iso(): string;
}

export const systemClock: Clock = {
    now: () => Date.now(),
    iso: () => new Date().toISOString(),
};

/**
 * A clock that starts at a fixed instant and advances only when told to. Used
 * by tests that assert on ordering without sleeping.
 */
export function fixedClock(startMs = 0, stepMs = 1000): Clock & { advance(ms?: number): void } {
    let current = startMs;
    return {
        now: () => current,
        iso: () => new Date(current).toISOString(),
        advance(ms = stepMs) {
            current += ms;
        },
    };
}

export type IdFactory = (prefix: string) => string;

export const randomIdFactory: IdFactory = prefix => `${prefix}_${randomUUID().replace(/-/g, "")}`;

/** Monotonic ids — `msg_1`, `msg_2`, … — for deterministic assertions. */
export function sequentialIdFactory(): IdFactory {
    const counters = new Map<string, number>();
    return prefix => {
        const next = (counters.get(prefix) ?? 0) + 1;
        counters.set(prefix, next);
        return `${prefix}_${next}`;
    };
}
