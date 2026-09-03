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
import { randomUUID } from "node:crypto";
import { repoFullName } from "./types.js";
import { githubRemoteUrl } from "./git.js";
const BUNDLES_TO_KEEP = 5;
export async function runWorkspaceSync(deps, workspace) {
    if (workspace.status === "disconnected") {
        return { status: "skipped", reason: "workspace_disconnected" };
    }
    const claimId = randomUUID();
    const request = await deps.store.claimPendingSyncRequest(workspace.id, claimId);
    if (!request)
        return { status: "skipped", reason: "no_pending_request" };
    const ref = {
        provider: workspace.provider,
        owner: workspace.owner,
        repo: workspace.repo,
    };
    const mirrorPath = deps.paths.mirrorPath(workspace);
    try {
        const token = await deps.credentials(ref);
        await deps.git.ensureMirror({
            remoteUrl: githubRemoteUrl(ref.owner, ref.repo),
            mirrorPath,
            token,
        });
        const fetch = await deps.git.fetchMirror({ mirrorPath, token });
        const diskBytes = await deps.git.mirrorSizeBytes(mirrorPath);
        await deps.store.updateWorkspaceSyncState(workspace.id, {
            status: "active",
            headSha: fetch.headSha,
            mirrorPath,
            diskBytes,
            lastSyncedAt: deps.now?.() ?? new Date(),
            lastErrorMessage: null,
        });
        // Derive when the head is new to us — which includes the very first
        // sync and a redelivery that crashed between fetch and save.
        let derived = false;
        const existing = await deps.store.getContextBundle(workspace.id, fetch.headSha);
        if (!existing) {
            const worktreePath = deps.paths.worktreePath(workspace, fetch.headSha);
            await deps.git.addWorktree({
                mirrorPath,
                sha: fetch.headSha,
                worktreePath,
                token,
            });
            try {
                const started = Date.now();
                const view = deps.makeView(worktreePath, fetch.headSha);
                const bundle = await deps.derive(view);
                await deps.store.saveContextBundle(workspace.id, bundle, Date.now() - started);
                derived = true;
            }
            finally {
                await deps.git.removeWorktree({ mirrorPath, worktreePath }).catch(() => undefined);
            }
            await deps.store.pruneContextBundles(workspace.id, BUNDLES_TO_KEEP);
        }
        const staleMarked = await deps.store.markPublishedJobsStale(workspace.id, fetch.headSha);
        await deps.store.finishSyncRequest(request.id, claimId, { ok: true });
        return {
            status: "synced",
            headSha: fetch.headSha,
            advanced: fetch.advanced,
            nonFastForward: fetch.nonFastForward,
            derived,
            staleMarked,
        };
    }
    catch (error) {
        const errorMessage = `${repoFullName(ref)}: ${error instanceof Error ? error.message : String(error)}`;
        await deps.store
            .finishSyncRequest(request.id, claimId, { ok: false, errorMessage })
            .catch(() => undefined);
        await deps.store
            .updateWorkspaceSyncState(workspace.id, {
            status: "error",
            lastErrorMessage: errorMessage.slice(0, 2000),
        })
            .catch(() => undefined);
        return { status: "failed", errorMessage };
    }
}
//# sourceMappingURL=sync.js.map