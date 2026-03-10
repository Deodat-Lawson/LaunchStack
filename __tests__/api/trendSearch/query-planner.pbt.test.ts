/**
 * Property-based tests for Query Planner (planQueries).
 * Feature: ai-trend-search-engine — Task 4.2
 * Validates: Requirements 1.2, 1.3, 2.1
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
import { planQueries } from "~/server/trend-search/query-planner";
import { SearchCategoryEnum } from "~/server/trend-search/types";
import type { PlannedQuery, SearchCategory } from "~/server/trend-search/types";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const validCategories = ["fashion", "finance", "business", "tech"] as const satisfies readonly SearchCategory[];

const categoryArb = fc.constantFrom(...validCategories);

const validQueryArb = fc
    .string({ minLength: 1, maxLength: 1000 })
    .filter((s) => s.trim().length > 0);

const validCompanyContextArb = fc
    .string({ minLength: 1, maxLength: 2000 })
    .filter((s) => s.trim().length > 0);

/** Generates a single PlannedQuery-shaped object (for mock return value). */
function plannedQueryArb(categoryArbitrary: fc.Arbitrary<SearchCategory>) {
    return fc.record({
        searchQuery: fc.string({ minLength: 1, maxLength: 500 }),
        category: categoryArbitrary,
        rationale: fc.string({ minLength: 1, maxLength: 300 }),
    });
}

/** Generates 3–5 planned queries (schema-compliant). */
const plannedQueriesArb = fc.array(plannedQueryArb(categoryArb), {
    minLength: 3,
    maxLength: 5,
});

/** When categories are specified, generate planned queries using only those categories. */
function plannedQueriesForCategoriesArb(categories: readonly SearchCategory[]) {
    const catArb = fc.constantFrom(...categories);
    return fc.array(plannedQueryArb(catArb), { minLength: 3, maxLength: 5 });
}

// ─── Property 3: Category inference produces valid categories ─────────────────
// Mock LLM, generate random queries without categories, verify all returned categories are valid enum members.

describe("Property 3: Category inference produces valid categories", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockInvoke.mockClear();
    });

    it("all returned categories are valid SearchCategory enum members when categories are not provided", async () => {
        await fc.assert(
            fc.asyncProperty(
                validQueryArb,
                validCompanyContextArb,
                plannedQueriesArb,
                async (query, companyContext, plannedQueries) => {
                    mockInvoke.mockResolvedValue({ plannedQueries });

                    const result = await planQueries(query, companyContext);

                    expect(result).toHaveLength(plannedQueries.length);
                    for (const pq of result) {
                        const parsed = SearchCategoryEnum.safeParse(pq.category);
                        expect(parsed.success).toBe(true);
                    }
                }
            ),
            { numRuns: 50 }
        );
    });
});

// ─── Property 4: Specified categories are preserved ──────────────────────────
// Generate random category subsets, verify planned queries only reference specified categories.

describe("Property 4: Specified categories are preserved", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockInvoke.mockClear();
    });

    it("planned queries only reference the specified categories when categories are provided", async () => {
        const categoriesSubsetArb = fc.array(categoryArb, { minLength: 1, maxLength: 4 });
        const categoriesAndPlannedQueriesArb = categoriesSubsetArb.chain((categories) =>
            fc.tuple(fc.constant(categories), plannedQueriesForCategoriesArb(categories))
        );

        await fc.assert(
            fc.asyncProperty(
                validQueryArb,
                validCompanyContextArb,
                categoriesAndPlannedQueriesArb,
                async (query, companyContext, [categories, plannedQueries]) => {
                    mockInvoke.mockResolvedValue({ plannedQueries });

                    const result = await planQueries(query, companyContext, [...categories]);

                    expect(result).toHaveLength(plannedQueries.length);
                    const categorySet = new Set(categories);
                    for (const pq of result) {
                        expect(categorySet.has(pq.category)).toBe(true);
                    }
                }
            ),
            { numRuns: 50 }
        );
    });
});

// ─── Property 5: Query planner always produces sub-queries ───────────────────
// Generate random valid inputs, verify at least one PlannedQuery is returned (and 3–5).

describe("Property 5: Query planner always produces sub-queries", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockInvoke.mockClear();
    });

    it("returns at least one PlannedQuery (and 3–5) for any valid input when mock returns 3–5 queries", async () => {
        await fc.assert(
            fc.asyncProperty(
                validQueryArb,
                validCompanyContextArb,
                fc.option(fc.array(categoryArb, { minLength: 1, maxLength: 4 }), { nil: undefined }),
                plannedQueriesArb,
                async (query, companyContext, categories, plannedQueries) => {
                    mockInvoke.mockResolvedValue({ plannedQueries });

                    const result = await planQueries(query, companyContext, categories ?? undefined);

                    expect(result.length).toBeGreaterThanOrEqual(1);
                    expect(result.length).toBeGreaterThanOrEqual(3);
                    expect(result.length).toBeLessThanOrEqual(5);
                    for (const pq of result) {
                        expect(pq).toMatchObject({
                            searchQuery: expect.any(String),
                            category: expect.any(String),
                            rationale: expect.any(String),
                        });
                        expect(validCategories).toContain(pq.category);
                    }
                }
            ),
            { numRuns: 50 }
        );
    });
});
