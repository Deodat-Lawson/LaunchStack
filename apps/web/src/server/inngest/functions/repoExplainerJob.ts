/**
 * Stage D on the worker (design §3.4): one explanation job. Claims the job
 * row (CAS), checks out the workspace's head, warm-starts from the stored
 * context bundle (deriving it on the spot if the sync that should have
 * produced it was lost), runs the gated agent, and persists the result.
 *
 * A failed gate is a *typed, visible* failure — never a silently degraded
 * answer (design §3.4).
 */

import { randomUUID } from "node:crypto";

import { resolveChatModel } from "@launchstack/llm";
import { createLangchainAgentPort } from "@launchstack/llm";
import {
    RepoExplainerJobEventDataSchema,
    createDirectoryView,
    deriveContextBundle,
} from "@launchstack/pipelines/repo-workspace";
import {
    claimExplainerJob,
    completeExplainerJob,
    failExplainerJob,
    getContextBundle,
    getRepoWorkspace,
    saveContextBundle,
} from "@launchstack/pipelines/repo-workspace/db";
import { runRepoExplanation } from "@launchstack/pipelines/repo-explainer";
import type { RepoExplanationJobResult } from "@launchstack/pipelines/repo-workspace/schema";

import { inngest } from "../client";
import {
    repoWorkspaceGit,
    repoWorkspacePaths,
    resolveRepoCredentials,
} from "~/server/services/repo-workspace";

function toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "string" && error.length > 0) return error;
    try {
        return JSON.stringify(error);
    } catch {
        return "Unknown repo explainer error";
    }
}

export const repoExplainerJob = inngest.createFunction(
    {
        id: "repo-explainer-job",
        name: "Repo Explainer Job",
        retries: 1,
        concurrency: { key: "event.data.workspaceId", limit: 1 },
        onFailure: async ({ error, event }) => {
            const parsed = RepoExplainerJobEventDataSchema.safeParse(event.data.event.data);
            if (!parsed.success) {
                console.error("[RepoExplainer] Failed job with invalid payload:", parsed.error);
                return;
            }
            try {
                await failExplainerJob(parsed.data.jobId, null, toErrorMessage(error));
            } catch (failureError) {
                console.error("[RepoExplainer] Could not mark job failed:", failureError);
            }
        },
    },
    { event: "repo-explainer/job.requested" },
    async ({ event, step }) => {
        const { jobId, workspaceId, companyId } = RepoExplainerJobEventDataSchema.parse(event.data);

        return step.run("explain", async () => {
            const workspace = await getRepoWorkspace(workspaceId, BigInt(companyId));
            if (!workspace) {
                await failExplainerJob(jobId, null, "Workspace not found");
                return { status: "failed", reason: "workspace_missing" };
            }
            if (!workspace.headSha || workspace.status !== "active") {
                await failExplainerJob(
                    jobId,
                    null,
                    `Workspace is not ready (status: ${workspace.status}). Sync it first.`
                );
                return { status: "failed", reason: "workspace_not_ready" };
            }

            const claimId = randomUUID();
            const job = await claimExplainerJob(jobId, claimId, workspace.headSha);
            // Someone else owns it, or it already finished — converge quietly.
            if (!job) return { status: "skipped", reason: "not_claimable" };

            const sha = workspace.headSha;
            const mirrorPath = repoWorkspacePaths.mirrorPath(workspace);
            const worktreePath = repoWorkspacePaths.worktreePath(workspace, sha);
            const token = await resolveRepoCredentials({
                provider: workspace.provider,
                owner: workspace.owner,
                repo: workspace.repo,
            });

            await repoWorkspaceGit.addWorktree({ mirrorPath, sha, worktreePath, token });
            try {
                const view = createDirectoryView(worktreePath, sha);

                let bundleRow = await getContextBundle(workspace.id, sha);
                if (!bundleRow) {
                    const started = Date.now();
                    const bundle = await deriveContextBundle(view);
                    bundleRow = await saveContextBundle(workspace.id, bundle, Date.now() - started);
                }

                const port = createLangchainAgentPort(resolveChatModel());
                const run = await runRepoExplanation({
                    view,
                    bundle: bundleRow.bundle,
                    port,
                    repoName: `${workspace.owner}/${workspace.repo}`,
                    diagramType: job.diagramType,
                    instructions: job.instructions,
                });

                if (!run.gate.ok) {
                    const gateReport = run.gate.errors
                        .map(gateError => `[${gateError.code}] ${gateError.message}`)
                        .join("; ");
                    await failExplainerJob(
                        jobId,
                        claimId,
                        `Validation failed after one repair: ${gateReport}`
                    );
                    return { status: "failed", reason: "gate", errors: run.gate.errors };
                }

                const result: RepoExplanationJobResult = {
                    summary: run.summary,
                    mermaidCode: run.mermaidCode,
                    filesRead: run.filesRead,
                    path: run.path,
                    turns: run.turns,
                    provenance: {
                        sha,
                        skillVersion: run.skillVersion,
                        skillHash: run.skillHash,
                        modelId: run.modelId,
                        promptVersion: run.promptVersion,
                    },
                    tokenUsage: {
                        inputTokens: run.usage.inputTokens,
                        outputTokens: run.usage.outputTokens,
                        totalTokens: run.usage.totalTokens,
                    },
                };
                const completed = await completeExplainerJob(jobId, claimId, result);
                if (!completed) {
                    console.error(`[RepoExplainer] Lost the claim while completing ${jobId}`);
                }
                return { status: "completed", path: run.path, turns: run.turns };
            } finally {
                await repoWorkspaceGit
                    .removeWorktree({ mirrorPath, worktreePath })
                    .catch(() => undefined);
            }
        });
    }
);
