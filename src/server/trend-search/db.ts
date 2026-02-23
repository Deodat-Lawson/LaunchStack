import { and, desc, eq } from "drizzle-orm";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

import { db } from "~/server/db";
import { trendSearchJobs } from "~/server/db/schema";
import type {
    SearchCategory,
    TrendSearchJobRecord,
    TrendSearchJobStatus,
    TrendSearchOutput,
} from "~/server/trend-search/types";

type TrendSearchJobRow = InferSelectModel<typeof trendSearchJobs>;
type TrendSearchJobInsert = InferInsertModel<typeof trendSearchJobs>;

export interface CreateTrendSearchJobInput {
    id: string;
    companyId: bigint;
    userId: string;
    query: string;
    companyContext: string;
    categories?: SearchCategory[];
    status?: TrendSearchJobStatus;
}

export interface GetJobsByCompanyIdOptions {
    limit?: number;
    offset?: number;
}

type TrendSearchJobPatch = Partial<
    Pick<
        TrendSearchJobRow,
        "status" | "categories" | "results" | "errorMessage" | "completedAt" | "updatedAt"
    >
>;

export interface TrendSearchJobStore {
    insert(values: TrendSearchJobInsert): Promise<TrendSearchJobRow>;
    update(jobId: string, companyId: bigint, patch: TrendSearchJobPatch): Promise<TrendSearchJobRow | null>;
    findById(jobId: string, companyId: bigint): Promise<TrendSearchJobRow | null>;
    findByCompanyId(
        companyId: bigint,
        options?: GetJobsByCompanyIdOptions
    ): Promise<TrendSearchJobRow[]>;
}

function mapRowToJobRecord(row: TrendSearchJobRow): TrendSearchJobRecord {
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

export function createDrizzleTrendSearchJobStore(): TrendSearchJobStore {
    return {
        async insert(values) {
            const [row] = await db.insert(trendSearchJobs).values(values).returning();
            if (!row) {
                throw new Error("Failed to create trend search job");
            }
            return row;
        },
        async update(jobId, companyId, patch) {
            const [row] = await db
                .update(trendSearchJobs)
                .set({
                    ...patch,
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(trendSearchJobs.id, jobId),
                        eq(trendSearchJobs.companyId, companyId)
                    )
                )
                .returning();

            return row ?? null;
        },
        async findById(jobId, companyId) {
            const [row] = await db
                .select()
                .from(trendSearchJobs)
                .where(
                    and(
                        eq(trendSearchJobs.id, jobId),
                        eq(trendSearchJobs.companyId, companyId)
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
                .from(trendSearchJobs)
                .where(eq(trendSearchJobs.companyId, companyId))
                .orderBy(desc(trendSearchJobs.createdAt))
                .limit(limit)
                .offset(offset);
        },
    };
}

export function createTrendSearchJobHelpers(store: TrendSearchJobStore) {
    return {
        async createJob(input: CreateTrendSearchJobInput): Promise<TrendSearchJobRecord> {
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

        async updateJobStatus(
            jobId: string,
            companyId: bigint,
            status: TrendSearchJobStatus,
            errorMessage?: string
        ): Promise<TrendSearchJobRecord | null> {
            const patch: TrendSearchJobPatch = {
                status,
            };

            // Terminal states can stamp completion time for polling UIs.
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

        async updateJobResults(
            jobId: string,
            companyId: bigint,
            output: TrendSearchOutput
        ): Promise<TrendSearchJobRecord | null> {
            const row = await store.update(jobId, companyId, {
                results: output.results,
                categories: output.metadata.categories,
                errorMessage: null,
            });
            return row ? mapRowToJobRecord(row) : null;
        },

        async getJobById(jobId: string, companyId: bigint): Promise<TrendSearchJobRecord | null> {
            const row = await store.findById(jobId, companyId);
            return row ? mapRowToJobRecord(row) : null;
        },

        async getJobsByCompanyId(
            companyId: bigint,
            options?: GetJobsByCompanyIdOptions
        ): Promise<TrendSearchJobRecord[]> {
            const rows = await store.findByCompanyId(companyId, options);
            return rows.map(mapRowToJobRecord);
        },
    };
}

const defaultStore = createDrizzleTrendSearchJobStore();
const defaultHelpers = createTrendSearchJobHelpers(defaultStore);

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
