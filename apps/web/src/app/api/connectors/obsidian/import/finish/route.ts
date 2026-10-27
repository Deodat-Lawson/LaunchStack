/**
 * The last call of an Obsidian vault import: every note path the vault has
 * now. Notes imported from this vault before that are no longer in it are
 * flagged missing (kept, never deleted — someone may have cited them).
 */

import { z } from "zod";

import { requestTranslator } from "~/i18n/server";
import { createForbiddenError, createSuccessResponse, handleApiError } from "~/lib/api-utils";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { validateRequestBody } from "~/lib/validation";
import { finishVaultImport } from "~/server/services/connectors/obsidian/import-service";

export const runtime = "nodejs";

const FinishSchema = z.object({
    vault: z.string().trim().min(1).max(120),
    paths: z.array(z.string().min(1).max(1024)).max(50_000),
});

export async function POST(request: Request) {
    return withRateLimit(request, RateLimitPresets.standard, async () => {
        try {
            const context = await requireWorkspaceContext();
            if (!context.success) return context.response;
            const ctx = context.data;
            if (!ctx.can("documents.upload")) {
                return createForbiddenError(
                    requestTranslator(request, "sources.server.connectors")("obsidianNeedsUpload")
                );
            }

            const body = await validateRequestBody(request, FinishSchema);
            if (!body.success) return body.response;

            const missing = await finishVaultImport({
                owner: { companyId: ctx.companyId, userPk: ctx.userPk, authUserId: ctx.authUserId },
                vaultName: body.data.vault,
                paths: body.data.paths,
            });
            return createSuccessResponse({ missing });
        } catch (error) {
            return handleApiError(error, request);
        }
    });
}
