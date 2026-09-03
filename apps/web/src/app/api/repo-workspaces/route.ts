/**
 * Repo workspaces — connect (stage A) and list. Connecting creates the
 * workspace row, opens the first sync request, and hands the actual git work
 * to the worker; this route does no network fetching itself.
 */

import { z } from "zod";

import { parseGitHubUrl } from "@launchstack/pipelines/repo-explainer";
import {
    createRepoWorkspace,
    listRepoWorkspaces,
    requestSync,
} from "@launchstack/pipelines/repo-workspace/db";
import type { RepoWorkspaceRow } from "@launchstack/pipelines/repo-workspace/schema";

import { inngest } from "~/server/inngest/client";
import { isManagementRole, requireWorkspaceContext } from "~/lib/require-workspace-context";
import { validateRequestBody } from "~/lib/validation";
import {
    createForbiddenError,
    createSuccessResponse,
    createValidationError,
    handleApiError,
} from "~/lib/api-utils";

export const runtime = "nodejs";
export const maxDuration = 30;

const ConnectRepoSchema = z.object({
    /** Full GitHub URL or `owner/repo`. */
    url: z.string().min(1).max(500),
});

function serializeWorkspace(row: RepoWorkspaceRow) {
    return {
        id: row.id,
        provider: row.provider,
        owner: row.owner,
        repo: row.repo,
        status: row.status,
        headSha: row.headSha,
        lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
        lastErrorMessage: row.lastErrorMessage,
        diskBytes: row.diskBytes,
        createdAt: row.createdAt.toISOString(),
    };
}

export async function POST(request: Request) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        if (!isManagementRole(ctx.data.role)) {
            return createForbiddenError("Only management roles can connect repositories");
        }

        const validation = await validateRequestBody(request, ConnectRepoSchema);
        if (!validation.success) return validation.response;

        const parsed = parseGitHubUrl(validation.data.url);
        if (!parsed) {
            return createValidationError(
                'Invalid GitHub URL — expected "https://github.com/owner/repo" or "owner/repo"'
            );
        }

        const { created, workspace } = await createRepoWorkspace({
            companyId: BigInt(ctx.data.companyId),
            createdByUserId: ctx.data.authUserId,
            ref: { provider: "github", owner: parsed.owner, repo: parsed.repo },
        });

        // Idempotent: reconnecting an existing workspace just nudges a sync.
        await requestSync(workspace.id, "connect");
        await inngest.send({
            name: "repo-workspace/sync.requested",
            data: { workspaceId: workspace.id },
        });

        return createSuccessResponse(
            { workspace: serializeWorkspace(workspace), created },
            undefined,
            created ? 201 : 200
        );
    } catch (error) {
        return handleApiError(error);
    }
}

export async function GET() {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const workspaces = await listRepoWorkspaces(BigInt(ctx.data.companyId));
        return createSuccessResponse({ workspaces: workspaces.map(serializeWorkspace) });
    } catch (error) {
        return handleApiError(error);
    }
}
