/**
 * Property-based tests for AI Trend Search Engine persistence helpers.
 * Feature: ai-trend-search-engine
 */

import * as fc from "fast-check";

jest.mock("~/server/db", () => ({
    db: {},
}));

import { createTrendSearchJobHelpers } from "~/lib/tools/trend-search/db";
import type {
    SearchCategory,
    SearchResult,
    TrendSearchJobStatus,
    TrendSearchOutput,
} from "~/lib/tools/trend-search/types";
import { SearchCategoryEnum } from "~/lib/tools/trend-search/types";

type StoredRow = {
    id: string;
    companyId: bigint;
    userId: string;
    status: TrendSearchJobStatus;
    query: string;
    companyContext: string;
    categories: SearchCategory[] | null;
    results: SearchResult[] | null;
    errorMessage: string | null;
    createdAt: Date;
    completedAt: Date | null;
    updatedAt: Date | null;
};

function cloneRow(row: StoredRow): StoredRow {
    return {
        ...row,
        categories: row.categories ? [...row.categories] : null,
        results: row.results ? row.results.map((result) => ({ ...result })) : null,
        createdAt: new Date(row.createdAt),
        completedAt: row.completedAt ? new Date(row.completedAt) : null,
        updatedAt: row.updatedAt ? new Date(row.updatedAt) : null,
    };
}

function createInMemoryTrendSearchStore() {
    const rows = new Map<string, StoredRow>();

    return {
        async insert(values: Partial<StoredRow>) {
            const now = new Date();

            const row: StoredRow = {
                id: values.id as string,
                companyId: values.companyId as bigint,
                userId: values.userId as string,
                status: (values.status as TrendSearchJobStatus | undefined) ?? "queued",
                query: values.query as string,
                companyContext: values.companyContext as string,
                categories: (values.categories as SearchCategory[] | undefined) ?? null,
                results: (values.results as SearchResult[] | undefined) ?? null,
                errorMessage: (values.errorMessage as string | undefined) ?? null,
                createdAt: (values.createdAt as Date | undefined) ?? now,
                completedAt: (values.completedAt as Date | undefined) ?? null,
                updatedAt: (values.updatedAt as Date | undefined) ?? null,
            };

            rows.set(row.id, cloneRow(row));
            return cloneRow(row);
        },

        async update(jobId: string, companyId: bigint, patch: Partial<StoredRow>) {
            const current = rows.get(jobId);
            if (!current || current.companyId !== companyId) {
                return null;
            }

            const next: StoredRow = {
                ...current,
                ...patch,
                categories:
                    patch.categories !== undefined
                        ? ((patch.categories as SearchCategory[] | null) ?? null)
                        : current.categories,
                results:
                    patch.results !== undefined
                        ? ((patch.results as SearchResult[] | null) ?? null)
                        : current.results,
                updatedAt: patch.updatedAt ?? new Date(),
            };

            rows.set(jobId, cloneRow(next));
            return cloneRow(next);
        },

        async findById(jobId: string, companyId: bigint) {
            const row = rows.get(jobId);
            if (!row || row.companyId !== companyId) {
                return null;
            }

            return cloneRow(row);
        },

        async findByCompanyId(companyId: bigint, options?: { limit?: number; offset?: number }) {
            const limit = options?.limit ?? 100;
            const offset = options?.offset ?? 0;

            return [...rows.values()]
                .filter((row) => row.companyId === companyId)
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                .slice(offset, offset + limit)
                .map(cloneRow);
        },
    };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const validCategories = SearchCategoryEnum.options;
const categoryArb = fc.constantFrom(...validCategories);
const categoriesArb = fc.uniqueArray(categoryArb, { minLength: 1, maxLength: 4 });

const nonEmptyTextArb = fc
    .string({ minLength: 1, maxLength: 300 })
    .filter((s) => s.trim().length > 0);

const validQueryArb = fc
    .string({ minLength: 1, maxLength: 1000 })
    .filter((s) => s.trim().length > 0);

const validCompanyContextArb = fc
    .string({ minLength: 1, maxLength: 2000 })
    .filter((s) => s.trim().length > 0);

const searchResultArb = fc.record({
    sourceUrl: fc.uuid().map((id) => `https://example.com/${id}`),
    summary: nonEmptyTextArb,
    description: nonEmptyTextArb,
});

const searchResultsArb = fc.array(searchResultArb, { minLength: 0, maxLength: 12 });

const isoDateArb = fc.date({ min: new Date("2000-01-01T00:00:00Z"), max: new Date("2100-01-01T00:00:00Z") })
    .filter((d) => !isNaN(d.getTime()))
    .map((d) => d.toISOString());

const trendSearchOutputArb = fc.record({
    results: searchResultsArb,
    metadata: fc.record({
        query: validQueryArb,
        companyContext: validCompanyContextArb,
        categories: categoriesArb,
        createdAt: isoDateArb,
    }),
}) as fc.Arbitrary<TrendSearchOutput>;

// ─── Property 9: Persistence round-trip ─────────────────────────────────────
// Validates: Requirements 5.1, 5.2, 5.3

describe("Property 9: Persistence round-trip", () => {
    it("persists via createJob + updateJobResults and retrieves equivalent query/context/categories/results", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.uuid(),
                fc.bigInt({ min: 1n, max: 10_000n }),
                fc.uuid(),
                validQueryArb,
                validCompanyContextArb,
                fc.option(categoriesArb, { nil: undefined }),
                trendSearchOutputArb,
                async (jobId, companyId, userId, query, companyContext, initialCategories, output) => {
                    const helpers = createTrendSearchJobHelpers(createInMemoryTrendSearchStore());

                    await helpers.createJob({
                        id: jobId,
                        companyId,
                        userId,
                        query,
                        companyContext,
                        categories: initialCategories,
                    });

                    // Simulate the persistence step in the pipeline.
                    await helpers.updateJobResults(jobId, companyId, {
                        ...output,
                        metadata: {
                            ...output.metadata,
                            query,
                            companyContext,
                        },
                    });

                    const persisted = await helpers.getJobById(jobId, companyId);

                    expect(persisted).not.toBeNull();
                    if (!persisted) return;

                    expect(persisted.input.query).toBe(query);
                    expect(persisted.input.companyContext).toBe(companyContext);
                    expect(persisted.input.categories).toEqual(output.metadata.categories);

                    expect(persisted.output).not.toBeNull();
                    expect(persisted.output?.results).toEqual(output.results);
                    expect(persisted.output?.metadata.query).toBe(query);
                    expect(persisted.output?.metadata.companyContext).toBe(companyContext);
                    expect(persisted.output?.metadata.categories).toEqual(output.metadata.categories);
                    expect(typeof persisted.output?.metadata.createdAt).toBe("string");
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ─── Property 10: Company data isolation ────────────────────────────────────
// Validates: Requirements 5.4

describe("Property 10: Company data isolation", () => {
    it("getJobsByCompanyId for company A never returns jobs created for company B", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.bigInt({ min: 1n, max: 5_000n }),
                fc.bigInt({ min: 5_001n, max: 10_000n }),
                fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 8 }),
                fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 8 }),
                validQueryArb,
                validCompanyContextArb,
                async (companyA, companyB, idsA, idsB, baseQuery, baseContext) => {
                    const helpers = createTrendSearchJobHelpers(createInMemoryTrendSearchStore());

                    for (const id of idsA) {
                        await helpers.createJob({
                            id: `a-${id}`,
                            companyId: companyA,
                            userId: `user-a-${id}`,
                            query: `${baseQuery} ${id}`,
                            companyContext: baseContext,
                            categories: ["business"],
                        });
                    }

                    for (const id of idsB) {
                        await helpers.createJob({
                            id: `b-${id}`,
                            companyId: companyB,
                            userId: `user-b-${id}`,
                            query: `${baseQuery} ${id}`,
                            companyContext: baseContext,
                            categories: ["tech"],
                        });
                    }

                    const jobsForA = await helpers.getJobsByCompanyId(companyA, {
                        limit: idsA.length + idsB.length + 10,
                        offset: 0,
                    });

                    expect(jobsForA).toHaveLength(idsA.length);
                    expect(jobsForA.every((job) => job.companyId === companyA)).toBe(true);
                    expect(jobsForA.some((job) => idsB.includes(job.id.replace(/^b-/, "")))).toBe(
                        false
                    );
                }
            ),
            { numRuns: 100 }
        );
    });
});
