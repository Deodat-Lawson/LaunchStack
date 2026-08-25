import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@launchstack/store/client";
import { trendSearchJobs } from "../schema.js";
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
            ...(categories !== undefined ? { categories } : {}),
        },
        output: results
            ? {
                results,
                metadata: {
                    query: row.query,
                    companyContext: row.companyContext,
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
export function createDrizzleTrendSearchJobStore() {
    return {
        async insert(values) {
            const db = getDb();
            const [row] = await db.insert(trendSearchJobs).values(values).returning();
            if (!row) {
                throw new Error("Failed to create trend search job");
            }
            return row;
        },
        async update(jobId, companyId, patch) {
            const db = getDb();
            const [row] = await db
                .update(trendSearchJobs)
                .set({
                ...patch,
                updatedAt: new Date(),
            })
                .where(and(eq(trendSearchJobs.id, jobId), eq(trendSearchJobs.companyId, companyId)))
                .returning();
            return row ?? null;
        },
        async findById(jobId, companyId) {
            const db = getDb();
            const [row] = await db
                .select()
                .from(trendSearchJobs)
                .where(and(eq(trendSearchJobs.id, jobId), eq(trendSearchJobs.companyId, companyId)))
                .limit(1);
            return row ?? null;
        },
        async findByCompanyId(companyId, options = {}) {
            const limit = options.limit ?? 100;
            const offset = options.offset ?? 0;
            const db = getDb();
            return await db
                .select()
                .from(trendSearchJobs)
                .where(eq(trendSearchJobs.companyId, companyId))
                .orderBy(desc(trendSearchJobs.createdAt))
                .limit(limit)
                .offset(offset);
        },
    };
}
export function createTrendSearchJobHelpers(store) {
    return {
        async createJob(input) {
            const row = await store.insert({
                id: input.id,
                companyId: input.companyId,
                userId: input.userId,
                status: input.status ?? "queued",
                query: input.query,
                companyContext: input.companyContext,
                categories: input.categories,
            });
            return mapRowToJobRecord(row);
        },
        async updateJobStatus(jobId, companyId, status, errorMessage) {
            const patch = {
                status,
            };
            // Terminal states can stamp completion time for polling UIs.
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
        async updateJobResults(jobId, companyId, output) {
            const row = await store.update(jobId, companyId, {
                results: output.results,
                categories: output.metadata.categories,
                errorMessage: null,
            });
            return row ? mapRowToJobRecord(row) : null;
        },
        async getJobById(jobId, companyId) {
            const row = await store.findById(jobId, companyId);
            return row ? mapRowToJobRecord(row) : null;
        },
        async getJobsByCompanyId(companyId, options) {
            const rows = await store.findByCompanyId(companyId, options);
            return rows.map(mapRowToJobRecord);
        },
    };
}
const defaultStore = createDrizzleTrendSearchJobStore();
const defaultHelpers = createTrendSearchJobHelpers(defaultStore);
export const createJob = (...args) => defaultHelpers.createJob(...args);
export const updateJobStatus = (...args) => defaultHelpers.updateJobStatus(...args);
export const updateJobResults = (...args) => defaultHelpers.updateJobResults(...args);
export const getJobById = (...args) => defaultHelpers.getJobById(...args);
export const getJobsByCompanyId = (...args) => defaultHelpers.getJobsByCompanyId(...args);
export const __testOnly = {
    mapRowToJobRecord,
};
//# sourceMappingURL=db.js.map