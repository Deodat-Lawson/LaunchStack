/**
 * Explanation jobs over a connected workspace (stage D, the job-vertical
 * shape): POST creates the job row and nudges the worker; GET lists. The
 * legacy synchronous route (/api/repo-explainer) remains the anonymous
 * public-repo path (V1); this one is for connected repos.
 */

import { z } from "zod";

import { DIAGRAM_TYPES } from "@launchstack/pipelines/repo-workspace";
import {
    createExplainerJob,
    getRepoWorkspace,
    listExplainerJobs,
} from "@launchstack/pipelines/repo-workspace/db";
import { inngest } from "~/server/inngest/client";
import { serializeExplainerJob } from "~/server/services/repo-explainer-jobs";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { validateRequestBody } from "~/lib/validation";
import {
    createForbiddenError,
    createNotFoundError,
    createSuccessResponse,
    createValidationError,
    handleApiError,
} from "~/lib/api-utils";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";

export const runtime = "nodejs";
export const maxDuration = 30;

const CreateJobSchema = z.object({
    workspaceId: z.string().min(1),
    diagramType: z.enum(DIAGRAM_TYPES).optional(),
    instructions: z.string().max(2000).optional(),
});

export async function POST(request: Request) {
    const t = translatorFor(localeOfRequest(request), "agents.server.repoExplainer");
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        if (!ctx.data.can("settings.manage")) {
            return createForbiddenError(t("managersOnlyRun"));
        }

        const validation = await validateRequestBody(request, CreateJobSchema);
        if (!validation.success) return validation.response;
        const { workspaceId, instructions } = validation.data;
        const diagramType = validation.data.diagramType ?? "architecture";

        const companyId = BigInt(ctx.data.companyId);
        const workspace = await getRepoWorkspace(workspaceId, companyId);
        if (!workspace) return createNotFoundError(t("workspaceNotFound"));
        if (workspace.status !== "active" || !workspace.headSha) {
            return createValidationError(
                t(workspace.headSha ? "notReady" : "neverSynced", { status: workspace.status })
            );
        }

        const job = await createExplainerJob({
            companyId,
            workspaceId,
            userId: ctx.data.authUserId,
            diagramType,
            instructions,
        });
        await inngest.send({
            name: "repo-explainer/job.requested",
            data: { jobId: job.id, workspaceId, companyId: companyId.toString() },
        });

        return createSuccessResponse({ job: serializeExplainerJob(job) }, undefined, 202);
    } catch (error) {
        return handleApiError(error, request);
    }
}

export async function GET(request: Request) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const url = new URL(request.url);
        const limit = Number(url.searchParams.get("limit") ?? "20");
        const offset = Number(url.searchParams.get("offset") ?? "0");
        const jobs = await listExplainerJobs(BigInt(ctx.data.companyId), {
            limit: Number.isFinite(limit) ? limit : 20,
            offset: Number.isFinite(offset) ? offset : 0,
        });
        return createSuccessResponse({ jobs: jobs.map(serializeExplainerJob) });
    } catch (error) {
        return handleApiError(error, request);
    }
}
