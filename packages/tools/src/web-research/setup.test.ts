import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { describeSearchSetup, resolveSearchSetup } from "./setup";
import { SEARCH_PROVIDER_IDS } from "./types";
import { searchWeb } from "./web-search";

const CREDENTIALS = {
    exa: ["EXA_API_KEY", "exa-test"],
    serper: ["SERPER_API_KEY", "serper-test"],
    brave: ["BRAVE_SEARCH_API_KEY", "brave-test"],
    tavily: ["TAVILY_API_KEY", "tvly-test"],
    searxng: ["SEARXNG_URL", "http://searxng:8080"],
} as const;

function configure(...ids: Array<keyof typeof CREDENTIALS>): void {
    for (const id of ids) {
        const [name, value] = CREDENTIALS[id];
        vi.stubEnv(name, value);
    }
}

describe("resolveSearchSetup", () => {
    beforeEach(() => {
        vi.stubEnv("SEARCH_PROVIDER", "");
        for (const [name] of Object.values(CREDENTIALS)) vi.stubEnv(name, "");
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it("is off with nothing configured", () => {
        expect(resolveSearchSetup()).toEqual({
            provider: null,
            source: null,
            requested: null,
            problem: null,
        });
    });

    it.each(SEARCH_PROVIDER_IDS)(
        "uses %s when SEARCH_PROVIDER names it and it is configured",
        id => {
            // Every provider configured: the setting alone decides.
            configure(...SEARCH_PROVIDER_IDS);
            vi.stubEnv("SEARCH_PROVIDER", id);
            const setup = resolveSearchSetup();
            expect(setup.provider?.id).toBe(id);
            expect(setup.source).toBe("setting");
            expect(setup.problem).toBeNull();
        }
    );

    it("accepts the setting in any case and with spaces around it", () => {
        configure("brave");
        vi.stubEnv("SEARCH_PROVIDER", "  Brave ");
        expect(resolveSearchSetup().provider?.id).toBe("brave");
    });

    it.each(SEARCH_PROVIDER_IDS)(
        "turns search off when SEARCH_PROVIDER=%s lacks its credential, whatever else is set",
        id => {
            configure(...SEARCH_PROVIDER_IDS.filter(other => other !== id));
            vi.stubEnv("SEARCH_PROVIDER", id);
            expect(resolveSearchSetup()).toMatchObject({
                provider: null,
                source: "setting",
                requested: id,
                problem: "missing-credentials",
            });
        }
    );

    it("turns search off for a name that isn't a provider", () => {
        configure("exa");
        vi.stubEnv("SEARCH_PROVIDER", "bing");
        expect(resolveSearchSetup()).toMatchObject({
            provider: null,
            problem: "unknown-provider",
        });
    });

    it("picks the first configured provider when unset: exa, serper, brave, tavily, searxng", () => {
        configure("searxng");
        expect(resolveSearchSetup().provider?.id).toBe("searxng");
        configure("tavily");
        expect(resolveSearchSetup().provider?.id).toBe("tavily");
        configure("brave");
        expect(resolveSearchSetup().provider?.id).toBe("brave");
        configure("serper");
        expect(resolveSearchSetup().provider?.id).toBe("serper");
        configure("exa");
        expect(resolveSearchSetup()).toMatchObject({ source: "auto", problem: null });
        expect(resolveSearchSetup().provider?.id).toBe("exa");
    });

    it.each(["fallback", "parallel"])("treats the retired %s strategy as unset", value => {
        configure("serper");
        vi.stubEnv("SEARCH_PROVIDER", value);
        expect(resolveSearchSetup()).toMatchObject({ source: "auto", requested: value });
        expect(resolveSearchSetup().provider?.id).toBe("serper");
    });

    it("logs a configuration problem once, not on every search", async () => {
        const warn = vi.mocked(console.warn);
        warn.mockClear();
        vi.stubEnv("SEARCH_PROVIDER", "tavily");
        resolveSearchSetup();
        resolveSearchSetup();
        await expect(searchWeb("q", { fetchImpl: vi.fn() })).rejects.toThrow(
            "Web search is off: SEARCH_PROVIDER=tavily needs TAVILY_API_KEY."
        );
        const mentions = warn.mock.calls.filter(call => String(call[0]).includes("TAVILY_API_KEY"));
        expect(mentions.length).toBeLessThanOrEqual(1);
    });
});

describe("describeSearchSetup", () => {
    beforeEach(() => {
        vi.stubEnv("SEARCH_PROVIDER", "");
        for (const [name] of Object.values(CREDENTIALS)) vi.stubEnv(name, "");
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it("names the engine in use and what it can do, never a key", () => {
        configure("exa", "serper");
        const view = describeSearchSetup();
        expect(view).toMatchObject({
            provider: "exa",
            label: "Exa",
            source: "auto",
            credential: "EXA_API_KEY",
            capabilities: { web: true, news: true, companies: true },
        });
        expect(view.providers.map(p => [p.id, p.configured, p.companies])).toEqual([
            ["exa", true, true],
            ["serper", true, false],
            ["brave", false, false],
            ["tavily", false, false],
            ["searxng", false, false],
        ]);
        expect(JSON.stringify(view)).not.toContain("exa-test");
        expect(JSON.stringify(view)).not.toContain("serper-test");
    });

    it("says which setting is missing when the chosen engine can't run", () => {
        configure("exa");
        vi.stubEnv("SEARCH_PROVIDER", "searxng");
        expect(describeSearchSetup()).toMatchObject({
            provider: null,
            label: "SearXNG",
            source: "setting",
            problem: "missing-credentials",
            credential: "SEARXNG_URL",
            capabilities: { web: false, news: false, companies: false },
        });
    });

    it("has no company search on an engine without a company index", () => {
        configure("searxng");
        expect(describeSearchSetup().capabilities).toEqual({
            web: true,
            news: true,
            companies: false,
        });
    });
});
