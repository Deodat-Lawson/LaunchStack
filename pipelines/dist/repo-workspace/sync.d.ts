/**
 * One workspace sync run — stage B of the pipe (design §3.2), wired from
 * ports so every branch is testable without git, a database, or a network.
 *
 * Shape: claim the workspace's pending request → ensure/fetch the mirror →
 * record the new head → derive the context bundle when the head is new →
 * mark published explanations stale → finish the request. Failures are
 * persisted and *returned*, not thrown: the request row is terminal either
 * way, and recovery is the next webhook or poll creating a fresh request —
 * not an Inngest retry replaying a claimed one.
 */
import type { RepoContextBundleRow, RepoSyncRequestRow, RepoWorkspaceRow } from "./schema.js";
import type { ContextBundle, GitPort, RepoCredentialResolver, WorkspaceView } from "./types.js";
export interface SyncPaths {
    mirrorPath(workspace: Pick<RepoWorkspaceRow, "id" | "companyId">): string;
    worktreePath(workspace: Pick<RepoWorkspaceRow, "id">, sha: string): string;
}
export interface SyncStore {
    claimPendingSyncRequest(workspaceId: string, claimId: string): Promise<RepoSyncRequestRow | null>;
    finishSyncRequest(requestId: string, claimId: string, outcome: {
        ok: true;
    } | {
        ok: false;
        errorMessage: string;
    }): Promise<boolean>;
    updateWorkspaceSyncState(workspaceId: string, patch: {
        status?: "pending" | "active" | "error" | "disconnected";
        headSha?: string;
        mirrorPath?: string;
        diskBytes?: number;
        lastSyncedAt?: Date;
        lastErrorMessage?: string | null;
    }): Promise<unknown>;
    getContextBundle(workspaceId: string, sha: string): Promise<RepoContextBundleRow | null>;
    saveContextBundle(workspaceId: string, bundle: ContextBundle, computeMs: number): Promise<unknown>;
    markPublishedJobsStale(workspaceId: string, newSha: string): Promise<number>;
    pruneContextBundles(workspaceId: string, keep: number): Promise<number>;
}
export interface SyncDeps {
    git: GitPort;
    credentials: RepoCredentialResolver;
    paths: SyncPaths;
    store: SyncStore;
    makeView(worktreeDir: string, sha: string): WorkspaceView;
    derive(view: WorkspaceView): Promise<ContextBundle>;
    now?(): Date;
}
export type SyncOutcome = {
    status: "skipped";
    reason: "no_pending_request" | "workspace_disconnected";
} | {
    status: "synced";
    headSha: string;
    advanced: boolean;
    nonFastForward: boolean;
    derived: boolean;
    staleMarked: number;
} | {
    status: "failed";
    errorMessage: string;
};
export declare function runWorkspaceSync(deps: SyncDeps, workspace: RepoWorkspaceRow): Promise<SyncOutcome>;
//# sourceMappingURL=sync.d.ts.map