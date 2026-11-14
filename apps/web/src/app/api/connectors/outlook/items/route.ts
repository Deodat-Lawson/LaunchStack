/**
 * The caller's Outlook sync scope: the mail folders and searches whose
 * conversations get synced. POST adds (adding a folder again converges on
 * its row), DELETE removes by scope row id. Removing a folder keeps the
 * documents it already produced.
 */

import { z } from "zod";

import { requestTranslator } from "~/i18n/server";
import { V } from "~/i18n/validation";
import { createSuccessResponse, handleApiError } from "~/lib/api-utils";
import { validateRequestBody } from "~/lib/validation";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import {
    requireOutlookWriter,
    requireOwnActiveOutlookConnection,
} from "~/server/services/connectors/outlook/guard";
import { addScope, listScope, removeScope } from "~/server/services/connectors/outlook/store";

export const runtime = "nodejs";

/** Longest folder id or search the scope table holds (`outlook_sync_scope.value`). */
const OUTLOOK_SCOPE_VALUE_MAX = 512;

/**
 * Graph mail-folder ids are URL-safe base64 (immutable ids) or classic
 * base64 (`+`, `/`, `=`). Nothing else is ever sent on to Graph as an id.
 */
const OUTLOOK_FOLDER_ID_PATTERN = /^[A-Za-z0-9_\-+/=]+$/;

const AddItemsSchema = z.object({
    items: z
        .array(
            z.discriminatedUnion("kind", [
                z.object({
                    kind: z.literal("folder"),
                    value: z
                        .string()
                        .trim()
                        .min(1)
                        .max(OUTLOOK_SCOPE_VALUE_MAX)
                        .regex(OUTLOOK_FOLDER_ID_PATTERN, V.notOutlookFolder),
                    name: z.string().trim().min(1).max(512),
                }),
                z.object({
                    kind: z.literal("query"),
                    value: z.string().trim().min(2).max(OUTLOOK_SCOPE_VALUE_MAX),
                    name: z.string().trim().max(512).optional(),
                }),
            ])
        )
        .min(1)
        .max(50),
});

const RemoveItemsSchema = z.object({
    ids: z.array(z.string().regex(/^\d+$/)).min(1).max(200),
});

function serializeScope(rows: Awaited<ReturnType<typeof listScope>>) {
    return rows.map(row => ({
        id: row.id.toString(),
        kind: row.kind,
        value: row.value,
        name: row.name,
    }));
}

export async function GET(request: Request) {
    return withRateLimit(request, RateLimitPresets.permissive, async () => {
        try {
            const guard = await requireOutlookWriter();
            if (!guard.ok) return guard.response;
            const own = await requireOwnActiveOutlookConnection(guard.ctx);
            if (!own.ok) return own.response;

            return createSuccessResponse({
                scope: serializeScope(await listScope(own.connection.id)),
            });
        } catch (error) {
            return handleApiError(error, request);
        }
    });
}

export async function POST(request: Request) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const guard = await requireOutlookWriter();
            if (!guard.ok) return guard.response;
            const own = await requireOwnActiveOutlookConnection(guard.ctx);
            if (!own.ok) return own.response;

            const body = await validateRequestBody(request, AddItemsSchema);
            if (!body.success) return body.response;

            await addScope(
                own.connection.id,
                body.data.items.map(item => {
                    const trimmed = item.name?.trim() ?? "";
                    return {
                        kind: item.kind,
                        value: item.value,
                        name: trimmed.length > 0 ? trimmed : item.value,
                    };
                })
            );

            const scope = await listScope(own.connection.id);
            return createSuccessResponse(
                { scope: serializeScope(scope) },
                requestTranslator(request, "sources.server.outlook")("itemsAdded", {
                    count: body.data.items.length,
                })
            );
        } catch (error) {
            return handleApiError(error, request);
        }
    });
}

export async function DELETE(request: Request) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const guard = await requireOutlookWriter();
            if (!guard.ok) return guard.response;
            const own = await requireOwnActiveOutlookConnection(guard.ctx);
            if (!own.ok) return own.response;

            const body = await validateRequestBody(request, RemoveItemsSchema);
            if (!body.success) return body.response;

            const removed = await removeScope(
                own.connection.id,
                body.data.ids.map(id => BigInt(id))
            );
            const scope = await listScope(own.connection.id);
            return createSuccessResponse(
                { removed, scope: serializeScope(scope) },
                requestTranslator(request, "sources.server.outlook")("selectionUpdated")
            );
        } catch (error) {
            return handleApiError(error, request);
        }
    });
}
