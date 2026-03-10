/**
 * Property-based tests for AI Trend Search Engine Inngest completion flow.
 * Feature: ai-trend-search-engine
 */

import * as fc from "fast-check";

jest.mock("~/server/db", () => ({
    db: {},
}));

jest.mock("~/server/trend-search/run", () => ({
    runTrendSearch: jest.fn(),
}));

jest.mock("~/server/trend-search/db", () => {
    const actual = jest.requireActual("~/server/trend-search/db");

    return {
        ...actual,
        updateJobStatus: jest.fn(actual.updateJobStatus),
        updateJobResults: jest.fn(actual.updateJobResults),
    };
});

import { createTrendSearchJobHelpers } from "~/server/trend-search/db";
import * as trendSearchDb from "~/server/trend-search/db";
import { trendSearchJob } from "~/server/inngest/functions/trendSearch";
import { runTrendSearch } from "~/server/trend-search/run";
import type {
    SearchCategory,
    SearchResult,
    TrendSearchJobStatus,
    TrendSearchOutput,
} from "~/server/trend-search/types";
import { SearchCategoryEnum } from "~/server/trend-search/types";

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

type TrendSearchHelpers = ReturnType<typeof createTrendSearchJobHelpers>;

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

type StepRunner = {
    run<T>(name: string, fn: () => Promise<T>): Promise<T>;
};

function createStepRunner(stepNames: string[]): StepRunner {
    return {
        async run<T>(name: string, fn: () => Promise<T>) {
            stepNames.push(name);
            return await fn();
        },
    };
}

type TrendSearchFnWithHandler = {
    fn: (input: { event: { data: unknown }; step: StepRunner }) => Promise<unknown>;
};

async function invokeTrendSearchJob(eventData: Record<string, unknown>, stepNames: string[]) {
    const fn = (trendSearchJob as unknown as TrendSearchFnWithHandler).fn;
    return await fn({
        event: { data: eventData },
        step: createStepRunner(stepNames),
    });
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

describe("Property 11: Successful pipeline sets completed status", () => {
    let activeHelpers: TrendSearchHelpers | null = null;

    beforeEach(() => {
        activeHelpers = null;

        const updateJobStatusMock = trendSearchDb.updateJobStatus as jest.MockedFunction<
            typeof trendSearchDb.updateJobStatus
        >;
        const updateJobResultsMock = trendSearchDb.updateJobResults as jest.MockedFunction<
            typeof trendSearchDb.updateJobResults
        >;
        const runTrendSearchMock = runTrendSearch as jest.MockedFunction<typeof runTrendSearch>;

        updateJobStatusMock.mockReset();
        updateJobResultsMock.mockReset();
        runTrendSearchMock.mockReset();

        updateJobStatusMock.mockImplementation(async (...args) => {
            if (!activeHelpers) {
                throw new Error("Test helper store not initialized");
            }
            return await activeHelpers.updateJobStatus(...args);
        });

        updateJobResultsMock.mockImplementation(async (...args) => {
            if (!activeHelpers) {
                throw new Error("Test helper store not initialized");
            }
            return await activeHelpers.updateJobResults(...args);
        });
    });

    afterEach(() => {
        activeHelpers = null;
        jest.clearAllMocks();
    });

    // ─── Property 11: Successful pipeline sets completed status ─────────────
    // Validates: Requirements 6.4
    it('mocking a successful pipeline run marks the job "completed" and sets completedAt', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.uuid(),
                fc.bigInt({ min: 1n, max: 10_000n }),
                fc.uuid(),
                validQueryArb,
                validCompanyContextArb,
                fc.option(categoriesArb, { nil: undefined }),
                searchResultsArb,
                categoriesArb,
                async (
                    jobId,
                    companyId,
                    userId,
                    query,
                    companyContext,
                    initialCategories,
                    results,
                    outputCategories
                ) => {
                    const helpers = createTrendSearchJobHelpers(createInMemoryTrendSearchStore());
                    activeHelpers = helpers;

                    await helpers.createJob({
                        id: jobId,
                        companyId,
                        userId,
                        query,
                        companyContext,
                        categories: initialCategories,
                    });

                    const output: TrendSearchOutput = {
                        results,
                        metadata: {
                            query,
                            companyContext,
                            categories: outputCategories,
                            createdAt: new Date().toISOString(),
                        },
                    };

                    const runTrendSearchMock = runTrendSearch as jest.MockedFunction<typeof runTrendSearch>;
                    runTrendSearchMock.mockImplementationOnce(async (_input, options) => {
                        await options?.onStageChange?.("synthesizing");
                        return output;
                    });

                    const stepNames: string[] = [];
                    await invokeTrendSearchJob(
                        {
                            jobId,
                            companyId: companyId.toString(),
                            userId,
                            query,
                            companyContext,
                            ...(initialCategories ? { categories: initialCategories } : {}),
                        },
                        stepNames
                    );

                    const persisted = await helpers.getJobById(jobId, companyId);
                    expect(persisted).not.toBeNull();
                    if (!persisted) return;

                    expect(stepNames).toEqual(["run-pipeline", "persist"]);
                    expect(persisted.status).toBe("completed");
                    expect(persisted.completedAt).not.toBeNull();
                    expect(persisted.completedAt instanceof Date).toBe(true);
                    expect(persisted.errorMessage).toBeNull();

                    // The Inngest wrapper owns persistence and completion transition.
                    expect(persisted.output).not.toBeNull();
                    expect(persisted.output?.results).toEqual(results);
                    expect(persisted.output?.metadata.categories).toEqual(outputCategories);
                }
            ),
            { numRuns: 50 }
        );
    });
});
