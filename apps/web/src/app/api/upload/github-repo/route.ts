/**
 * GitHub Repo Upload API Route
 *
 * Accepts a GitHub repository URL, downloads it as a ZIP, stores it,
 * and triggers the existing document processing pipeline.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { users } from "@launchstack/core/db/schema";
import { processDocumentUpload } from "~/server/services/document-upload";
import {
    parseGitHubUrl,
    downloadGitHubRepoZip,
    GitHubRepoNotFoundError,
    GitHubAuthError,
    GitHubRateLimitError,
} from "~/server/services/github-repo";
import { putFile } from "~/server/storage/vercel-blob";
import { validateRequestBody } from "~/lib/validation";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";

const GitHubRepoSchema = z.object({
    userId: z.string().min(1, "User ID is required"),
    repoUrl: z.string().url("A valid URL is required"),
    branch: z.string().optional(),
    accessToken: z.string().optional(),
    category: z.string().optional(),
});

export async function POST(request: Request) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const validation = await validateRequestBody(request, GitHubRepoSchema);
            if (!validation.success) {
                return validation.response;
            }

            const { userId, repoUrl, branch, accessToken, category } =
                validation.data;

            // Parse and validate the GitHub URL
            let parsed;
            try {
                parsed = parseGitHubUrl(repoUrl);
            } catch (err) {
                return NextResponse.json(
                    {
                        error: "Invalid GitHub URL",
                        details:
                            err instanceof Error ? err.message : "Unknown error",
                    },
                    { status: 400 },
                );
            }

            const { owner, repo } = parsed;

            console.log(
                `[GitHubRepoUpload] Request: ${owner}/${repo}` +
                    `${branch ? `@${branch}` : ""}, user=${userId}`,
            );

            // Look up user
            const [userInfo] = await db
                .select()
                .from(users)
                .where(eq(users.userId, userId));

            if (!userInfo) {
                return NextResponse.json(
                    { error: "Invalid user" },
                    { status: 400 },
                );
            }

            // Download the repository as a ZIP
            const zipBuffer = await downloadGitHubRepoZip(
                owner,
                repo,
                branch,
                accessToken,
            );

            const filename = `${owner}-${repo}.zip`;

            console.log(
                `[GitHubRepoUpload] Downloaded ${(zipBuffer.length / 1024 / 1024).toFixed(1)}MB, ` +
                    `storing as ${filename}`,
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
                    userId,
                    companyId: userInfo.companyId,
                },
                documentName: `${owner}/${repo}`,
                rawDocumentUrl: blob.url,
                requestUrl: request.url,
                category,
                explicitStorageType: "s3",
                mimeType: "application/zip",
                originalFilename: filename,
            });

            console.log(
                `[GitHubRepoUpload] Pipeline triggered: jobId=${uploadResult.jobId}, ` +
                    `docId=${uploadResult.document.id}`,
            );

            return NextResponse.json(
                {
                    success: true,
                    jobId: uploadResult.jobId,
                    eventIds: uploadResult.eventIds,
                    message: `Repository ${owner}/${repo} is being indexed`,
                    document: uploadResult.document,
                    repo: { owner, repo, branch: branch ?? "default" },
                },
                { status: 202 },
            );
        } catch (error) {
            if (error instanceof GitHubRepoNotFoundError) {
                return NextResponse.json(
                    { error: error.message },
                    { status: 404 },
                );
            }

            if (error instanceof GitHubAuthError) {
                return NextResponse.json(
                    { error: error.message },
                    { status: 403 },
                );
            }

            if (error instanceof GitHubRateLimitError) {
                return NextResponse.json(
                    { error: error.message },
                    { status: 429 },
                );
            }

            console.error("[GitHubRepoUpload] Error:", error);
            return NextResponse.json(
                {
                    error: "Failed to index GitHub repository",
                    details:
                        error instanceof Error ? error.message : "Unknown error",
                },
                { status: 500 },
            );
        }
    });
}
