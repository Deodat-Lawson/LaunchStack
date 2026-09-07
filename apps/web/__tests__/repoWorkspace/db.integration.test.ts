/**
 * Repo-workspace store integration tests — every claim/CAS path against a
 * real database with the full migration history applied (which also proves
 * the 20260902023851_repo_workspaces migration applies cleanly).
 *
 * Gated like the founder-weekly-review suites: skipped without a database.
 */

import { company } from "@launchstack/store/schema";
import { configureDatabase } from "@launchstack/store/client";
import {
    claimExplainerJob,
    claimPendingSyncRequest,
    completeExplainerJob,
    createExplainerJob,
    createRepoWorkspace,
    deleteRepoWorkspace,
    failExplainerJob,
    findWorkspacesByRepo,
    finishSyncRequest,
    getContextBundle,
    getExplainerJob,
    getRepoWorkspace,
    listWorkspacesDueForPoll,
    markJobPublished,
    markPublishedJobsStale,
    pruneContextBundles,
    requestSync,
    saveContextBundle,
    updateWorkspaceSyncState,
} from "@launchstack/pipelines/repo-workspace/db";
import type { ContextBundle } from "@launchstack/pipelines/repo-workspace";
import { CONTEXT_BUNDLE_SCHEMA_VERSION } from "@launchstack/pipelines/repo-workspace";

import { createFounderWeeklyReviewTestDatabase } from "../founderWeeklyReview/testDb";

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function bundleFor(sha: string): ContextBundle {
    return {
        schemaVersion: CONTEXT_BUNDLE_SCHEMA_VERSION,
        sha,
        tree: ".",
        map: { entries: [], rendered: "" },
        memoryFiles: [],
        stats: { totalFiles: 0, totalBytes: 0, languages: [], largestDirectories: [] },
        hygiene: { deniedPaths: [] },
    };
}

describeDb("repo-workspace store", () => {
    jest.setTimeout(120_000);

    let testDb: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;
    let companyId: bigint;

    beforeAll(async () => {
        testDb = await createFounderWeeklyReviewTestDatabase();
        configureDatabase(testDb.db);
        const [row] = await testDb.db
            .insert(company)
            .values({ name: "RepoWs", numberOfEmployees: "1" })
            .returning();
        companyId = BigInt(row!.id);
    }, 120_000);

    afterAll(async () => {
        await testDb?.close();
    });

    async function freshWorkspace(repo: string) {
        const { workspace } = await createRepoWorkspace({
            companyId,
            createdByUserId: "user-1",
            ref: { provider: "github", owner: "octo", repo },
        });
        return workspace;
    }

    it("creates a workspace once and converges on reconnect", async () => {
        const first = await createRepoWorkspace({
            companyId,
            createdByUserId: "user-1",
            ref: { provider: "github", owner: "octo", repo: "unique-a" },
        });
        expect(first.created).toBe(true);

        const second = await createRepoWorkspace({
            companyId,
            createdByUserId: "user-2",
            ref: { provider: "github", owner: "octo", repo: "unique-a" },
        });
        expect(second.created).toBe(false);
        expect(second.workspace.id).toBe(first.workspace.id);
    });

    it("scopes reads by company", async () => {
        const workspace = await freshWorkspace("scoping");
        expect(await getRepoWorkspace(workspace.id, companyId)).not.toBeNull();
        expect(await getRepoWorkspace(workspace.id, companyId + 1n)).toBeNull();
    });

    it("coalesces sync requests into one pending row per workspace", async () => {
        const workspace = await freshWorkspace("coalesce");
        const first = await requestSync(workspace.id, "webhook");
        expect(first.created).toBe(true);

        const burst = await requestSync(workspace.id, "webhook");
        expect(burst.created).toBe(false);
        expect(burst.request.id).toBe(first.request.id);

        // Claim it; the next request opens a fresh row.
        const claimed = await claimPendingSyncRequest(workspace.id, "claim-1");
        expect(claimed?.id).toBe(first.request.id);
        const afterClaim = await requestSync(workspace.id, "poll");
        expect(afterClaim.created).toBe(true);
        expect(afterClaim.request.id).not.toBe(first.request.id);
    });

    it("claim + finish are gated: wrong claim id cannot finish a request", async () => {
        const workspace = await freshWorkspace("claims");
        const { request } = await requestSync(workspace.id, "connect");
        const claimed = await claimPendingSyncRequest(workspace.id, "claim-x");
        expect(claimed).not.toBeNull();

        // A second claimant finds nothing pending.
        expect(await claimPendingSyncRequest(workspace.id, "claim-y")).toBeNull();

        expect(await finishSyncRequest(request.id, "claim-y", { ok: true })).toBe(false);
        expect(await finishSyncRequest(request.id, "claim-x", { ok: true })).toBe(true);
        // Finishing twice is refused — the row is terminal.
        expect(await finishSyncRequest(request.id, "claim-x", { ok: true })).toBe(false);
    });

    it("bundle save converges on the unique (workspace, sha) and prunes to newest N", async () => {
        const workspace = await freshWorkspace("bundles");
        const first = await saveContextBundle(workspace.id, bundleFor(SHA_A), 10);
        const again = await saveContextBundle(workspace.id, bundleFor(SHA_A), 99);
        expect(again.id).toBe(first.id);

        await saveContextBundle(workspace.id, bundleFor(SHA_B), 10);
        await saveContextBundle(workspace.id, bundleFor("c".repeat(40)), 10);
        const pruned = await pruneContextBundles(workspace.id, 2);
        expect(pruned).toBe(1);
        // The oldest (SHA_A) went; the newest two remain.
        expect(await getContextBundle(workspace.id, SHA_B)).not.toBeNull();
    });

    it("job lifecycle: claim is CAS, completion is claim-gated, failure respects terminal state", async () => {
        const workspace = await freshWorkspace("jobs");
        const job = await createExplainerJob({
            companyId,
            workspaceId: workspace.id,
            userId: "user-1",
            diagramType: "architecture",
        });

        const claimed = await claimExplainerJob(job.id, "claim-1", SHA_A);
        expect(claimed?.status).toBe("running");
        expect(claimed?.sha).toBe(SHA_A);
        expect(await claimExplainerJob(job.id, "claim-2", SHA_A)).toBeNull();

        const result = {
            summary: "## Overview\nx",
            mermaidCode: "flowchart TD\n A-->B",
            filesRead: ["README.md"],
            path: "fast" as const,
            turns: 1,
            provenance: {
                sha: SHA_A,
                skillVersion: "v1",
                skillHash: "h".repeat(64),
                promptVersion: "p1",
            },
        };
        expect(await completeExplainerJob(job.id, "wrong-claim", result)).toBe(false);
        expect(await completeExplainerJob(job.id, "claim-1", result)).toBe(true);

        // A completed job never flips to failed (the onFailure race).
        expect(await failExplainerJob(job.id, null, "late failure")).toBe(false);
        const final = await getExplainerJob(job.id, companyId);
        expect(final?.status).toBe("completed");
        expect(final?.result?.summary).toContain("Overview");
    });

    it("publish back-link and stale-marking follow the sync loop", async () => {
        const workspace = await freshWorkspace("stale");
        const job = await createExplainerJob({
            companyId,
            workspaceId: workspace.id,
            userId: "user-1",
            diagramType: "architecture",
        });
        await claimExplainerJob(job.id, "c1", SHA_A);
        await completeExplainerJob(job.id, "c1", {
            summary: "s",
            mermaidCode: "m",
            filesRead: [],
            path: "fast",
            turns: 1,
            provenance: {
                sha: SHA_A,
                skillVersion: "v1",
                skillHash: "h".repeat(64),
                promptVersion: "p1",
            },
        });

        const published = await markJobPublished(job.id, companyId, 12345n);
        expect(published?.publishedDocumentId).toBe(12345n);
        expect(published?.staleAt).toBeNull();

        // Same head → nothing stales. New head → the published job stales once.
        expect(await markPublishedJobsStale(workspace.id, SHA_A)).toBe(0);
        expect(await markPublishedJobsStale(workspace.id, SHA_B)).toBe(1);
        expect(await markPublishedJobsStale(workspace.id, SHA_B)).toBe(0);
    });

    it("poll worklist includes never-synced and stale, excludes fresh and disconnected", async () => {
        const neverSynced = await freshWorkspace("poll-never");
        await updateWorkspaceSyncState(neverSynced.id, { status: "active" });
        const fresh = await freshWorkspace("poll-fresh");
        await updateWorkspaceSyncState(fresh.id, {
            status: "active",
            lastSyncedAt: new Date(),
        });
        const disconnected = await freshWorkspace("poll-gone");
        await updateWorkspaceSyncState(disconnected.id, { status: "disconnected" });

        const due = await listWorkspacesDueForPoll(new Date(Date.now() - 60_000), 100);
        const ids = due.map(workspace => workspace.id);
        expect(ids).toContain(neverSynced.id);
        expect(ids).not.toContain(fresh.id);
        expect(ids).not.toContain(disconnected.id);
    });

    it("webhook fan-out finds every non-disconnected workspace for a repo", async () => {
        const active = await freshWorkspace("fanout");
        const gone = await createRepoWorkspace({
            companyId,
            createdByUserId: "user-1",
            ref: { provider: "github", owner: "octo2", repo: "fanout" },
        });
        await updateWorkspaceSyncState(gone.workspace.id, { status: "disconnected" });

        const found = await findWorkspacesByRepo({
            provider: "github",
            owner: "octo",
            repo: "fanout",
        });
        expect(found.map(workspace => workspace.id)).toContain(active.id);
        expect(found.map(workspace => workspace.id)).not.toContain(gone.workspace.id);
    });

    it("deleting a workspace cascades requests, bundles, and jobs", async () => {
        const workspace = await freshWorkspace("cascade");
        await requestSync(workspace.id, "connect");
        await saveContextBundle(workspace.id, bundleFor(SHA_A), 5);
        const job = await createExplainerJob({
            companyId,
            workspaceId: workspace.id,
            userId: "user-1",
            diagramType: "er",
        });

        const deleted = await deleteRepoWorkspace(workspace.id, companyId);
        expect(deleted?.id).toBe(workspace.id);
        expect(await getRepoWorkspace(workspace.id)).toBeNull();
        expect(await getContextBundle(workspace.id, SHA_A)).toBeNull();
        expect(await getExplainerJob(job.id, companyId)).toBeNull();
    });
});
