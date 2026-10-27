/**
 * The claim check is a verdict now, not a similarity score. Pinned here:
 * a claim is "supported" only when the judgment says a retrieved passage
 * states it; no passage means "unsupported" without asking a model; a failed
 * lookup or a failed judgment means "unchecked" — never "supported"; and
 * anything but "supported" needs a person to look before posting.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { configureRag, type RagPort, type RagSearchResult } from "@launchstack/retrieval";

const mockInvoke = vi.fn();
/** Set to make the next model call fail the way a timeout does. */
let failNextCall: Error | null = null;
vi.mock("../src/llm", async importOriginal => ({
    ...(await importOriginal<object>()),
    invokeToolStructured: async (...args: unknown[]) => {
        if (failNextCall) {
            const error = failNextCall;
            failNextCall = null;
            throw error;
        }
        return mockInvoke(...args);
    },
}));

import {
    checkClaimSources,
    claimNeedsReview,
    judgeClaims,
} from "@launchstack/tools/claim-evidence";

const doc = (pageContent: string, title = "Handbook"): RagSearchResult =>
    ({ pageContent, metadata: { documentTitle: title, confidence: 0.81 } }) as RagSearchResult;

function rag(byQuery: Record<string, RagSearchResult[] | "throw">) {
    const port: RagPort = {
        companyEnsembleSearch: async (query: string) => {
            const hit = byQuery[query];
            if (hit === "throw") throw new Error("index offline");
            return hit ?? [];
        },
    } as unknown as RagPort;
    configureRag(port);
}

beforeEach(() => {
    mockInvoke.mockReset();
    failNextCall = null;
});

describe("judgeClaims", () => {
    const looked = (claim: string, evidence: string[], error = false) => ({
        checked: {
            claim,
            match: evidence.length
                ? { sourceDoc: "Handbook", excerpt: evidence[0]!.slice(0, 200), relevance: 0.9 }
                : null,
            ...(error ? { error: true } : {}),
        },
        evidence,
    });

    it("takes the model's verdict per claim, with its reason", async () => {
        mockInvoke.mockResolvedValue({
            result: {
                verdicts: [
                    { index: 0, verdict: "supported", reason: "The handbook says 40% faster." },
                    { index: 1, verdict: "contradicted", reason: "The handbook says 12 cities." },
                ],
            },
        });
        const out = await judgeClaims([
            looked("Onboarding is 40% faster", ["Onboarding is 40% faster since v2."]),
            looked("We operate in 30 cities", ["We operate in 12 cities."]),
        ]);
        expect(out.map(c => c.support)).toEqual(["supported", "contradicted"]);
        expect(out[1]!.reason).toMatch(/12 cities/);
        expect(out.map(claimNeedsReview)).toEqual([false, true]);
    });

    it("a high similarity score is not support: a related passage gets 'unsupported'", async () => {
        mockInvoke.mockResolvedValue({
            result: {
                verdicts: [
                    { index: 0, verdict: "unsupported", reason: "Mentions SOC 2 plans only." },
                ],
            },
        });
        const [claim] = await judgeClaims([
            looked("We are SOC 2 certified", ["We plan to start a SOC 2 audit next year."]),
        ]);
        expect(claim!.match?.relevance).toBe(0.9);
        expect(claim!.support).toBe("unsupported");
        expect(claimNeedsReview(claim!)).toBe(true);
    });

    it("no passage is 'unsupported' and a failed lookup is 'unchecked', without asking a model", async () => {
        const out = await judgeClaims([looked("Unfounded", []), looked("Lookup died", [], true)]);
        expect(out.map(c => c.support)).toEqual(["unsupported", "unchecked"]);
        expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("a failed judgment leaves claims 'unchecked', never 'supported'", async () => {
        failNextCall = new Error("model timeout");
        const [claim] = await judgeClaims([looked("Onboarding is 40% faster", ["…"])]);
        expect(claim!.support).toBe("unchecked");
        expect(claimNeedsReview(claim!)).toBe(true);
    });

    it("ignores verdicts for claims it did not ask about, and a missing verdict stays 'unchecked'", async () => {
        mockInvoke.mockResolvedValue({
            result: { verdicts: [{ index: 0, verdict: "supported", reason: "x" }] },
        });
        const out = await judgeClaims([looked("No passage", []), looked("Asked", ["passage"])]);
        // index 0 had no passage, so a "supported" for it is ignored; index 1 got no verdict.
        expect(out.map(c => c.support)).toEqual(["unsupported", "unchecked"]);
    });
});

describe("checkClaimSources", () => {
    it("extracts, looks up and judges every claim", async () => {
        rag({
            "Onboarding is 40% faster": [doc("Onboarding is 40% faster since v2.")],
            "We have 10,000 customers": [],
        });
        mockInvoke
            .mockResolvedValueOnce({
                result: { claims: ["Onboarding is 40% faster", "We have 10,000 customers"] },
            })
            .mockResolvedValueOnce({
                result: { verdicts: [{ index: 0, verdict: "supported", reason: "Stated." }] },
            });
        const result = await checkClaimSources({ companyId: 1, message: "post" });
        expect(result.totalClaimsFound).toBe(2);
        expect(result.claims.map(c => [c.claim, c.support])).toEqual([
            ["Onboarding is 40% faster", "supported"],
            ["We have 10,000 customers", "unsupported"],
        ]);
        // The judgment read the passage, not only the 200-character excerpt.
        const judgmentPrompt = (mockInvoke.mock.calls[1]![2] as Array<{ content: string }>)[1]!
            .content;
        expect(judgmentPrompt).toContain("Onboarding is 40% faster since v2.");
    });

    it("no claims means nothing to judge", async () => {
        mockInvoke.mockResolvedValueOnce({ result: { claims: [] } });
        expect(await checkClaimSources({ companyId: 1, message: "Hello!" })).toEqual({
            claims: [],
            totalClaimsFound: 0,
        });
        expect(mockInvoke).toHaveBeenCalledTimes(1);
    });
});
