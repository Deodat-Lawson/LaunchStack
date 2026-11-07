/**
 * A small in-memory TTL cache with sha256 keys and a hard size cap — the 45
 * lines that previously existed twice (trend-search's result cache and
 * marketing's competitor cache) with different constants. Callers own key
 * normalization; this module owns hashing, expiry, and eviction. Writing past
 * `maxEntries` drops expired entries first, then the oldest writes.
 */

import { createHash } from "node:crypto";

export interface TtlCache<T> {
    get(key: string): T | null;
    set(key: string, value: T): void;
}

export function createTtlCache<T>(opts: { ttlMs: number; maxEntries: number }): TtlCache<T> {
    const cache = new Map<string, { value: T; expiresAt: number }>();

    const hash = (key: string) => createHash("sha256").update(key).digest("hex");

    const prune = () => {
        const now = Date.now();
        for (const [k, entry] of cache.entries()) {
            if (entry.expiresAt <= now) cache.delete(k);
        }
    };

    return {
        get(key) {
            const k = hash(key);
            const entry = cache.get(k);
            if (!entry) return null;
            if (entry.expiresAt <= Date.now()) {
                cache.delete(k);
                return null;
            }
            return entry.value;
        },
        set(key, value) {
            const k = hash(key);
            // A rewrite is the newest write, not a second entry.
            cache.delete(k);
            if (cache.size >= opts.maxEntries) prune();
            // Map iterates in insertion order, so the first keys are the oldest writes.
            for (const oldest of cache.keys()) {
                if (cache.size < opts.maxEntries) break;
                cache.delete(oldest);
            }
            cache.set(k, { value, expiresAt: Date.now() + opts.ttlMs });
        },
    };
}
