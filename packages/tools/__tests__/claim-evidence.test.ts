import { describe, expect, it } from "vitest";
import { configureRag, type RagPort, type RagSearchResult } from "@launchstack/retrieval";
import { lookUpClaim } from "@launchstack/tools/claim-evidence";

function port(impl: RagPort["companyEnsembleSearch"]): RagPort {
    return { companyEnsembleSearch: impl };
}

describe("lookUpClaim", () => {
    it("returns a match with the retrieval score named relevance", async () => {
        configureRag(
            port(async () => [
                {
                    pageContent: "x".repeat(300),
                    metadata: { documentTitle: "Handbook", confidence: 0.72 },
                } as RagSearchResult,
            ])
        );

        const checked = await lookUpClaim(1, "we ship fast");
        expect(checked.match).not.toBeNull();
        expect(checked.match!.sourceDoc).toBe("Handbook");
        expect(checked.match!.relevance).toBe(0.72);
        expect(checked.match!.excerpt).toHaveLength(200);
    });

    it("distinguishes 'no source found' (null match) from a zero score", async () => {
        configureRag(port(async () => []));
        const checked = await lookUpClaim(1, "unfounded claim");
        expect(checked.match).toBeNull();
        expect(checked.error).toBeUndefined();
    });

    it("reports a missing retrieval score as null relevance, not 0", async () => {
        configureRag(port(async () => [{ pageContent: "text", metadata: {} } as RagSearchResult]));
        const checked = await lookUpClaim(1, "claim");
        expect(checked.match!.relevance).toBeNull();
    });

    it("flags lookup failures instead of returning a sentinel string", async () => {
        configureRag(
            port(async () => {
                throw new Error("index offline");
            })
        );
        const checked = await lookUpClaim(1, "claim");
        expect(checked.match).toBeNull();
        expect(checked.error).toBe(true);
    });
});
