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
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { clientProspectorJobs } from "../schema.js";
import type { LatLng, ProspectorJobRecord, ProspectorJobStatus, ProspectorOutput } from "./types.js";
type ClientProspectorJobRow = InferSelectModel<typeof clientProspectorJobs>;
type ClientProspectorJobInsert = InferInsertModel<typeof clientProspectorJobs>;
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
export interface GetJobsByCompanyIdOptions {
    limit?: number;
    offset?: number;
}
type ClientProspectorJobPatch = Partial<Pick<ClientProspectorJobRow, "status" | "categories" | "results" | "errorMessage" | "completedAt" | "updatedAt">>;
export interface ClientProspectorJobStore {
    insert(values: ClientProspectorJobInsert): Promise<ClientProspectorJobRow>;
    update(jobId: string, companyId: bigint, patch: ClientProspectorJobPatch): Promise<ClientProspectorJobRow | null>;
    findById(jobId: string, companyId: bigint): Promise<ClientProspectorJobRow | null>;
    findByCompanyId(companyId: bigint, options?: GetJobsByCompanyIdOptions): Promise<ClientProspectorJobRow[]>;
}
declare function mapRowToJobRecord(row: ClientProspectorJobRow): ProspectorJobRecord;
export declare function createDrizzleClientProspectorJobStore(): ClientProspectorJobStore;
export declare function createClientProspectorJobHelpers(store: ClientProspectorJobStore): {
    createJob(input: CreateClientProspectorJobInput): Promise<ProspectorJobRecord>;
    updateJobStatus(jobId: string, companyId: bigint, status: ProspectorJobStatus, errorMessage?: string): Promise<ProspectorJobRecord | null>;
    updateJobResults(jobId: string, companyId: bigint, output: ProspectorOutput): Promise<ProspectorJobRecord | null>;
    getJobById(jobId: string, companyId: bigint): Promise<ProspectorJobRecord | null>;
    getJobsByCompanyId(companyId: bigint, options?: GetJobsByCompanyIdOptions): Promise<ProspectorJobRecord[]>;
};
declare const defaultHelpers: {
    createJob(input: CreateClientProspectorJobInput): Promise<ProspectorJobRecord>;
    updateJobStatus(jobId: string, companyId: bigint, status: ProspectorJobStatus, errorMessage?: string): Promise<ProspectorJobRecord | null>;
    updateJobResults(jobId: string, companyId: bigint, output: ProspectorOutput): Promise<ProspectorJobRecord | null>;
    getJobById(jobId: string, companyId: bigint): Promise<ProspectorJobRecord | null>;
    getJobsByCompanyId(companyId: bigint, options?: GetJobsByCompanyIdOptions): Promise<ProspectorJobRecord[]>;
};
export declare const createJob: (...args: Parameters<typeof defaultHelpers.createJob>) => Promise<ProspectorJobRecord>;
export declare const updateJobStatus: (...args: Parameters<typeof defaultHelpers.updateJobStatus>) => Promise<ProspectorJobRecord | null>;
export declare const updateJobResults: (...args: Parameters<typeof defaultHelpers.updateJobResults>) => Promise<ProspectorJobRecord | null>;
export declare const getJobById: (...args: Parameters<typeof defaultHelpers.getJobById>) => Promise<ProspectorJobRecord | null>;
export declare const getJobsByCompanyId: (...args: Parameters<typeof defaultHelpers.getJobsByCompanyId>) => Promise<ProspectorJobRecord[]>;
export declare const __testOnly: {
    mapRowToJobRecord: typeof mapRowToJobRecord;
};
export {};
//# sourceMappingURL=db.d.ts.map