/**
 * Obsidian vault import.
 *
 * GET  — the vaults the caller has imported here (name, notes, last import),
 *        so the panel can offer to refresh one.
 * POST — one batch of notes from a vault the browser is reading. Notes that
 *        did not change since the last import are skipped; the rest go
 *        through the normal ingestion pipeline into `Obsidian/<vault>`, a
 *        folder only the importer can see until they share it.
 *
 * A vault is one person's notes, so the gate is `documents.upload` — the
 * same as adding any file — not `connectors.manage`.
 */

import { z } from "zod";

import { requestTranslator } from "~/i18n/server";
import { createForbiddenError, createSuccessResponse, handleApiError } from "~/lib/api-utils";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { validateRequestBody } from "~/lib/validation";
import { importVaultBatch } from "~/server/services/connectors/obsidian/import-service";
import { listImportedVaults } from "~/server/services/connectors/obsidian/sink";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Mirrors the panel's batching: a batch stays well under the 10 MB proxied-body limit. */
const MAX_NOTES_PER_BATCH = 200;
const MAX_NOTE_CHARS = 2 * 1024 * 1024;

const BatchSchema = z.object({
    vault: z.string().trim().min(1).max(120),
    notes: z
        .array(
            z.object({
                path: z.string().min(1).max(1024),
                text: z.string().max(MAX_NOTE_CHARS),
                modifiedAt: z.string().max(64).nullish(),
            })
        )
        .min(1)
        .max(MAX_NOTES_PER_BATCH),
    force: z.boolean().optional(),
});

export async function GET(request: Request) {
    return withRateLimit(request, RateLimitPresets.permissive, async () => {
        try {
            const context = await requireWorkspaceContext();
            if (!context.success) return context.response;
            const vaults = await listImportedVaults(context.data.companyId, context.data.userPk);
            return createSuccessResponse({ vaults });
        } catch (error) {
            return handleApiError(error, request);
        }
    });
}

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

            const body = await validateRequestBody(request, BatchSchema);
            if (!body.success) return body.response;

            const { folder, report } = await importVaultBatch({
                owner: { companyId: ctx.companyId, userPk: ctx.userPk, authUserId: ctx.authUserId },
                vaultName: body.data.vault,
                notes: body.data.notes,
                force: body.data.force,
                requestUrl: request.url,
            });

            return createSuccessResponse({
                folder,
                received: report.discovered,
                stored: report.stored.length,
                unchanged: report.skipped.filter(skip => skip.reason === "unchanged").length,
                skipped: report.skipped
                    .filter(skip => skip.reason !== "unchanged")
                    .map(skip => ({ path: skip.sourceId, reason: skip.reason })),
                failed: report.failed.map(fail => ({ path: fail.sourceId, error: fail.error })),
            });
        } catch (error) {
            return handleApiError(error, request);
        }
    });
}
