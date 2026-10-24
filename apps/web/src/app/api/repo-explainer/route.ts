import { z } from "zod";
import { env } from "~/env";
import {
    parseGitHubUrl,
    getRepoContext,
    explainRepoWithLlm,
    extractMermaidCode,
    extractSummary,
    type RepoInfo,
    type RepoExplanationRequest,
} from "@launchstack/pipelines/repo-explainer";
import { validateRequestBody } from "~/lib/validation";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";
import { getCompanyAccessToken } from "~/server/services/connectors/connection-store";
import { createSuccessResponse, createValidationError, handleApiError } from "~/lib/api-utils";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { V } from "~/i18n/validation";

type RepoTranslator = ReturnType<typeof translatorFor<"agents.server.repoExplainer">>;

export const runtime = "nodejs";
export const maxDuration = 120;

const DIAGRAM_TYPES = ["architecture", "sequence", "class", "er", "component"] as const;

const RepoExplainerRequestSchema = z.object({
    url: z.string().min(1, V.githubUrlRequired),
    instructions: z.string().optional(),
    diagramType: z.enum(DIAGRAM_TYPES).optional(),
});

async function validateRepoAccess(
    owner: string,
    repo: string,
    githubToken: string | null | undefined,
    t: RepoTranslator
): Promise<string | null> {
    const name = `${owner}/${repo}`;
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
                ? t("notFoundWithToken", { repo: name })
                : t("notFoundPublic", { repo: name });
        }
        if (res.status === 403) {
            return githubToken
                ? t("forbiddenWithToken", { repo: name })
                : t("forbiddenPublic", { repo: name });
        }
        if (res.status === 401) {
            return t("invalidToken");
        }
        if (res.status === 429) {
            return t("rateLimited");
        }
        if (!res.ok) {
            return t("accessError", { repo: name, status: String(res.status) });
        }
        return null;
    } catch (error) {
        console.error("[repo-explainer] validateRepoAccess error:", error);
        return t("validateFailed");
    }
}

export async function POST(request: Request) {
    const t = translatorFor(localeOfRequest(request), "agents.server.repoExplainer");
    try {
        // Reads the workspace's GitHub connection and spends LLM budget on the
        // company's behalf — a settings-tier action.
        const ctx = await requireWorkspacePermission("settings.manage");
        if (!ctx.success) return ctx.response;

        return await withWorkspaceChatModels(ctx.data.companyId, "repoExplainer", async () => {
            const validation = await validateRequestBody(request, RepoExplainerRequestSchema);
            if (!validation.success) {
                return validation.response;
            }

            const { url, instructions, diagramType } = validation.data as RepoExplanationRequest;

            const parsedUrl = parseGitHubUrl(url);
            if (!parsedUrl) {
                return createValidationError(t("invalidUrl"));
            }

            const { owner, repo } = parsedUrl;
            // `?? ""` first so the `||` fallthrough (which must also skip empty
            // strings, e.g. an empty header or env var) operates on plain strings.
            // Precedence: a token the user typed for this request, then the
            // workspace's GitHub connection, then the deployment-global PAT.
            const githubToken =
                (request.headers.get("X-GitHub-Token") ?? "") ||
                ((await getCompanyAccessToken(ctx.data.companyId, "github")) ?? "") ||
                (env.server.GITHUB_TOKEN ?? "") ||
                null;

            const validationError = await validateRepoAccess(owner, repo, githubToken, t);
            if (validationError) {
                return createValidationError(validationError);
            }

            const repoInfo: RepoInfo = { owner, repoName: repo };

            const contextResult = await getRepoContext(
                repoInfo,
                null,
                githubToken,
                undefined,
                diagramType
            );
            if (!contextResult.success) {
                // English on purpose: handleApiError picks its sentence by reading this one.
                return handleApiError(
                    new Error(contextResult.error ?? "Failed to fetch repository context"),
                    request
                );
            }

            const explanationResult = await explainRepoWithLlm(
                repoInfo,
                contextResult.context,
                instructions,
                diagramType
            );

            if (!explanationResult.success) {
                return handleApiError(
                    new Error(explanationResult.error ?? "Failed to generate explanation"),
                    request
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
        });
    } catch (error) {
        console.error("[repo-explainer] POST error:", error);
        return handleApiError(error, request);
    }
}
