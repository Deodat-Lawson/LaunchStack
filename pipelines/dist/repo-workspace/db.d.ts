/**
 * Repo-workspace persistence. Every worker-side mutation is a conditional
 * update gated on status (and claim id where a claim exists), so a racing
 * duplicate delivery gets `null` back instead of clobbering state — the
 * founder-weekly-review claim discipline, applied to sync and jobs.
 */
import type { RepoContextBundleRow, RepoExplanationJobResult, RepoExplainerJobRow, RepoSyncRequestRow, RepoWorkspaceRow } from "./schema.js";
import type { ContextBundle, RepoRef, RepoWorkspaceStatus, SyncReason, WorkspaceDiagramType } from "./types.js";
export interface CreateWorkspaceInput {
    id?: string;
    companyId: bigint;
    createdByUserId: string;
    ref: RepoRef;
}
export interface CreateWorkspaceResult {
    created: boolean;
    workspace: RepoWorkspaceRow;
}
export declare function createRepoWorkspace(input: CreateWorkspaceInput): Promise<CreateWorkspaceResult>;
export declare function getRepoWorkspace(workspaceId: string, companyId?: bigint): Promise<RepoWorkspaceRow | null>;
export declare function listRepoWorkspaces(companyId: bigint): Promise<RepoWorkspaceRow[]>;
/** Every workspace with the given repo identity, across companies — how a
 * webhook delivery fans out to the workspaces that mirror that repo. */
export declare function findWorkspacesByRepo(ref: RepoRef): Promise<RepoWorkspaceRow[]>;
export interface WorkspaceSyncPatch {
    status?: RepoWorkspaceStatus;
    headSha?: string;
    mirrorPath?: string;
    diskBytes?: number;
    lastSyncedAt?: Date;
    lastErrorMessage?: string | null;
}
export declare function updateWorkspaceSyncState(workspaceId: string, patch: WorkspaceSyncPatch): Promise<RepoWorkspaceRow | null>;
export declare function deleteRepoWorkspace(workspaceId: string, companyId: bigint): Promise<RepoWorkspaceRow | null>;
/** Active workspaces whose last sync is older than `olderThan` (or that have
 * never synced) — the poll reconciler's worklist. */
export declare function listWorkspacesDueForPoll(olderThan: Date, limit: number): Promise<RepoWorkspaceRow[]>;
export interface RequestSyncResult {
    /** False when a pending request already existed (the burst coalesced). */
    created: boolean;
    request: RepoSyncRequestRow;
}
export declare function requestSync(workspaceId: string, reason: SyncReason): Promise<RequestSyncResult>;
/** Claim the workspace's pending request. `null` means someone else owns it
 * or there is nothing to do — both are "stop", not errors. */
export declare function claimPendingSyncRequest(workspaceId: string, claimId: string): Promise<RepoSyncRequestRow | null>;
export declare function finishSyncRequest(requestId: string, claimId: string, outcome: {
    ok: true;
} | {
    ok: false;
    errorMessage: string;
}): Promise<boolean>;
export declare function saveContextBundle(workspaceId: string, bundle: ContextBundle, computeMs: number): Promise<RepoContextBundleRow>;
export declare function getContextBundle(workspaceId: string, sha: string): Promise<RepoContextBundleRow | null>;
/** Keep the newest `keep` bundles per workspace; prune the rest. */
export declare function pruneContextBundles(workspaceId: string, keep: number): Promise<number>;
export interface CreateExplainerJobInput {
    id?: string;
    companyId: bigint;
    workspaceId: string;
    userId: string;
    diagramType: WorkspaceDiagramType;
    instructions?: string;
}
export declare function createExplainerJob(input: CreateExplainerJobInput): Promise<RepoExplainerJobRow>;
export declare function getExplainerJob(jobId: string, companyId: bigint): Promise<RepoExplainerJobRow | null>;
export declare function listExplainerJobs(companyId: bigint, options?: {
    limit?: number;
    offset?: number;
}): Promise<RepoExplainerJobRow[]>;
/** queued → running, stamping the commit the run will explain. */
export declare function claimExplainerJob(jobId: string, claimId: string, sha: string): Promise<RepoExplainerJobRow | null>;
export declare function completeExplainerJob(jobId: string, claimId: string, result: RepoExplanationJobResult): Promise<boolean>;
/** Terminal failure. Without a claim id (Inngest onFailure after retries are
 * exhausted) any non-completed status may transition. */
export declare function failExplainerJob(jobId: string, claimId: string | null, errorMessage: string): Promise<boolean>;
export declare function markJobPublished(jobId: string, companyId: bigint, publishedDocumentId: bigint): Promise<RepoExplainerJobRow | null>;
/** Design §3.5: a new head makes published explanations of older commits
 * stale. Returns how many were marked. */
export declare function markPublishedJobsStale(workspaceId: string, newSha: string): Promise<number>;
//# sourceMappingURL=db.d.ts.map