/**
 * Persistence helpers for Client Prospector jobs.
 *
 * This module mirrors the pattern from src/lib/tools/trend-search/db.ts.
 * It provides:
 *   1. A ClientProspectorJobStore interface — an abstract storage layer
 *      that can be backed by Drizzle (production) or an in-memory Map (tests).
 *   2. A createClientProspectorJobHelpers() factory that wraps the store
 *      with domain-specific helper methods (createJob, updateJobStatus, etc.).
 *   3. Default exports that use the real Drizzle store for production use.
 *
 * The helpers transform raw DB rows into ProspectorJobRecord objects
 * (defined in types.ts) which have a cleaner shape for the rest of the app.
 */

import { and, desc, eq } from "drizzle-orm";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

import { db } from "~/server/db";
import { clientProspectorJobs } from "@launchstack/core/db/schema";
import type {
    LatLng,
    ProspectorJobRecord,
    ProspectorJobStatus,
    ProspectorOutput,
} from "~/lib/tools/client-prospector/types";

// ─── Row types derived from the Drizzle schema ──────────────────────────────
// These represent the raw shape of data as it sits in PostgreSQL.
type ClientProspectorJobRow = InferSelectModel<typeof clientProspectorJobs>;
type ClientProspectorJobInsert = InferInsertModel<typeof clientProspectorJobs>;

// ─── Input type for creating a new job ───────────────────────────────────────
export interface CreateClientProspectorJobInput {
    id: string;
    companyId: bigint;
    userId: string;
    query: string;
    companyContext: string;
    location: LatLng;
    radius: number;
    categories?: string[];
    status?: ProspectorJobStatus;
}

// ─── Pagination options for listing jobs ─────────────────────────────────────
export interface GetJobsByCompanyIdOptions {
    limit?: number;
    offset?: number;
}

// ─── Patch type for partial updates ──────────────────────────────────────────
// Only these columns can be updated after creation.
type ClientProspectorJobPatch = Partial<
    Pick<
        ClientProspectorJobRow,
        "status" | "categories" | "results" | "errorMessage" | "completedAt" | "updatedAt"
    >
>;

// ─── Store interface ─────────────────────────────────────────────────────────
// This abstraction lets us swap in an in-memory store for tests while using
// the real Drizzle store in production. Both implement the same 4 methods.
export interface ClientProspectorJobStore {
    insert(values: ClientProspectorJobInsert): Promise<ClientProspectorJobRow>;
    update(
        jobId: string,
        companyId: bigint,
        patch: ClientProspectorJobPatch
    ): Promise<ClientProspectorJobRow | null>;
    findById(jobId: string, companyId: bigint): Promise<ClientProspectorJobRow | null>;
    findByCompanyId(
        companyId: bigint,
        options?: GetJobsByCompanyIdOptions
    ): Promise<ClientProspectorJobRow[]>;
}

// ─── Row → Record mapper ─────────────────────────────────────────────────────
// Transforms a raw database row into a clean ProspectorJobRecord.
// The main differences:
//   - location is reconstructed from separate lat/lng columns into { lat, lng }
//   - input fields are grouped into an input object
//   - results + metadata are grouped into an output object (null if incomplete)
function mapRowToJobRecord(row: ClientProspectorJobRow): ProspectorJobRecord {
    const categories = row.categories ?? undefined;
    const results = row.results;

    return {
        id: row.id,
        companyId: row.companyId,
        userId: row.userId,
        status: row.status as ProspectorJobStatus,
        input: {
            query: row.query,
            companyContext: row.companyContext,
            location: { lat: row.locationLat, lng: row.locationLng },
            ...(row.radius !== 5000 ? { radius: row.radius } : {}),
            ...(categories !== undefined ? { categories } : {}),
        },
        output: results
            ? {
                  results,
                  metadata: {
                      query: row.query,
                      companyContext: row.companyContext,
                      location: { lat: row.locationLat, lng: row.locationLng },
                      radius: row.radius,
                      categories: row.categories ?? [],
                      createdAt: (row.completedAt ?? row.createdAt).toISOString(),
                  },
              }
            : null,
        errorMessage: row.errorMessage ?? null,
        createdAt: row.createdAt,
        completedAt: row.completedAt ?? null,
    };
}

// ─── Drizzle store (production) ──────────────────────────────────────────────
// This is the real store that talks to PostgreSQL via Drizzle ORM.
export function createDrizzleClientProspectorJobStore(): ClientProspectorJobStore {
    return {
        async insert(values) {
            const [row] = await db.insert(clientProspectorJobs).values(values).returning();
            if (!row) {
                throw new Error("Failed to create client prospector job");
            }
            return row;
        },
        async update(jobId, companyId, patch) {
            const [row] = await db
                .update(clientProspectorJobs)
                .set(patch)
                .where(
                    and(
                        eq(clientProspectorJobs.id, jobId),
                        eq(clientProspectorJobs.companyId, companyId)
                    )
                )
                .returning();

            return row ?? null;
        },
        async findById(jobId, companyId) {
            const [row] = await db
                .select()
                .from(clientProspectorJobs)
                .where(
                    and(
                        eq(clientProspectorJobs.id, jobId),
                        eq(clientProspectorJobs.companyId, companyId)
                    )
                )
                .limit(1);

            return row ?? null;
        },
        async findByCompanyId(companyId, options = {}) {
            const limit = options.limit ?? 100;
            const offset = options.offset ?? 0;

            return await db
                .select()
                .from(clientProspectorJobs)
                .where(eq(clientProspectorJobs.companyId, companyId))
                .orderBy(desc(clientProspectorJobs.createdAt))
                .limit(limit)
                .offset(offset);
        },
    };
}

// ─── Helper factory ──────────────────────────────────────────────────────────
// Takes a store (real or in-memory) and returns domain-specific helpers.
// These are the functions the rest of the app uses — they handle the
// mapping between raw rows and clean ProspectorJobRecord objects.
export function createClientProspectorJobHelpers(store: ClientProspectorJobStore) {
    return {
        // Create a new job record in "queued" status.
        // Called by the POST /api/client-prospector route.
        async createJob(input: CreateClientProspectorJobInput): Promise<ProspectorJobRecord> {
            const row = await store.insert({
                id: input.id,
                companyId: input.companyId,
                userId: input.userId,
                status: input.status ?? "queued",
                query: input.query,
                companyContext: input.companyContext,
                locationLat: input.location.lat,
                locationLng: input.location.lng,
                radius: input.radius,
                categories: input.categories,
            });
            return mapRowToJobRecord(row);
        },

        // Update the job's pipeline status. Terminal states ("completed", "failed")
        // automatically stamp the completedAt timestamp.
        // Called by the Inngest function as the pipeline progresses.
        async updateJobStatus(
            jobId: string,
            companyId: bigint,
            status: ProspectorJobStatus,
            errorMessage?: string
        ): Promise<ProspectorJobRecord | null> {
            const patch: ClientProspectorJobPatch = {
                status,
            };

            if (status === "completed" || status === "failed") {
                patch.completedAt = new Date();
            }

            if (errorMessage !== undefined) {
                patch.errorMessage = errorMessage;
            } else if (status === "completed") {
                patch.errorMessage = null;
            }

            const row = await store.update(jobId, companyId, patch);
            return row ? mapRowToJobRecord(row) : null;
        },

        // Persist the pipeline results and update categories.
        // Called by the Inngest function after the pipeline completes.
        async updateJobResults(
            jobId: string,
            companyId: bigint,
            output: ProspectorOutput
        ): Promise<ProspectorJobRecord | null> {
            const row = await store.update(jobId, companyId, {
                results: output.results,
                categories: output.metadata.categories,
                errorMessage: null,
            });
            return row ? mapRowToJobRecord(row) : null;
        },

        // Retrieve a single job by ID, scoped to a company.
        // Returns null if the job doesn't exist OR belongs to a different company.
        // This is how we enforce company data isolation.
        async getJobById(
            jobId: string,
            companyId: bigint
        ): Promise<ProspectorJobRecord | null> {
            const row = await store.findById(jobId, companyId);
            return row ? mapRowToJobRecord(row) : null;
        },

        // List all jobs for a company, ordered by most recent first.
        // Supports pagination via limit/offset.
        async getJobsByCompanyId(
            companyId: bigint,
            options?: GetJobsByCompanyIdOptions
        ): Promise<ProspectorJobRecord[]> {
            const rows = await store.findByCompanyId(companyId, options);
            return rows.map(mapRowToJobRecord);
        },
    };
}

// ─── Default exports (production) ────────────────────────────────────────────
// These use the real Drizzle store. Import these in API routes and Inngest
// functions for production use. For tests, use createClientProspectorJobHelpers()
// with an in-memory store instead.
const defaultStore = createDrizzleClientProspectorJobStore();
const defaultHelpers = createClientProspectorJobHelpers(defaultStore);

export const createJob = (...args: Parameters<typeof defaultHelpers.createJob>) =>
    defaultHelpers.createJob(...args);

export const updateJobStatus = (...args: Parameters<typeof defaultHelpers.updateJobStatus>) =>
    defaultHelpers.updateJobStatus(...args);

export const updateJobResults = (...args: Parameters<typeof defaultHelpers.updateJobResults>) =>
    defaultHelpers.updateJobResults(...args);

export const getJobById = (...args: Parameters<typeof defaultHelpers.getJobById>) =>
    defaultHelpers.getJobById(...args);

export const getJobsByCompanyId = (
    ...args: Parameters<typeof defaultHelpers.getJobsByCompanyId>
) => defaultHelpers.getJobsByCompanyId(...args);

export const __testOnly = {
    mapRowToJobRecord,
};
