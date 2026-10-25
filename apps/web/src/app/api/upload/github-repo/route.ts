/**
 * GitHub Repo Upload API Route
 *
 * Accepts a GitHub repository URL, downloads it as a ZIP, stores it,
 * and triggers the existing document processing pipeline.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { localeOfRequest } from "~/i18n/server";
import { translatorFor, wordCopy, wordOr } from "~/i18n/translate";
import { V } from "~/i18n/validation";

import { processDocumentUpload } from "~/server/services/document-upload";
import {
    parseGitHubUrl,
    downloadGitHubRepoZip,
    GitHubRepoError,
    GitHubRepoNotFoundError,
    GitHubAuthError,
    GitHubRateLimitError,
} from "~/server/services/github-repo";
import { putFile } from "~/server/storage/vercel-blob";
import { validateRequestBody } from "~/lib/validation";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { canEditFolder } from "~/server/services/folder-access";
import { recordUpload } from "~/server/workspace/added-documents";
import { getCompanyAccessToken } from "~/server/services/connectors/connection-store";
import { UploadAuthorizationError } from "~/server/services/upload-authorization-error";

const GitHubRepoSchema = z.object({
    repoUrl: z.string().url(V.validUrlRequired),
    branch: z.string().optional(),
    accessToken: z.string().optional(),
    category: z.string().optional(),
});

export async function POST(request: Request) {
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "upload.server.errors");
    const unknownError = () => translatorFor(locale, "errors.api")("unknownError");
    /** A GitHub refusal in the reader's language; anything else as it came. */
    const errorDetail = (error: unknown) =>
        error instanceof GitHubRepoError
            ? wordCopy(error.copy, locale)
            : error instanceof Error
              ? error.message
              : unknownError();
    const ctx = await requireWorkspacePermission("documents.upload");
    if (!ctx.success) return ctx.response;

    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const validation = await validateRequestBody(request, GitHubRepoSchema);
            if (!validation.success) {
                return validation.response;
            }

            const { repoUrl, branch, accessToken, category } = validation.data;

            if (category !== undefined && !(await canEditFolder(ctx.data, category))) {
                return NextResponse.json(
                    { error: translatorFor(locale, "sources.server.errors")("folderEditDenied") },
                    { status: 403 }
                );
            }

            // Parse and validate the GitHub URL. SSRF note: parseGitHubUrl
            // rejects any hostname other than (www.)github.com, and the
            // download itself is pinned to https://api.github.com — the
            // user-supplied URL only contributes owner/repo path segments.
            let parsed;
            try {
                parsed = parseGitHubUrl(repoUrl);
            } catch (err) {
                return NextResponse.json(
                    {
                        error: t("invalidGithubUrl"),
                        details: errorDetail(err),
                    },
                    { status: 400 }
                );
            }

            const { owner, repo } = parsed;

            console.log(
                `[GitHubRepoUpload] Request: ${owner}/${repo}` +
                    `${branch ? `@${branch}` : ""}, user=${ctx.data.authUserId}`
            );

            // A token pasted into the form wins; otherwise the workspace's
            // GitHub connection covers private repos without pasting anything.
            const effectiveToken =
                accessToken ?? (await getCompanyAccessToken(ctx.data.companyId, "github"));

            // Download the repository as a ZIP
            const zipBuffer = await downloadGitHubRepoZip(
                owner,
                repo,
                branch,
                effectiveToken ?? undefined
            );

            const filename = `${owner}-${repo}.zip`;

            console.log(
                `[GitHubRepoUpload] Downloaded ${(zipBuffer.length / 1024 / 1024).toFixed(1)}MB, ` +
                    `storing as ${filename}`
            );

            // Store the ZIP in blob storage
            const blob = await putFile({
                filename,
                data: zipBuffer,
                contentType: "application/zip",
            });

            // Trigger the document processing pipeline
            const uploadResult = await processDocumentUpload({
                user: {
                    userId: ctx.data.authUserId,
                    companyId: ctx.data.companyId,
                },
                documentName: `${owner}/${repo}`,
                rawDocumentUrl: blob.url,
                creationKey:
                    owner && repo
                        ? `github:${owner}/${repo}@${branch ?? "default"}`
                        : `upload:${blob.url}`,
                requestUrl: request.url,
                category,
                explicitStorageType: "s3",
                mimeType: "application/zip",
                originalFilename: filename,
            });
            await recordUpload(ctx.data, uploadResult);

            console.log(
                `[GitHubRepoUpload] Pipeline triggered: jobId=${uploadResult.jobId}, ` +
                    `docId=${uploadResult.document.id}`
            );

            return NextResponse.json(
                {
                    success: true,
                    jobId: uploadResult.jobId,
                    eventIds: uploadResult.eventIds,
                    message: t("repoIndexing", { repo: `${owner}/${repo}` }),
                    document: uploadResult.document,
                    repo: { owner, repo, branch: branch ?? "default" },
                },
                { status: 202 }
            );
        } catch (error) {
            if (error instanceof GitHubRepoNotFoundError) {
                return NextResponse.json({ error: wordCopy(error.copy, locale) }, { status: 404 });
            }

            if (error instanceof GitHubAuthError) {
                return NextResponse.json({ error: wordCopy(error.copy, locale) }, { status: 403 });
            }

            if (error instanceof GitHubRateLimitError) {
                return NextResponse.json({ error: wordCopy(error.copy, locale) }, { status: 429 });
            }

            // processDocumentUpload authorizes the internal file reference and
            // throws with its own status (404 foreign file / 503 unconfigured);
            // a generic 500 would hide an operator-fixable condition.
            if (error instanceof UploadAuthorizationError) {
                return NextResponse.json(
                    { error: wordOr(error.copy, error.message, locale) },
                    { status: error.status }
                );
            }

            console.error("[GitHubRepoUpload] Error:", error);
            return NextResponse.json(
                {
                    error: t("githubIndexFailed"),
                    details: errorDetail(error),
                },
                { status: 500 }
            );
        }
    });
}
