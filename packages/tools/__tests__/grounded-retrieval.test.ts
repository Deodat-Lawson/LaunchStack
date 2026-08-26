import { describe, expect, it, vi } from "vitest";
import { configureRag, type RagPort, type RagSearchResult } from "@launchstack/search";
import {
    cleanSnippet,
    formatSnippetBlock,
    retrieveCompanySnippets,
    SNIPPET_POLICIES,
} from "@launchstack/tools/grounded-retrieval";

function result(pageContent: string): RagSearchResult {
    return { pageContent, metadata: {} } as RagSearchResult;
}

function fakePort(impl: RagPort["companyEnsembleSearch"]): RagPort {
    return { companyEnsembleSearch: impl };
}

describe("SNIPPET_POLICIES", () => {
    it("freezes the pre-extraction constants per call-site shape", () => {
        expect(SNIPPET_POLICIES.standard).toEqual({
            topK: 6,
            weights: [0.4, 0.6],
            maxSnippets: 6,
            maxSnippetChars: 400,
        });
        expect(SNIPPET_POLICIES.compact.maxSnippetChars).toBe(320);
        expect(SNIPPET_POLICIES.pinpoint.topK).toBe(2);
    });
});

describe("retrieveCompanySnippets", () => {
    it("passes the policy's topK and weights to the port", async () => {
        const search = vi.fn(async () => [] as RagSearchResult[]);
        configureRag(fakePort(search));

        await retrieveCompanySnippets({
            companyId: 7,
            query: "what does the company do",
            policy: SNIPPET_POLICIES.compact,
        });

        expect(search).toHaveBeenCalledWith("what does the company do", {
            companyId: 7,
            topK: 4,
            weights: [0.4, 0.6],
        });
    });

    it("cleans snippets (trim, collapse whitespace, char cap) and caps the count", async () => {
        const long = `  padded    ${"x".repeat(500)}  `;
        configureRag(
            fakePort(async () => [
                result(long),
                result("second"),
                result("third"),
                result("fourth — beyond maxSnippets for pinpoint"),
            ])
        );

        const { snippets } = await retrieveCompanySnippets({
            companyId: 1,
            query: "q",
            policy: SNIPPET_POLICIES.pinpoint,
        });

        expect(snippets).toHaveLength(2);
        expect(snippets[0]).toBe(`padded ${"x".repeat(500)}`.slice(0, 200));
        expect(snippets[0]!.length).toBeLessThanOrEqual(200);
    });

    it('policy "throw" propagates retrieval errors', async () => {
        configureRag(
            fakePort(async () => {
                throw new Error("port down");
            })
        );

        await expect(
            retrieveCompanySnippets({
                companyId: 1,
                query: "q",
                policy: SNIPPET_POLICIES.standard,
                onError: "throw",
            })
        ).rejects.toThrow("port down");
    });

    it('policy "empty" degrades to zero snippets and logs the error', async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        configureRag(
            fakePort(async () => {
                throw new Error("port down");
            })
        );

        const { snippets, results } = await retrieveCompanySnippets({
            companyId: 1,
            query: "q",
            policy: SNIPPET_POLICIES.standard,
            onError: "empty",
        });

        expect(snippets).toEqual([]);
        expect(results).toEqual([]);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe("cleanSnippet / formatSnippetBlock", () => {
    it("cleanSnippet trims, collapses, and caps", () => {
        expect(cleanSnippet("  a   b\n\nc  ", 100)).toBe("a b c");
        expect(cleanSnippet("abcdef", 3)).toBe("abc");
    });

    it("formatSnippetBlock numbers snippets and honors the empty text", () => {
        expect(formatSnippetBlock(["one", "two"], "none")).toBe("1. one\n\n2. two");
        expect(formatSnippetBlock([], "No text samples available.")).toBe(
            "No text samples available."
        );
    });
});
