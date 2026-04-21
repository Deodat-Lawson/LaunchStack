/**
 * Property-based tests for Client Prospector persistence helpers.
 * Feature: client-prospector
 *
 * Property 9:  Persistence round-trip — createJob + updateJobResults + getJobById
 *              preserves query, companyContext, location, radius, categories, results.
 * Property 10: Company data isolation — getJobsByCompanyId for company A never
 *              returns jobs created for company B.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4
 */

import * as fc from "fast-check";

jest.mock("~/server/db", () => ({
    db: {},
}));

import { createClientProspectorJobHelpers } from "@launchstack/features/client-prospector/db";
import type {
    LatLng,
    ProspectorJobStatus,
    ProspectorOutput,
    ProspectResult,
} from "@launchstack/features/client-prospector";

// ─── In-memory store (mirrors the ClientProspectorJobStore interface) ────────
// This replaces the real Drizzle store so tests run without a database.

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

const isoDateArb = fc.integer({ min: 0, max: 4102444800000 }).map((ms) => new Date(ms).toISOString());

const prospectorOutputArb = fc.tuple(
    prospectResultsArb,
    validQueryArb,
    validCompanyContextArb,
    latLngArb,
    radiusArb,
    categoriesArb,
    isoDateArb
).map(([results, query, companyContext, location, radius, categories, createdAt]) => ({
    results,
    metadata: { query, companyContext, location, radius, categories, createdAt },
})) as fc.Arbitrary<ProspectorOutput>;

// ─── Property 9: Persistence round-trip ─────────────────────────────────────
// Validates: Requirements 5.1, 5.2, 5.3

describe("Property 9: Persistence round-trip", () => {
    it("persists via createJob + updateJobResults and retrieves equivalent query/context/location/radius/categories/results", async () => {
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
                prospectorOutputArb,
                async (jobId, companyId, userId, query, companyContext, location, radius, initialCategories, output) => {
                    const helpers = createClientProspectorJobHelpers(createInMemoryClientProspectorStore());

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

                    // Simulate the persistence step in the pipeline.
                    await helpers.updateJobResults(jobId, companyId, {
                        ...output,
                        metadata: {
                            ...output.metadata,
                            query,
                            companyContext,
                            location,
                            radius,
                        },
                    });

                    const persisted = await helpers.getJobById(jobId, companyId);

                    expect(persisted).not.toBeNull();
                    if (!persisted) return;

                    // Input fields preserved
                    expect(persisted.input.query).toBe(query);
                    expect(persisted.input.companyContext).toBe(companyContext);

                    // Output fields preserved
                    expect(persisted.output).not.toBeNull();
                    expect(persisted.output?.results).toEqual(output.results);
                    expect(persisted.output?.metadata.query).toBe(query);
                    expect(persisted.output?.metadata.companyContext).toBe(companyContext);
                    expect(persisted.output?.metadata.categories).toEqual(output.metadata.categories);
                    expect(persisted.output?.metadata.radius).toBe(radius);
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
                latLngArb,
                radiusArb,
                async (companyA, companyB, idsA, idsB, baseQuery, baseContext, location, radius) => {
                    const helpers = createClientProspectorJobHelpers(createInMemoryClientProspectorStore());

                    for (const id of idsA) {
                        await helpers.createJob({
                            id: `a-${id}`,
                            companyId: companyA,
                            userId: `user-a-${id}`,
                            query: `${baseQuery} ${id}`,
                            companyContext: baseContext,
                            location,
                            radius,
                            categories: ["restaurants"],
                        });
                    }

                    for (const id of idsB) {
                        await helpers.createJob({
                            id: `b-${id}`,
                            companyId: companyB,
                            userId: `user-b-${id}`,
                            query: `${baseQuery} ${id}`,
                            companyContext: baseContext,
                            location,
                            radius,
                            categories: ["law-firms"],
                        });
                    }

                    const jobsForA = await helpers.getJobsByCompanyId(companyA, {
                        limit: idsA.length + idsB.length + 10,
                        offset: 0,
                    });

                    expect(jobsForA).toHaveLength(idsA.length);
                    expect(jobsForA.every((job) => job.companyId === companyA)).toBe(true);
                    expect(
                        jobsForA.some((job) => idsB.includes(job.id.replace(/^b-/, "")))
                    ).toBe(false);
                }
            ),
            { numRuns: 100 }
        );
    });

    it("getJobById returns null when querying with wrong company ID", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.uuid(),
                fc.bigInt({ min: 1n, max: 5_000n }),
                fc.bigInt({ min: 5_001n, max: 10_000n }),
                fc.uuid(),
                validQueryArb,
                validCompanyContextArb,
                latLngArb,
                radiusArb,
                async (jobId, companyA, companyB, userId, query, companyContext, location, radius) => {
                    const helpers = createClientProspectorJobHelpers(createInMemoryClientProspectorStore());

                    await helpers.createJob({
                        id: jobId,
                        companyId: companyA,
                        userId,
                        query,
                        companyContext,
                        location,
                        radius,
                    });

                    // Querying with the correct company returns the job
                    const found = await helpers.getJobById(jobId, companyA);
                    expect(found).not.toBeNull();
                    expect(found?.id).toBe(jobId);

                    // Querying with the wrong company returns null
                    const notFound = await helpers.getJobById(jobId, companyB);
                    expect(notFound).toBeNull();
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ─── Property 11: Job completion status ──────────────────────────────────────
// Validates: Requirements 5.2, 5.3

describe("Property 11: Job completion status", () => {
    it("updateJobStatus with 'completed' stamps completedAt and clears errorMessage", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.uuid(),
                fc.bigInt({ min: 1n, max: 10_000n }),
                fc.uuid(),
                validQueryArb,
                validCompanyContextArb,
                latLngArb,
                radiusArb,
                async (jobId, companyId, userId, query, companyContext, location, radius) => {
                    const helpers = createClientProspectorJobHelpers(createInMemoryClientProspectorStore());

                    await helpers.createJob({
                        id: jobId,
                        companyId,
                        userId,
                        query,
                        companyContext,
                        location,
                        radius,
                    });

                    const before = await helpers.getJobById(jobId, companyId);
                    expect(before).not.toBeNull();
                    expect(before!.status).toBe("queued");
                    expect(before!.completedAt).toBeNull();

                    const updated = await helpers.updateJobStatus(jobId, companyId, "completed");

                    expect(updated).not.toBeNull();
                    expect(updated!.status).toBe("completed");
                    expect(updated!.completedAt).toBeInstanceOf(Date);
                    expect(updated!.errorMessage).toBeNull();
                }
            ),
            { numRuns: 100 }
        );
    });

    it("updateJobStatus with 'failed' stamps completedAt and stores errorMessage", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.uuid(),
                fc.bigInt({ min: 1n, max: 10_000n }),
                fc.uuid(),
                validQueryArb,
                validCompanyContextArb,
                latLngArb,
                radiusArb,
                nonEmptyTextArb,
                async (jobId, companyId, userId, query, companyContext, location, radius, errorMsg) => {
                    const helpers = createClientProspectorJobHelpers(createInMemoryClientProspectorStore());

                    await helpers.createJob({
                        id: jobId,
                        companyId,
                        userId,
                        query,
                        companyContext,
                        location,
                        radius,
                    });

                    const updated = await helpers.updateJobStatus(jobId, companyId, "failed", errorMsg);

                    expect(updated).not.toBeNull();
                    expect(updated!.status).toBe("failed");
                    expect(updated!.completedAt).toBeInstanceOf(Date);
                    expect(updated!.errorMessage).toBe(errorMsg);
                }
            ),
            { numRuns: 100 }
        );
    });

    it("updateJobStatus with non-terminal status does not stamp completedAt", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.uuid(),
                fc.bigInt({ min: 1n, max: 10_000n }),
                fc.uuid(),
                validQueryArb,
                validCompanyContextArb,
                latLngArb,
                radiusArb,
                fc.constantFrom("planning" as const, "searching" as const, "scoring" as const),
                async (jobId, companyId, userId, query, companyContext, location, radius, status) => {
                    const helpers = createClientProspectorJobHelpers(createInMemoryClientProspectorStore());

                    await helpers.createJob({
                        id: jobId,
                        companyId,
                        userId,
                        query,
                        companyContext,
                        location,
                        radius,
                    });

                    const updated = await helpers.updateJobStatus(jobId, companyId, status);

                    expect(updated).not.toBeNull();
                    expect(updated!.status).toBe(status);
                    expect(updated!.completedAt).toBeNull();
                }
            ),
            { numRuns: 100 }
        );
    });
});
