import { describe, expect, it } from "vitest";

import type { RepoContextBundleRow, RepoSyncRequestRow, RepoWorkspaceRow } from "./schema";
import type { SyncDeps, SyncStore } from "./sync";
import { runWorkspaceSync } from "./sync";
import type { ContextBundle, FetchResult, GitPort, WorkspaceView } from "./types";
import { CONTEXT_BUNDLE_SCHEMA_VERSION } from "./types";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function workspace(overrides?: Partial<RepoWorkspaceRow>): RepoWorkspaceRow {
    return {
        id: "ws-1",
        companyId: 1n,
        createdByUserId: "user-1",
        provider: "github",
        owner: "octo",
        repo: "demo",
        status: "active",
        headSha: null,
        mirrorPath: null,
        diskBytes: null,
        lastSyncedAt: null,
        lastErrorMessage: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: null,
        ...overrides,
    } as RepoWorkspaceRow;
}

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

interface Recorded {
    events: string[];
    savedBundles: ContextBundle[];
    workspacePatches: Array<Record<string, unknown>>;
    finishOutcomes: Array<{ ok: boolean; errorMessage?: string }>;
}

function makeDeps(options?: {
    fetch?: FetchResult | Error;
    pending?: boolean;
    existingBundleFor?: string;
    deriveError?: Error;
    staleMarked?: number;
}): { deps: SyncDeps; recorded: Recorded } {
    const recorded: Recorded = {
        events: [],
        savedBundles: [],
        workspacePatches: [],
        finishOutcomes: [],
    };

    const fetchResult: FetchResult = (options?.fetch as FetchResult) ?? {
        previousSha: SHA_A,
        headSha: SHA_B,
        advanced: true,
        nonFastForward: false,
    };

    const git: GitPort = {
        ensureMirror: () => {
            recorded.events.push("ensureMirror");
            return Promise.resolve({ created: false, headSha: fetchResult.headSha });
        },
        fetchMirror: () => {
            recorded.events.push("fetchMirror");
            if (options?.fetch instanceof Error) return Promise.reject(options.fetch);
            return Promise.resolve(fetchResult);
        },
        resolveHead: () => Promise.resolve(fetchResult.headSha),
        addWorktree: () => {
            recorded.events.push("addWorktree");
            return Promise.resolve();
        },
        removeWorktree: () => {
            recorded.events.push("removeWorktree");
            return Promise.resolve();
        },
        mirrorSizeBytes: () => Promise.resolve(4096),
    };

    const store: SyncStore = {
        claimPendingSyncRequest: (_workspaceId, claimId) => {
            recorded.events.push("claim");
            if (options?.pending === false) return Promise.resolve(null);
            return Promise.resolve({
                id: "req-1",
                workspaceId: "ws-1",
                status: "running",
                reason: "webhook",
                claimId,
                errorMessage: null,
                requestedAt: new Date(),
                startedAt: new Date(),
                completedAt: null,
            } as RepoSyncRequestRow);
        },
        finishSyncRequest: (_id, _claim, outcome) => {
            recorded.events.push(`finish:${outcome.ok ? "ok" : "fail"}`);
            recorded.finishOutcomes.push(
                outcome.ok ? { ok: true } : { ok: false, errorMessage: outcome.errorMessage }
            );
            return Promise.resolve(true);
        },
        updateWorkspaceSyncState: (_id, patch) => {
            recorded.events.push("patchWorkspace");
            recorded.workspacePatches.push(patch as Record<string, unknown>);
            return Promise.resolve(null);
        },
        getContextBundle: (_id, sha) => {
            recorded.events.push("getBundle");
            if (options?.existingBundleFor === sha) {
                return Promise.resolve({ id: "bundle-1" } as RepoContextBundleRow);
            }
            return Promise.resolve(null);
        },
        saveContextBundle: (_id, bundle) => {
            recorded.events.push("saveBundle");
            recorded.savedBundles.push(bundle);
            return Promise.resolve(null);
        },
        markPublishedJobsStale: () => {
            recorded.events.push("markStale");
            return Promise.resolve(options?.staleMarked ?? 0);
        },
        pruneContextBundles: () => {
            recorded.events.push("prune");
            return Promise.resolve(0);
        },
    };

    const deps: SyncDeps = {
        git,
        credentials: () => Promise.resolve("test-token"),
        paths: {
            mirrorPath: ws => `/data/mirrors/${ws.id}.git`,
            worktreePath: (ws, sha) => `/data/worktrees/${ws.id}/${sha}`,
        },
        store,
        makeView: (dir, sha): WorkspaceView => ({
            sha,
            listFiles: () => Promise.resolve([]),
            readFile: () => Promise.resolve(null),
            searchText: () => Promise.resolve([]),
        }),
        derive: view => {
            recorded.events.push("derive");
            if (options?.deriveError) return Promise.reject(options.deriveError);
            return Promise.resolve(bundleFor(view.sha));
        },
    };

    return { deps, recorded };
}

describe("runWorkspaceSync", () => {
    it("skips a disconnected workspace without claiming anything", async () => {
        const { deps, recorded } = makeDeps();
        const outcome = await runWorkspaceSync(deps, workspace({ status: "disconnected" }));
        expect(outcome).toEqual({ status: "skipped", reason: "workspace_disconnected" });
        expect(recorded.events).toEqual([]);
    });

    it("skips when there is no pending request (someone else claimed it)", async () => {
        const { deps, recorded } = makeDeps({ pending: false });
        const outcome = await runWorkspaceSync(deps, workspace());
        expect(outcome).toEqual({ status: "skipped", reason: "no_pending_request" });
        expect(recorded.events).toEqual(["claim"]);
    });

    it("fetches, derives, marks stale, and completes the request on a new head", async () => {
        const { deps, recorded } = makeDeps({ staleMarked: 2 });
        const outcome = await runWorkspaceSync(deps, workspace());
        expect(outcome).toEqual({
            status: "synced",
            headSha: SHA_B,
            advanced: true,
            nonFastForward: false,
            derived: true,
            staleMarked: 2,
        });
        expect(recorded.events).toEqual([
            "claim",
            "ensureMirror",
            "fetchMirror",
            "patchWorkspace",
            "getBundle",
            "addWorktree",
            "derive",
            "saveBundle",
            "removeWorktree",
            "prune",
            "markStale",
            "finish:ok",
        ]);
        expect(recorded.savedBundles[0]!.sha).toBe(SHA_B);
        expect(recorded.workspacePatches[0]).toMatchObject({
            status: "active",
            headSha: SHA_B,
            diskBytes: 4096,
            lastErrorMessage: null,
        });
    });

    it("skips derivation when a bundle for the head already exists", async () => {
        const { deps, recorded } = makeDeps({ existingBundleFor: SHA_B });
        const outcome = await runWorkspaceSync(deps, workspace());
        expect(outcome).toMatchObject({ status: "synced", derived: false });
        expect(recorded.events).not.toContain("addWorktree");
        expect(recorded.events).not.toContain("derive");
        expect(recorded.events).toContain("finish:ok");
    });

    it("derives on the first sync even when the head did not advance", async () => {
        // advanced=false but no bundle exists yet — the redelivery/crash case.
        const { deps, recorded } = makeDeps({
            fetch: {
                previousSha: SHA_B,
                headSha: SHA_B,
                advanced: false,
                nonFastForward: false,
            },
        });
        const outcome = await runWorkspaceSync(deps, workspace());
        expect(outcome).toMatchObject({ status: "synced", advanced: false, derived: true });
        expect(recorded.events).toContain("derive");
    });

    it("removes the worktree even when derivation throws, then fails the request", async () => {
        const { deps, recorded } = makeDeps({ deriveError: new Error("parse explosion") });
        const outcome = await runWorkspaceSync(deps, workspace());
        expect(outcome).toMatchObject({ status: "failed" });
        expect((outcome as { errorMessage: string }).errorMessage).toContain("parse explosion");
        expect(recorded.events).toContain("removeWorktree");
        expect(recorded.events).toContain("finish:fail");
        // The workspace is flipped to error with the message persisted.
        const lastPatch = recorded.workspacePatches[recorded.workspacePatches.length - 1]!;
        expect(lastPatch).toMatchObject({ status: "error" });
        expect(String(lastPatch.lastErrorMessage)).toContain("octo/demo");
    });

    it("fails the request and flips the workspace to error when the fetch fails", async () => {
        const { deps, recorded } = makeDeps({ fetch: new Error("remote hung up") });
        const outcome = await runWorkspaceSync(deps, workspace());
        expect(outcome).toMatchObject({ status: "failed" });
        expect(recorded.finishOutcomes[0]).toMatchObject({ ok: false });
        expect(recorded.finishOutcomes[0]!.errorMessage).toContain("remote hung up");
        expect(recorded.events).not.toContain("saveBundle");
    });

    it("reports a force-push through the outcome", async () => {
        const { deps } = makeDeps({
            fetch: { previousSha: SHA_A, headSha: SHA_B, advanced: true, nonFastForward: true },
        });
        const outcome = await runWorkspaceSync(deps, workspace());
        expect(outcome).toMatchObject({ status: "synced", nonFastForward: true });
    });
});
