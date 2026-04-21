/**
 * Property-based tests for Client Prospector Inngest completion flow.
 * Feature: client-prospector
 *
 * Property 11: Successful pipeline sets completed status — mock all pipeline
 *              functions to succeed, run the Inngest function, verify job
 *              status is "completed" and completedAt is non-null.
 *
 * How this test works:
 *   1. We mock the DB module so updateJobStatus and updateJobResults
 *      delegate to an in-memory store instead of hitting PostgreSQL.
 *   2. We mock runClientProspector so it returns a fake output
 *      without actually calling the Foursquare API or LLM.
 *   3. We invoke the Inngest function directly by reaching into its
 *      internal .fn handler with a fake step runner.
 *   4. After the function completes, we check the in-memory store
 *      to verify the job landed in "completed" status with results saved.
 *
 * Validates: Requirements 6.4
 */

import * as fc from "fast-check";

// Mock the database so we never hit PostgreSQL.
jest.mock("~/server/db", () => ({
    db: {},
}));

// Mock the pipeline function so we control what it returns.
jest.mock("@launchstack/features/client-prospector", () => ({
    runClientProspector: jest.fn(),
}));

// Mock the DB helper exports (updateJobStatus, updateJobResults) so we
// can redirect them to our in-memory store per test iteration.
// We keep the rest of the module (createClientProspectorJobHelpers, etc.)
// as the real implementation.
jest.mock("@launchstack/features/client-prospector/db", () => {
    const actual = jest.requireActual("@launchstack/features/client-prospector/db");

    return {
        ...actual,
        updateJobStatus: jest.fn(actual.updateJobStatus),
        updateJobResults: jest.fn(actual.updateJobResults),
    };
});

import { createClientProspectorJobHelpers } from "@launchstack/features/client-prospector/db";
import * as clientProspectorDb from "@launchstack/features/client-prospector/db";
import { clientProspectorJob } from "~/server/inngest/functions/clientProspector";
import { runClientProspector } from "@launchstack/features/client-prospector";
import type {
    LatLng,
    ProspectorJobStatus,
    ProspectorOutput,
    ProspectResult,
} from "@launchstack/features/client-prospector";

// ─── In-memory store ─────────────────────────────────────────────────────────
// Same pattern as persistence.pbt.test.ts — mirrors the real Drizzle store
// but uses a Map so tests run without a database.

type StoredRow = {
    id: string;
    companyId: bigint;
    userId: string;
    status: ProspectorJobStatus;
    query: string;
    companyContext: string;
    locationLat: number;
    locationLng: number;
    radius: number;
    categories: string[] | null;
    results: ProspectResult[] | null;
    errorMessage: string | null;
    createdAt: Date;
    completedAt: Date | null;
    updatedAt: Date | null;
};

type ClientProspectorHelpers = ReturnType<typeof createClientProspectorJobHelpers>;

function cloneRow(row: StoredRow): StoredRow {
    return {
        ...row,
        categories: row.categories ? [...row.categories] : null,
        results: row.results ? row.results.map((r) => ({ ...r })) : null,
        createdAt: new Date(row.createdAt),
        completedAt: row.completedAt ? new Date(row.completedAt) : null,
        updatedAt: row.updatedAt ? new Date(row.updatedAt) : null,
    };
}

function createInMemoryClientProspectorStore() {
    const rows = new Map<string, StoredRow>();

    return {
        async insert(values: Partial<StoredRow>) {
            const now = new Date();

            const row: StoredRow = {
                id: values.id as string,
                companyId: values.companyId as bigint,
                userId: values.userId as string,
                status: (values.status as ProspectorJobStatus | undefined) ?? "queued",
                query: values.query as string,
                companyContext: values.companyContext as string,
                locationLat: values.locationLat as number,
                locationLng: values.locationLng as number,
                radius: (values.radius as number | undefined) ?? 5000,
                categories: (values.categories as string[] | undefined) ?? null,
                results: (values.results as ProspectResult[] | undefined) ?? null,
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
                        ? ((patch.categories as string[] | null) ?? null)
                        : current.categories,
                results:
                    patch.results !== undefined
                        ? ((patch.results as ProspectResult[] | null) ?? null)
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

// ─── Fake Inngest step runner ────────────────────────────────────────────────
// Inngest steps are normally executed by the Inngest SDK. In tests, we
// replace them with a simple runner that just calls the function directly
// and records which steps were executed (so we can verify the order).

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

// The Inngest function object exposes its handler as .fn internally.
// We reach into it to call the handler directly in tests.
type ClientProspectorFnWithHandler = {
    fn: (input: { event: { data: unknown }; step: StepRunner }) => Promise<unknown>;
};

async function invokeClientProspectorJob(eventData: Record<string, unknown>, stepNames: string[]) {
    const fn = (clientProspectorJob as unknown as ClientProspectorFnWithHandler).fn;
    return await fn({
        event: { data: eventData },
        step: createStepRunner(stepNames),
    });
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const nonEmptyTextArb = fc
    .string({ minLength: 1, maxLength: 300 })
    .filter((s) => s.trim().length > 0);

const validQueryArb = fc
    .string({ minLength: 1, maxLength: 1000 })
    .filter((s) => s.trim().length > 0);

const validCompanyContextArb = fc
    .string({ minLength: 1, maxLength: 2000 })
    .filter((s) => s.trim().length > 0);

const latLngArb: fc.Arbitrary<LatLng> = fc.record({
    lat: fc.double({ min: -90, max: 90, noNaN: true }),
    lng: fc.double({ min: -180, max: 180, noNaN: true }),
});

const radiusArb = fc.integer({ min: 100, max: 50000 });

const categoriesArb = fc.array(nonEmptyTextArb, { minLength: 1, maxLength: 4 });

const prospectResultArb: fc.Arbitrary<ProspectResult> = fc.record({
    fsqId: fc.uuid(),
    name: nonEmptyTextArb,
    address: nonEmptyTextArb,
    location: latLngArb,
    categories: fc.array(nonEmptyTextArb, { minLength: 1, maxLength: 3 }),
    phone: fc.option(nonEmptyTextArb, { nil: undefined }),
    website: fc.option(
        fc.uuid().map((id) => `https://example.com/${id}`),
        { nil: undefined }
    ),
    rating: fc.option(fc.double({ min: 0, max: 10, noNaN: true }), { nil: undefined }),
    relevanceScore: fc.integer({ min: 0, max: 100 }),
    rationale: nonEmptyTextArb,
});

const prospectResultsArb = fc.array(prospectResultArb, { minLength: 0, maxLength: 10 });

// ─── Property 11: Successful pipeline sets completed status ──────────────────
// Validates: Requirements 6.4

describe("Property 11: Successful pipeline sets completed status", () => {
    // activeHelpers holds the in-memory store helpers for the current test
    // iteration. The mocked updateJobStatus/updateJobResults delegate to it.
    let activeHelpers: ClientProspectorHelpers | null = null;

    beforeEach(() => {
        activeHelpers = null;

        // Get typed references to the mocked functions.
        const updateJobStatusMock = clientProspectorDb.updateJobStatus as jest.MockedFunction<
            typeof clientProspectorDb.updateJobStatus
        >;
        const updateJobResultsMock = clientProspectorDb.updateJobResults as jest.MockedFunction<
            typeof clientProspectorDb.updateJobResults
        >;
        const runClientProspectorMock = runClientProspector as jest.MockedFunction<typeof runClientProspector>;

        updateJobStatusMock.mockReset();
        updateJobResultsMock.mockReset();
        runClientProspectorMock.mockReset();

        // Wire the mocked DB exports to the current iteration's in-memory store.
        // This way, when the Inngest function calls updateJobStatus/updateJobResults,
        // it actually writes to our in-memory Map.
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

    it('mocking a successful pipeline run marks the job "completed" and sets completedAt', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.uuid(),
                fc.bigInt({ min: 1n, max: 10_000n }),
                fc.uuid(),
                validQueryArb,
                validCompanyContextArb,
                latLngArb,
                radiusArb,
                fc.option(categoriesArb, { nil: undefined }),
                prospectResultsArb,
                categoriesArb,
                async (
                    jobId,
                    companyId,
                    userId,
                    query,
                    companyContext,
                    location,
                    radius,
                    initialCategories,
                    results,
                    outputCategories
                ) => {
                    // Create a fresh in-memory store for this iteration.
                    const helpers = createClientProspectorJobHelpers(createInMemoryClientProspectorStore());
                    activeHelpers = helpers;

                    // Seed the store with a job in "queued" status,
                    // just like the API route would do before sending the event.
                    await helpers.createJob({
                        id: jobId,
                        companyId,
                        userId,
                        query,
                        companyContext,
                        location,
                        radius,
                        categories: initialCategories,
                    });

                    // Build the output that the mocked pipeline will return.
                    const output: ProspectorOutput = {
                        results,
                        metadata: {
                            query,
                            companyContext,
                            location,
                            radius,
                            categories: outputCategories,
                            createdAt: new Date().toISOString(),
                        },
                    };

                    // Mock runClientProspector to return our fake output.
                    // It also fires the onStageChange callback to simulate
                    // the pipeline progressing through stages.
                    const runMock = runClientProspector as jest.MockedFunction<typeof runClientProspector>;
                    runMock.mockImplementationOnce(async (_input, options) => {
                        await options?.onStageChange?.("searching");
                        await options?.onStageChange?.("scoring");
                        return output;
                    });

                    // Invoke the Inngest function directly.
                    // stepNames records the order of Inngest steps executed.
                    const stepNames: string[] = [];
                    await invokeClientProspectorJob(
                        {
                            jobId,
                            companyId: companyId.toString(),
                            userId,
                            query,
                            companyContext,
                            location,
                            radius,
                            ...(initialCategories ? { categories: initialCategories } : {}),
                        },
                        stepNames
                    );

                    // Verify the job ended up in the right state.
                    const persisted = await helpers.getJobById(jobId, companyId);
                    expect(persisted).not.toBeNull();
                    if (!persisted) return;

                    // Inngest should have run exactly two steps in order.
                    expect(stepNames).toEqual(["run-pipeline", "persist"]);

                    // Job should be marked completed with a timestamp.
                    expect(persisted.status).toBe("completed");
                    expect(persisted.completedAt).not.toBeNull();
                    expect(persisted.completedAt instanceof Date).toBe(true);
                    expect(persisted.errorMessage).toBeNull();

                    // Results should be persisted in the store.
                    expect(persisted.output).not.toBeNull();
                    expect(persisted.output?.results).toEqual(results);
                    expect(persisted.output?.metadata.categories).toEqual(outputCategories);
                }
            ),
            { numRuns: 50 }
        );
    });
});
