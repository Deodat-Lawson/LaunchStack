/**
 * Stage B on the worker (design §3.2): the sync executor and the poll
 * reconciler. Webhook-first, poll-backed — webhooks are an optimization,
 * the cron is the guarantee. The sync request row (claimed with a CAS) is
 * the unit of idempotency; a failed run leaves a terminal request and the
 * next webhook or poll opens a fresh one, so Inngest retries stay at 1.
 */

import { inngest } from "../client";
import { RepoWorkspaceSyncEventDataSchema } from "@launchstack/pipelines/repo-workspace";
import { runWorkspaceSync } from "@launchstack/pipelines/repo-workspace";
import {
    getRepoWorkspace,
    listWorkspacesDueForPoll,
    requestSync,
} from "@launchstack/pipelines/repo-workspace/db";
import { makeRepoSyncDeps } from "~/server/services/repo-workspace";

/** A workspace is polled when its last completed sync is older than this. */
const POLL_STALENESS_MS = 6 * 60 * 60 * 1000;
const POLL_BATCH_SIZE = 20;

export const repoWorkspaceSyncJob = inngest.createFunction(
    {
        id: "repo-workspace-sync",
        name: "Repo Workspace Sync",
        retries: 1,
        // One sync per workspace at a time; different workspaces in parallel.
        concurrency: { key: "event.data.workspaceId", limit: 1 },
    },
    { event: "repo-workspace/sync.requested" },
    async ({ event, step }) => {
        const { workspaceId } = RepoWorkspaceSyncEventDataSchema.parse(event.data);

        return step.run("sync", async () => {
            const workspace = await getRepoWorkspace(workspaceId);
            if (!workspace) return { status: "skipped", reason: "workspace_missing" };
            const outcome = await runWorkspaceSync(makeRepoSyncDeps(), workspace);
            if (outcome.status === "failed") {
                // Persisted already (request row + workspace status); log for
                // operators, don't retry a terminal request.
                console.error(
                    `[RepoWorkspaceSync] ${workspace.owner}/${workspace.repo} failed: ${outcome.errorMessage}`
                );
            }
            return outcome;
        });
    }
);

export const repoWorkspacePollReconciler = inngest.createFunction(
    {
        id: "repo-workspace-poll-reconciler",
        name: "Repo Workspace Poll Reconciler",
        retries: 0,
    },
    { cron: "*/30 * * * *" },
    async ({ step }) => {
        const due = await step.run("find-due", async () => {
            const olderThan = new Date(Date.now() - POLL_STALENESS_MS);
            const workspaces = await listWorkspacesDueForPoll(olderThan, POLL_BATCH_SIZE);
            return workspaces.map(workspace => workspace.id);
        });

        if (due.length === 0) return { requested: 0 };

        const requested = await step.run("request-syncs", async () => {
            let count = 0;
            for (const workspaceId of due) {
                await requestSync(workspaceId, "poll");
                count += 1;
            }
            return count;
        });

        await step.sendEvent(
            "dispatch",
            due.map(workspaceId => ({
                name: "repo-workspace/sync.requested" as const,
                data: { workspaceId },
            }))
        );

        return { requested };
    }
);
