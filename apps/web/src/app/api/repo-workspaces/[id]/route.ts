/**
 * Disconnect a repo workspace: the row goes (cascading requests, bundles,
 * and jobs), then the mirror and worktrees are removed best-effort — disk
 * cleanup must never be the reason a disconnect fails.
 */

import { deleteRepoWorkspace } from "@launchstack/pipelines/repo-workspace/db";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import {
    createForbiddenError,
    createNotFoundError,
    createSuccessResponse,
    handleApiError,
} from "~/lib/api-utils";
import { removeWorkspaceDiskState } from "~/server/services/repo-workspace";

export const runtime = "nodejs";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        if (!ctx.data.can("connectors.manage")) {
            return createForbiddenError("Only management roles can disconnect repositories");
        }

        const { id } = await params;
        const companyId = BigInt(ctx.data.companyId);
        const deleted = await deleteRepoWorkspace(id, companyId);
        if (!deleted) return createNotFoundError("Repository workspace");

        await removeWorkspaceDiskState({ id: deleted.id, companyId: deleted.companyId });
        return createSuccessResponse({ disconnected: true });
    } catch (error) {
        return handleApiError(error);
    }
}
