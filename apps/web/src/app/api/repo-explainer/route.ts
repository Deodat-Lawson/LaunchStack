import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/server/db/index";
import { users } from "@launchstack/core/db/schema";
import { env } from "~/env";
import {
  parseGitHubUrl,
  getRepoContext,
} from "~/lib/repo-explainer";
import { explainRepoWithLlm } from "~/lib/repo-explainer/llm";
import { extractMermaidCode, extractSummary } from "~/lib/repo-explainer/prompts";
import type { RepoInfo, RepoExplanationRequest } from "~/lib/repo-explainer/types";
import { validateRequestBody } from "~/lib/validation";
import {
  createSuccessResponse,
  createUnauthorizedError,
  createForbiddenError,
  createValidationError,
  handleApiError,
} from "~/lib/api-utils";

export const runtime = "nodejs";
export const maxDuration = 120;

const DIAGRAM_TYPES = ["architecture", "sequence", "class", "er", "component"] as const;

const RepoExplainerRequestSchema = z.object({
  url: z.string().min(1, "GitHub URL is required"),
  instructions: z.string().optional(),
  diagramType: z.enum(DIAGRAM_TYPES).optional(),
});

async function validateRepoAccess(
  owner: string,
  repo: string,
  githubToken?: string | null,
): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
      },
      cache: "no-store",
    });
    if (res.status === 404) {
      return githubToken
        ? `Repository '${owner}/${repo}' not found or token does not have access.`
        : `Repository '${owner}/${repo}' not found or is private. Add a GitHub token with access for private repos.`;
    }
    if (res.status === 403) {
      return githubToken
        ? `Access forbidden for '${owner}/${repo}'. Check token permissions and repo access.`
        : `Repository '${owner}/${repo}' is private or access is forbidden. Add a GitHub token.`;
    }
    if (res.status === 401) {
      return "Invalid GitHub token.";
    }
    if (res.status === 429) {
      return "Too many requests to GitHub. Please try again later.";
    }
    if (!res.ok) {
      return `Error accessing repository '${owner}/${repo}' (HTTP ${res.status}).`;
    }
    return null;
  } catch (error) {
    console.error("[repo-explainer] validateRepoAccess error:", error);
    return "Could not validate repository on GitHub. Please try again.";
  }
}

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return createUnauthorizedError("Authentication required. Please sign in to continue.");
    }

    const [userInfo] = await db
      .select()
      .from(users)
      .where(eq(users.userId, userId));

    if (!userInfo) {
      return createUnauthorizedError("User account not found.");
    }

    if (userInfo.role !== "employer" && userInfo.role !== "owner") {
      return createForbiddenError("Insufficient permissions. Only employers and owners can use the repo explainer.");
    }

    const validation = await validateRequestBody(request, RepoExplainerRequestSchema);
    if (!validation.success) {
      return validation.response;
    }

    const { url, instructions, diagramType } = validation.data as RepoExplanationRequest;

    const parsedUrl = parseGitHubUrl(url);
    if (!parsedUrl) {
      return createValidationError(
        "Invalid GitHub URL format. Please use: https://github.com/owner/repo or owner/repo",
      );
    }

    const { owner, repo } = parsedUrl;
    const githubToken =
      request.headers.get("X-GitHub-Token") ||
      env.server.GITHUB_TOKEN ||
      null;

    const validationError = await validateRepoAccess(owner, repo, githubToken);
    if (validationError) {
      return createValidationError(validationError);
    }

    const repoInfo: RepoInfo = { owner, repoName: repo };

    const contextResult = await getRepoContext(repoInfo, null, githubToken, undefined, diagramType);
    if (!contextResult.success) {
      return handleApiError(
        new Error(contextResult.error ?? "Failed to fetch repository context"),
      );
    }

    const explanationResult = await explainRepoWithLlm(
      repoInfo,
      contextResult.context,
      instructions,
      diagramType,
    );

    if (!explanationResult.success) {
      return handleApiError(
        new Error(explanationResult.error ?? "Failed to generate explanation"),
      );
    }

    const timestamp = new Date().toISOString();
    const repoFullName = `${owner}/${repo}`;
    const summary = extractSummary(explanationResult.explanation);
    const mermaidCode = extractMermaidCode(explanationResult.explanation);

    return createSuccessResponse({
      explanation: explanationResult.explanation,
      repo: repoFullName,
      summary,
      mermaidCode,
      umlJson: {
        format: "mermaid",
        repo: repoFullName,
        summary,
        diagram: mermaidCode,
        generatedAt: timestamp,
      },
      timestamp,
    });
  } catch (error) {
    console.error("[repo-explainer] POST error:", error);
    return handleApiError(error);
  }
}
