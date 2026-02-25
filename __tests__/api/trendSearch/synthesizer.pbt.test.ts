/**
 * Property-based and unit tests for Content Synthesizer (synthesizeResults).
 * Feature: ai-trend-search-engine — Task 4.6
 * Property 7: Synthesizer output structure.
 * Property 8: Source URL traceability.
 * Unit: fewer than 5 raw results triggers placeholder padding (edge 4.5).
 * Validates: Requirements 4.1, 4.2, 4.3, 4.5
 */

const mockInvoke = jest.fn();

jest.mock("@langchain/openai", () => {
    const MockChatOpenAI = class {
        withStructuredOutput() {
            return { invoke: mockInvoke };
        }
    };
    return { __esModule: true, ChatOpenAI: MockChatOpenAI };
});

import * as fc from "fast-check";
import { synthesizeResults } from "~/server/trend-search/synthesizer";
import type { RawSearchResult, SearchCategory } from "~/server/trend-search/types";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const validCategories = ["fashion", "finance", "business", "tech"] as const satisfies readonly SearchCategory[];

const categoryArb = fc.constantFrom(...validCategories);

const validQueryArb = fc
    .string({ minLength: 1, maxLength: 1000 })
    .filter((s) => s.trim().length > 0);

const validCompanyContextArb = fc
    .string({ minLength: 1, maxLength: 2000 })
    .filter((s) => s.trim().length > 0);

/** Single raw result (URL must be unique for traceability). */
const rawResultArb = fc.record({
    url: fc.webUrl({ validSchemes: ["https"] }),
    title: fc.string({ minLength: 1, maxLength: 200 }),
    content: fc.string({ minLength: 1, maxLength: 1000 }),
    score: fc.double({ min: 0, max: 1 }),
});

/** At least 5 raw results for property tests (no placeholders). */
const rawResultsAtLeast5Arb = fc.array(rawResultArb, { minLength: 5, maxLength: 20 });

/** Build mock return so every sourceUrl is from the input raw results. */
function buildMockResults(rawResults: RawSearchResult[], count: number) {
    const urls = rawResults.map((r) => r.url);
    return Array.from({ length: Math.min(count, urls.length) }, (_, i) => ({
        sourceUrl: urls[i] ?? "",
        summary: `Summary for result ${i + 1}`,
        description: `Description for result ${i + 1} relevant to query and company.`,
    }));
}

// ─── Property 7: Synthesizer output structure ─────────────────────────────────

describe("Property 7: Synthesizer output structure", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockInvoke.mockClear();
    });

    it("for random raw result sets (≥5 items), output has exactly 5 results each with non-empty sourceUrl, summary, description", async () => {
        await fc.assert(
            fc.asyncProperty(
                rawResultsAtLeast5Arb,
                validQueryArb,
                validCompanyContextArb,
                fc.array(categoryArb, { minLength: 0, maxLength: 4 }),
                async (rawResults, query, companyContext, categories) => {
                    const mockResults = buildMockResults(rawResults, 5);
                    mockInvoke.mockResolvedValue({ results: mockResults });

                    const output = await synthesizeResults(
                        rawResults,
                        query,
                        companyContext,
                        categories
                    );

                    expect(output).toHaveLength(5);
                    for (const item of output) {
                        expect(item.sourceUrl).toBeDefined();
                        expect(typeof item.sourceUrl).toBe("string");
                        expect(item.sourceUrl.length).toBeGreaterThan(0);
                        expect(item.summary).toBeDefined();
                        expect(item.summary.length).toBeGreaterThan(0);
                        expect(item.description).toBeDefined();
                        expect(item.description.length).toBeGreaterThan(0);
                    }
                }
            ),
            { numRuns: 30 }
        );
    });
});

// ─── Property 8: Source URL traceability ──────────────────────────────────────

describe("Property 8: Source URL traceability", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockInvoke.mockClear();
    });

    it("every output sourceUrl exists in the input raw results URL set", async () => {
        await fc.assert(
            fc.asyncProperty(
                rawResultsAtLeast5Arb,
                validQueryArb,
                validCompanyContextArb,
                fc.array(categoryArb, { minLength: 0, maxLength: 4 }),
                async (rawResults, query, companyContext, categories) => {
                    const urlSet = new Set(rawResults.map((r) => r.url));
                    const mockResults = buildMockResults(rawResults, 5);
                    mockInvoke.mockResolvedValue({ results: mockResults });

                    const output = await synthesizeResults(
                        rawResults,
                        query,
                        companyContext,
                        categories
                    );

                    for (const item of output) {
                        if (item.sourceUrl.length > 0) {
                            expect(urlSet.has(item.sourceUrl)).toBe(true);
                        }
                    }
                }
            ),
            { numRuns: 30 }
        );
    });
});

// ─── Unit test: Fewer than 5 raw results triggers placeholder padding (edge 4.5) ─

describe("Unit: fewer than 5 raw results triggers placeholder padding", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockInvoke.mockClear();
    });

    it("when raw results are fewer than 5, output is padded to 5 with placeholder entries", async () => {
        const rawResults: RawSearchResult[] = [
            { url: "https://a.com/1", title: "A", content: "Content A", score: 0.9 },
            { url: "https://b.com/2", title: "B", content: "Content B", score: 0.8 },
        ];

        mockInvoke.mockResolvedValue({
            results: [
                { sourceUrl: "https://a.com/1", summary: "Sum A", description: "Desc A" },
                { sourceUrl: "https://b.com/2", summary: "Sum B", description: "Desc B" },
            ],
        });

        const output = await synthesizeResults(
            rawResults,
            "test query",
            "test company context",
            ["tech"]
        );

        expect(output).toHaveLength(5);
        expect(output[0]).toMatchObject({
            sourceUrl: "https://a.com/1",
            summary: "Sum A",
            description: "Desc A",
        });
        expect(output[1]).toMatchObject({
            sourceUrl: "https://b.com/2",
            summary: "Sum B",
            description: "Desc B",
        });
        expect(output[2]).toMatchObject({
            sourceUrl: "",
            summary: "Insufficient results",
            description: "Not enough search results were found for this query.",
        });
        expect(output[3]).toMatchObject({
            sourceUrl: "",
            summary: "Insufficient results",
            description: "Not enough search results were found for this query.",
        });
        expect(output[4]).toMatchObject({
            sourceUrl: "",
            summary: "Insufficient results",
            description: "Not enough search results were found for this query.",
        });
    });
});
