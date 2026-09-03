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
import { getDb } from "@launchstack/store/client";
import { clientProspectorJobs } from "../schema.js";
// ─── Row → Record mapper ─────────────────────────────────────────────────────
// Transforms a raw database row into a clean ProspectorJobRecord.
// The main differences:
//   - location is reconstructed from separate lat/lng columns into { lat, lng }
//   - input fields are grouped into an input object
//   - results + metadata are grouped into an output object (null if incomplete)
function mapRowToJobRecord(row) {
    const categories = row.categories ?? undefined;
    const results = row.results;
    return {
        id: row.id,
        companyId: row.companyId,
        userId: row.userId,
        status: row.status,
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
export function createDrizzleClientProspectorJobStore() {
    return {
        async insert(values) {
            const db = getDb();
            const [row] = await db.insert(clientProspectorJobs).values(values).returning();
            if (!row) {
                throw new Error("Failed to create client prospector job");
            }
            return row;
        },
        async update(jobId, companyId, patch) {
            const db = getDb();
            const [row] = await db
                .update(clientProspectorJobs)
                .set(patch)
                .where(and(eq(clientProspectorJobs.id, jobId), eq(clientProspectorJobs.companyId, companyId)))
                .returning();
            return row ?? null;
        },
        async findById(jobId, companyId) {
            const db = getDb();
            const [row] = await db
                .select()
                .from(clientProspectorJobs)
                .where(and(eq(clientProspectorJobs.id, jobId), eq(clientProspectorJobs.companyId, companyId)))
                .limit(1);
            return row ?? null;
        },
        async findByCompanyId(companyId, options = {}) {
            const limit = options.limit ?? 100;
            const offset = options.offset ?? 0;
            const db = getDb();
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
export function createClientProspectorJobHelpers(store) {
    return {
        // Create a new job record in "queued" status.
        // Called by the POST /api/client-prospector route.
        async createJob(input) {
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
        async updateJobStatus(jobId, companyId, status, errorMessage) {
            const patch = {
                status,
            };
            if (status === "completed" || status === "failed") {
                patch.completedAt = new Date();
            }
            if (errorMessage !== undefined) {
                patch.errorMessage = errorMessage;
            }
            else if (status === "completed") {
                patch.errorMessage = null;
            }
            const row = await store.update(jobId, companyId, patch);
            return row ? mapRowToJobRecord(row) : null;
        },
        // Persist the pipeline results and update categories.
        // Called by the Inngest function after the pipeline completes.
        async updateJobResults(jobId, companyId, output) {
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
        async getJobById(jobId, companyId) {
            const row = await store.findById(jobId, companyId);
            return row ? mapRowToJobRecord(row) : null;
        },
        // List all jobs for a company, ordered by most recent first.
        // Supports pagination via limit/offset.
        async getJobsByCompanyId(companyId, options) {
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
export const createJob = (...args) => defaultHelpers.createJob(...args);
export const updateJobStatus = (...args) => defaultHelpers.updateJobStatus(...args);
export const updateJobResults = (...args) => defaultHelpers.updateJobResults(...args);
export const getJobById = (...args) => defaultHelpers.getJobById(...args);
export const getJobsByCompanyId = (...args) => defaultHelpers.getJobsByCompanyId(...args);
export const __testOnly = {
    mapRowToJobRecord,
};
//# sourceMappingURL=db.js.map