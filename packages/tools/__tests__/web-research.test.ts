import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTtlCache, executeSearch } from "@launchstack/tools/web-research";

describe("createTtlCache", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("returns stored values until the TTL elapses", () => {
        const cache = createTtlCache<string>({ ttlMs: 1000, maxEntries: 10 });
        cache.set("k", "v");
        expect(cache.get("k")).toBe("v");

        vi.advanceTimersByTime(999);
        expect(cache.get("k")).toBe("v");

        vi.advanceTimersByTime(2);
        expect(cache.get("k")).toBeNull();
    });

    it("misses on unknown keys and distinguishes keys", () => {
        const cache = createTtlCache<number>({ ttlMs: 1000, maxEntries: 10 });
        cache.set("a", 1);
        cache.set("b", 2);
        expect(cache.get("a")).toBe(1);
        expect(cache.get("b")).toBe(2);
        expect(cache.get("c")).toBeNull();
    });

    it("prunes expired entries when the size cap is exceeded", () => {
        const cache = createTtlCache<number>({ ttlMs: 1000, maxEntries: 2 });
        cache.set("a", 1);
        cache.set("b", 2);
        cache.set("c", 3);
        vi.advanceTimersByTime(2000);
        // All expired; a set past the cap prunes them rather than growing.
        cache.set("d", 4);
        expect(cache.get("a")).toBeNull();
        expect(cache.get("d")).toBe(4);
    });
});

describe("executeSearch", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    beforeEach(() => {
        for (const name of [
            "SEARCH_PROVIDER",
            "EXA_API_KEY",
            "SERPER_API_KEY",
            "BRAVE_SEARCH_API_KEY",
            "TAVILY_API_KEY",
            "SEARXNG_URL",
        ]) {
            vi.stubEnv(name, "");
        }
    });

    it("reports providerUsed 'none' when no provider is configured", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch");

        const result = await executeSearch([
            { searchQuery: "anything", category: "tech", rationale: "test" },
        ]);

        expect(result.results).toEqual([]);
        expect(result.providerUsed).toBe("none");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("searches nothing when SEARCH_PROVIDER names a provider without its key", async () => {
        vi.stubEnv("EXA_API_KEY", "exa-test");
        vi.stubEnv("SEARCH_PROVIDER", "serper");
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        const result = await executeSearch([
            { searchQuery: "anything", category: "business", rationale: "test" },
        ]);

        expect(result.providerUsed).toBe("none");
        expect(warn.mock.calls.flat().join(" ")).toContain("needs SERPER_API_KEY");
    });
});
