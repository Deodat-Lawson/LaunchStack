/**
 * Repo-workspace persistence. Every worker-side mutation is a conditional
 * update gated on status (and claim id where a claim exists), so a racing
 * duplicate delivery gets `null` back instead of clobbering state — the
 * founder-weekly-review claim discipline, applied to sync and jobs.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { getDb } from "@launchstack/store/client";
import { repoContextBundles, repoExplainerJobs, repoSyncRequests, repoWorkspaces } from "./schema.js";
export async function createRepoWorkspace(input) {
    const db = getDb();
    const [inserted] = await db
        .insert(repoWorkspaces)
        .values({
        id: input.id ?? randomUUID(),
        companyId: input.companyId,
        createdByUserId: input.createdByUserId,
        provider: input.ref.provider,
        owner: input.ref.owner,
        repo: input.ref.repo,
    })
        .onConflictDoNothing()
        .returning();
    if (inserted)
        return { created: true, workspace: inserted };
    const [existing] = await db
        .select()
        .from(repoWorkspaces)
        .where(and(eq(repoWorkspaces.companyId, input.companyId), eq(repoWorkspaces.provider, input.ref.provider), eq(repoWorkspaces.owner, input.ref.owner), eq(repoWorkspaces.repo, input.ref.repo)))
        .limit(1);
    if (!existing)
        throw new Error("workspace insert conflicted but no row found");
    return { created: false, workspace: existing };
}
export async function getRepoWorkspace(workspaceId, companyId) {
    const db = getDb();
    const conditions = [eq(repoWorkspaces.id, workspaceId)];
    if (companyId !== undefined)
        conditions.push(eq(repoWorkspaces.companyId, companyId));
    const [row] = await db
        .select()
        .from(repoWorkspaces)
        .where(and(...conditions))
        .limit(1);
    return row ?? null;
}
export async function listRepoWorkspaces(companyId) {
    const db = getDb();
    return db
        .select()
        .from(repoWorkspaces)
        .where(eq(repoWorkspaces.companyId, companyId))
        .orderBy(desc(repoWorkspaces.createdAt));
}
/** Every workspace with the given repo identity, across companies — how a
 * webhook delivery fans out to the workspaces that mirror that repo. */
export async function findWorkspacesByRepo(ref) {
    const db = getDb();
    return db
        .select()
        .from(repoWorkspaces)
        .where(and(eq(repoWorkspaces.provider, ref.provider), eq(repoWorkspaces.owner, ref.owner), eq(repoWorkspaces.repo, ref.repo), ne(repoWorkspaces.status, "disconnected")));
}
export async function updateWorkspaceSyncState(workspaceId, patch) {
    const db = getDb();
    const [row] = await db
        .update(repoWorkspaces)
        .set(patch)
        .where(eq(repoWorkspaces.id, workspaceId))
        .returning();
    return row ?? null;
}
export async function deleteRepoWorkspace(workspaceId, companyId) {
    const db = getDb();
    const [row] = await db
        .delete(repoWorkspaces)
        .where(and(eq(repoWorkspaces.id, workspaceId), eq(repoWorkspaces.companyId, companyId)))
        .returning();
    return row ?? null;
}
/** Active workspaces whose last sync is older than `olderThan` (or that have
 * never synced) — the poll reconciler's worklist. */
export async function listWorkspacesDueForPoll(olderThan, limit) {
    const db = getDb();
    return db
        .select()
        .from(repoWorkspaces)
        .where(and(or(eq(repoWorkspaces.status, "active"), eq(repoWorkspaces.status, "error")), or(isNull(repoWorkspaces.lastSyncedAt), lt(repoWorkspaces.lastSyncedAt, olderThan))))
        .limit(limit);
}
export async function requestSync(workspaceId, reason) {
    const db = getDb();
    const [inserted] = await db
        .insert(repoSyncRequests)
        .values({ id: randomUUID(), workspaceId, reason })
        .onConflictDoNothing()
        .returning();
    if (inserted)
        return { created: true, request: inserted };
    const [pending] = await db
        .select()
        .from(repoSyncRequests)
        .where(and(eq(repoSyncRequests.workspaceId, workspaceId), eq(repoSyncRequests.status, "pending")))
        .limit(1);
    if (!pending) {
        // The pending row completed between our insert and select — retry
        // once; the partial unique index arbitrates.
        const [retried] = await db
            .insert(repoSyncRequests)
            .values({ id: randomUUID(), workspaceId, reason })
            .onConflictDoNothing()
            .returning();
        if (retried)
            return { created: true, request: retried };
        throw new Error("sync request neither inserted nor found pending");
    }
    return { created: false, request: pending };
}
/** Claim the workspace's pending request. `null` means someone else owns it
 * or there is nothing to do — both are "stop", not errors. */
export async function claimPendingSyncRequest(workspaceId, claimId) {
    const db = getDb();
    const [row] = await db
        .update(repoSyncRequests)
        .set({ status: "running", claimId, startedAt: new Date() })
        .where(and(eq(repoSyncRequests.workspaceId, workspaceId), eq(repoSyncRequests.status, "pending")))
        .returning();
    return row ?? null;
}
export async function finishSyncRequest(requestId, claimId, outcome) {
    const db = getDb();
    const [row] = await db
        .update(repoSyncRequests)
        .set({
        status: outcome.ok ? "completed" : "failed",
        errorMessage: outcome.ok ? null : outcome.errorMessage.slice(0, 2000),
        completedAt: new Date(),
    })
        .where(and(eq(repoSyncRequests.id, requestId), eq(repoSyncRequests.status, "running"), eq(repoSyncRequests.claimId, claimId)))
        .returning();
    return row !== undefined;
}
// ---------------------------------------------------------------------------
// Context bundles
// ---------------------------------------------------------------------------
export async function saveContextBundle(workspaceId, bundle, computeMs) {
    const db = getDb();
    const [inserted] = await db
        .insert(repoContextBundles)
        .values({ id: randomUUID(), workspaceId, sha: bundle.sha, bundle, computeMs })
        .onConflictDoNothing()
        .returning();
    if (inserted)
        return inserted;
    const existing = await getContextBundle(workspaceId, bundle.sha);
    if (!existing)
        throw new Error("bundle insert conflicted but no row found");
    return existing;
}
export async function getContextBundle(workspaceId, sha) {
    const db = getDb();
    const [row] = await db
        .select()
        .from(repoContextBundles)
        .where(and(eq(repoContextBundles.workspaceId, workspaceId), eq(repoContextBundles.sha, sha)))
        .limit(1);
    return row ?? null;
}
/** Keep the newest `keep` bundles per workspace; prune the rest. */
export async function pruneContextBundles(workspaceId, keep) {
    const db = getDb();
    const rows = await db
        .select({ id: repoContextBundles.id })
        .from(repoContextBundles)
        .where(eq(repoContextBundles.workspaceId, workspaceId))
        .orderBy(desc(repoContextBundles.createdAt))
        .offset(keep);
    if (rows.length === 0)
        return 0;
    for (const row of rows) {
        await db.delete(repoContextBundles).where(eq(repoContextBundles.id, row.id));
    }
    return rows.length;
}
export async function createExplainerJob(input) {
    const db = getDb();
    const [row] = await db
        .insert(repoExplainerJobs)
        .values({
        id: input.id ?? randomUUID(),
        companyId: input.companyId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        diagramType: input.diagramType,
        instructions: input.instructions,
    })
        .returning();
    return row;
}
export async function getExplainerJob(jobId, companyId) {
    const db = getDb();
    const [row] = await db
        .select()
        .from(repoExplainerJobs)
        .where(and(eq(repoExplainerJobs.id, jobId), eq(repoExplainerJobs.companyId, companyId)))
        .limit(1);
    return row ?? null;
}
export async function listExplainerJobs(companyId, options) {
    const db = getDb();
    return db
        .select()
        .from(repoExplainerJobs)
        .where(eq(repoExplainerJobs.companyId, companyId))
        .orderBy(desc(repoExplainerJobs.createdAt))
        .limit(Math.min(options?.limit ?? 20, 100))
        .offset(options?.offset ?? 0);
}
/** queued → running, stamping the commit the run will explain. */
export async function claimExplainerJob(jobId, claimId, sha) {
    const db = getDb();
    const [row] = await db
        .update(repoExplainerJobs)
        .set({ status: "running", claimId, sha, startedAt: new Date() })
        .where(and(eq(repoExplainerJobs.id, jobId), eq(repoExplainerJobs.status, "queued")))
        .returning();
    return row ?? null;
}
export async function completeExplainerJob(jobId, claimId, result) {
    const db = getDb();
    const [row] = await db
        .update(repoExplainerJobs)
        .set({ status: "completed", result, completedAt: new Date(), errorMessage: null })
        .where(and(eq(repoExplainerJobs.id, jobId), eq(repoExplainerJobs.status, "running"), eq(repoExplainerJobs.claimId, claimId)))
        .returning();
    return row !== undefined;
}
/** Terminal failure. Without a claim id (Inngest onFailure after retries are
 * exhausted) any non-completed status may transition. */
export async function failExplainerJob(jobId, claimId, errorMessage) {
    const db = getDb();
    const conditions = [eq(repoExplainerJobs.id, jobId), ne(repoExplainerJobs.status, "completed")];
    if (claimId)
        conditions.push(eq(repoExplainerJobs.claimId, claimId));
    const [row] = await db
        .update(repoExplainerJobs)
        .set({
        status: "failed",
        errorMessage: errorMessage.slice(0, 2000),
        completedAt: new Date(),
    })
        .where(and(...conditions))
        .returning();
    return row !== undefined;
}
export async function markJobPublished(jobId, companyId, publishedDocumentId) {
    const db = getDb();
    const [row] = await db
        .update(repoExplainerJobs)
        .set({ publishedDocumentId, staleAt: null })
        .where(and(eq(repoExplainerJobs.id, jobId), eq(repoExplainerJobs.companyId, companyId), eq(repoExplainerJobs.status, "completed")))
        .returning();
    return row ?? null;
}
/** Design §3.5: a new head makes published explanations of older commits
 * stale. Returns how many were marked. */
export async function markPublishedJobsStale(workspaceId, newSha) {
    const db = getDb();
    const rows = await db
        .update(repoExplainerJobs)
        .set({ staleAt: new Date() })
        .where(and(eq(repoExplainerJobs.workspaceId, workspaceId), isNotNull(repoExplainerJobs.publishedDocumentId), isNull(repoExplainerJobs.staleAt), ne(repoExplainerJobs.sha, newSha)))
        .returning();
    return rows.length;
}
//# sourceMappingURL=db.js.map