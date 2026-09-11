import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { trendSearchJobs } from "../schema.js";
import type { SearchCategory, TrendSearchJobRecord, TrendSearchJobStatus, TrendSearchOutput } from "./types.js";
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
type TrendSearchJobPatch = Partial<Pick<TrendSearchJobRow, "status" | "categories" | "results" | "errorMessage" | "completedAt" | "updatedAt">>;
export interface TrendSearchJobStore {
    insert(values: TrendSearchJobInsert): Promise<TrendSearchJobRow>;
    update(jobId: string, companyId: bigint, patch: TrendSearchJobPatch): Promise<TrendSearchJobRow | null>;
    findById(jobId: string, companyId: bigint): Promise<TrendSearchJobRow | null>;
    findByCompanyId(companyId: bigint, options?: GetJobsByCompanyIdOptions): Promise<TrendSearchJobRow[]>;
}
declare function mapRowToJobRecord(row: TrendSearchJobRow): TrendSearchJobRecord;
export declare function createDrizzleTrendSearchJobStore(): TrendSearchJobStore;
export declare function createTrendSearchJobHelpers(store: TrendSearchJobStore): {
    createJob(input: CreateTrendSearchJobInput): Promise<TrendSearchJobRecord>;
    updateJobStatus(jobId: string, companyId: bigint, status: TrendSearchJobStatus, errorMessage?: string): Promise<TrendSearchJobRecord | null>;
    updateJobResults(jobId: string, companyId: bigint, output: TrendSearchOutput): Promise<TrendSearchJobRecord | null>;
    getJobById(jobId: string, companyId: bigint): Promise<TrendSearchJobRecord | null>;
    getJobsByCompanyId(companyId: bigint, options?: GetJobsByCompanyIdOptions): Promise<TrendSearchJobRecord[]>;
};
declare const defaultHelpers: {
    createJob(input: CreateTrendSearchJobInput): Promise<TrendSearchJobRecord>;
    updateJobStatus(jobId: string, companyId: bigint, status: TrendSearchJobStatus, errorMessage?: string): Promise<TrendSearchJobRecord | null>;
    updateJobResults(jobId: string, companyId: bigint, output: TrendSearchOutput): Promise<TrendSearchJobRecord | null>;
    getJobById(jobId: string, companyId: bigint): Promise<TrendSearchJobRecord | null>;
    getJobsByCompanyId(companyId: bigint, options?: GetJobsByCompanyIdOptions): Promise<TrendSearchJobRecord[]>;
};
export declare const createJob: (...args: Parameters<typeof defaultHelpers.createJob>) => Promise<TrendSearchJobRecord>;
export declare const updateJobStatus: (...args: Parameters<typeof defaultHelpers.updateJobStatus>) => Promise<TrendSearchJobRecord | null>;
export declare const updateJobResults: (...args: Parameters<typeof defaultHelpers.updateJobResults>) => Promise<TrendSearchJobRecord | null>;
export declare const getJobById: (...args: Parameters<typeof defaultHelpers.getJobById>) => Promise<TrendSearchJobRecord | null>;
export declare const getJobsByCompanyId: (...args: Parameters<typeof defaultHelpers.getJobsByCompanyId>) => Promise<TrendSearchJobRecord[]>;
export declare const __testOnly: {
    mapRowToJobRecord: typeof mapRowToJobRecord;
};
export {};
//# sourceMappingURL=db.d.ts.map