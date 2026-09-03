/**
 * Host wiring for the repo-workspace vertical (design §3, stages A–D): the
 * concrete git port, filesystem layout, credential resolution, and sync
 * dependencies the worker's Inngest functions run with. The pipeline package
 * stays port-based; this module is where the ports meet the machine.
 */

import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import {
    createDirectoryView,
    createGitPort,
    deriveContextBundle,
    type GitPort,
    type RepoCredentialResolver,
    type SyncDeps,
    type SyncPaths,
} from "@launchstack/pipelines/repo-workspace";
import {
    claimPendingSyncRequest,
    finishSyncRequest,
    getContextBundle,
    markPublishedJobsStale,
    pruneContextBundles,
    saveContextBundle,
    updateWorkspaceSyncState,
} from "@launchstack/pipelines/repo-workspace/db";

/**
 * Mirrors and worktrees live on the worker volume. The tmpdir fallback keeps
 * dev environments working with zero configuration; production sets
 * REPO_WORKSPACE_DIR to a persistent mount.
 */
export function repoWorkspaceBaseDir(): string {
    return process.env.REPO_WORKSPACE_DIR ?? path.join(os.tmpdir(), "launchstack-repo-workspaces");
}

export const repoWorkspacePaths: SyncPaths = {
    mirrorPath: workspace =>
        path.join(
            repoWorkspaceBaseDir(),
            "mirrors",
            String(workspace.companyId),
            `${workspace.id}.git`
        ),
    worktreePath: (workspace, sha) =>
        path.join(repoWorkspaceBaseDir(), "worktrees", workspace.id, sha),
};

/**
 * Sync credentials. The workspace-scoped GitHub connection (PR #363) slots
 * in here once it lands; until then the operator token in the environment
 * covers private repos, and public repos need none.
 */
export const resolveRepoCredentials: RepoCredentialResolver = () =>
    Promise.resolve(process.env.GITHUB_TOKEN ?? null);

export const repoWorkspaceGit: GitPort = createGitPort();

export function makeRepoSyncDeps(): SyncDeps {
    return {
        git: repoWorkspaceGit,
        credentials: resolveRepoCredentials,
        paths: repoWorkspacePaths,
        store: {
            claimPendingSyncRequest,
            finishSyncRequest,
            updateWorkspaceSyncState,
            getContextBundle,
            saveContextBundle,
            markPublishedJobsStale,
            pruneContextBundles,
        },
        makeView: createDirectoryView,
        derive: view => deriveContextBundle(view),
    };
}

/** Best-effort removal of a disconnected workspace's disk state. */
export async function removeWorkspaceDiskState(workspace: {
    id: string;
    companyId: bigint;
}): Promise<void> {
    const mirror = repoWorkspacePaths.mirrorPath(workspace);
    const worktrees = path.join(repoWorkspaceBaseDir(), "worktrees", workspace.id);
    await fs.rm(mirror, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(worktrees, { recursive: true, force: true }).catch(() => undefined);
}
