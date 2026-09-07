/**
 * Publish a completed explanation into the Sources library (design §3.5) —
 * the mindmap seam with different nouns: render to Markdown, store the file,
 * hand it to `processDocumentUpload` with a convergent creation key, record
 * the back-link. Re-publishing the same (repo@sha, type) converges on the
 * existing source instead of duplicating it.
 */

import { z } from "zod";

import {
    makeExplanationCreationKey,
    makeExplanationFilename,
    renderExplanationMarkdown,
} from "@launchstack/pipelines/repo-explainer";
import {
    getExplainerJob,
    getRepoWorkspace,
    markJobPublished,
} from "@launchstack/pipelines/repo-workspace/db";

import { uploadFile } from "~/lib/storage";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { validateRequestBody } from "~/lib/validation";
import {
    createNotFoundError,
    createSuccessResponse,
    createValidationError,
    handleApiError,
} from "~/lib/api-utils";
import { processDocumentUpload } from "~/server/services/document-upload";
import { serializeExplainerJob } from "~/server/services/repo-explainer-jobs";

export const runtime = "nodejs";
export const maxDuration = 60;

const PublishSchema = z.object({
    jobId: z.string().min(1),
    /** Optional Sources-library folder, like the mindmap publish. */
    category: z.string().max(200).optional(),
});

export async function POST(request: Request) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const validation = await validateRequestBody(request, PublishSchema);
        if (!validation.success) return validation.response;
        const { jobId, category } = validation.data;

        const companyId = BigInt(ctx.data.companyId);
        const job = await getExplainerJob(jobId, companyId);
        if (!job) return createNotFoundError("Repo explainer job");
        if (job.status !== "completed" || !job.result || !job.sha) {
            return createValidationError("Only completed explanations can be published");
        }

        const workspace = await getRepoWorkspace(job.workspaceId, companyId);
        if (!workspace) return createNotFoundError("Repository workspace");

        const markdown = renderExplanationMarkdown({
            owner: workspace.owner,
            repo: workspace.repo,
            diagramType: job.diagramType,
            result: job.result,
            generatedAt: job.completedAt ?? new Date(),
        });
        const filename = makeExplanationFilename(workspace.owner, workspace.repo, job.sha);

        const stored = await uploadFile({
            filename,
            data: Buffer.from(markdown, "utf8"),
            contentType: "text/markdown",
            userId: ctx.data.authUserId,
            companyId: ctx.data.companyId,
        });

        const upload = await processDocumentUpload({
            user: { userId: ctx.data.authUserId, companyId: ctx.data.companyId },
            documentName: `${workspace.owner}/${workspace.repo} — ${job.diagramType} explanation`,
            rawDocumentUrl: stored.url,
            // Same repo, same commit, same diagram type ⇒ the same source.
            creationKey: makeExplanationCreationKey(
                workspace.owner,
                workspace.repo,
                job.sha,
                job.diagramType
            ),
            category,
            explicitStorageType: stored.provider,
            mimeType: "text/markdown",
            originalFilename: filename,
            requestUrl: request.url,
        });

        const updated = await markJobPublished(jobId, companyId, BigInt(upload.document.id));

        return createSuccessResponse(
            {
                job: updated ? serializeExplainerJob(updated) : serializeExplainerJob(job),
                document: upload.document,
                jobRunId: upload.jobId,
            },
            undefined,
            201
        );
    } catch (error) {
        return handleApiError(error);
    }
}
