/**
 * A small in-memory TTL cache with sha256 keys and size-triggered pruning —
 * the 45 lines that previously existed twice (trend-search's result cache and
 * marketing's competitor cache) with different constants. Callers own key
 * normalization; this module owns hashing, expiry, and pruning.
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
            if (cache.size > opts.maxEntries) prune();
            cache.set(hash(key), { value, expiresAt: Date.now() + opts.ttlMs });
        },
    };
}
