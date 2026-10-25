/**
 * Publish a completed explanation into the Sources library (design §3.5) —
 * the mindmap seam with different nouns: render to Markdown, store the file,
 * hand it to `processDocumentUpload` with a convergent creation key, record
 * the back-link. Re-publishing the same (repo@sha, type) converges on the
 * existing source instead of duplicating it.
 *
 * Publishing is adding a file (ADR-014): it takes `documents.upload` and edit
 * access to the folder it lands in, and a first publish into Unfiled is
 * private to the publisher until they share it.
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
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { validateRequestBody } from "~/lib/validation";
import {
    createForbiddenError,
    createNotFoundError,
    createSuccessResponse,
    createValidationError,
    handleApiError,
} from "~/lib/api-utils";
import { processDocumentUpload } from "~/server/services/document-upload";
import { canEditFolder } from "~/server/services/folder-access";
import { recordUpload } from "~/server/workspace/added-documents";
import { serializeExplainerJob } from "~/server/services/repo-explainer-jobs";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";

export const runtime = "nodejs";
export const maxDuration = 60;

const PublishSchema = z.object({
    jobId: z.string().min(1),
    /** Optional Sources-library folder, like the mindmap publish. */
    category: z.string().max(200).optional(),
});

export async function POST(request: Request) {
    const t = translatorFor(localeOfRequest(request), "agents.server.repoExplainer");
    try {
        const ctx = await requireWorkspacePermission("documents.upload");
        if (!ctx.success) return ctx.response;

        const validation = await validateRequestBody(request, PublishSchema);
        if (!validation.success) return validation.response;
        const { jobId, category } = validation.data;

        if (!(await canEditFolder(ctx.data, category ?? ""))) {
            // FOLDER_EDIT_DENIED (~/server/services/folder-access), in the reader's language.
            return createForbiddenError(t("folderEditDenied"));
        }

        const companyId = BigInt(ctx.data.companyId);
        const job = await getExplainerJob(jobId, companyId);
        if (!job) return createNotFoundError(t("jobNotFound"));
        if (job.status !== "completed" || !job.result || !job.sha) {
            return createValidationError(t("onlyCompletedPublish"));
        }

        const workspace = await getRepoWorkspace(job.workspaceId, companyId);
        if (!workspace) return createNotFoundError(t("workspaceNotFound"));

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
        await recordUpload(ctx.data, upload);

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
        return handleApiError(error, request);
    }
}
