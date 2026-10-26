/**
 * One explanation job's status and result — the polling endpoint.
 */

import { getExplainerJob } from "@launchstack/pipelines/repo-workspace/db";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { createNotFoundError, createSuccessResponse, handleApiError } from "~/lib/api-utils";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { serializeExplainerJob } from "~/server/services/repo-explainer-jobs";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const { jobId } = await params;
        const job = await getExplainerJob(jobId, BigInt(ctx.data.companyId));
        if (!job) {
            const t = translatorFor(localeOfRequest(request), "agents.server.repoExplainer");
            return createNotFoundError(t("jobNotFound"));
        }
        return createSuccessResponse({ job: serializeExplainerJob(job) });
    } catch (error) {
        return handleApiError(error, request);
    }
}
