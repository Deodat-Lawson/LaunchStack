/**
 * The caller's Gmail sync scope — the labels and searches whose threads get
 * synced. POST adds (re-adding a label converges), DELETE removes by scope
 * row id. Removing a label keeps the documents it already produced.
 */

import { z } from "zod";

import { createSuccessResponse, handleApiError } from "~/lib/api-utils";
import { validateRequestBody } from "~/lib/validation";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import {
    requireGmailWriter,
    requireOwnActiveGmailConnection,
} from "~/server/services/connectors/gmail/guard";
import { addScope, listScope, removeScope } from "~/server/services/connectors/gmail/store";

export const runtime = "nodejs";

const AddItemsSchema = z.object({
    items: z
        .array(
            z.discriminatedUnion("kind", [
                z.object({
                    kind: z.literal("label"),
                    value: z
                        .string()
                        .trim()
                        .min(1)
                        .max(128)
                        .regex(/^[A-Za-z0-9_\-]+$/, "Not a Gmail label id"),
                    name: z.string().trim().min(1).max(512),
                }),
                z.object({
                    kind: z.literal("query"),
                    value: z.string().trim().min(2).max(512),
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
            const guard = await requireGmailWriter();
            if (!guard.ok) return guard.response;
            const own = await requireOwnActiveGmailConnection(guard.ctx);
            if (!own.ok) return own.response;

            return createSuccessResponse({
                scope: serializeScope(await listScope(own.connection.id)),
            });
        } catch (error) {
            return handleApiError(error);
        }
    });
}

export async function POST(request: Request) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const guard = await requireGmailWriter();
            if (!guard.ok) return guard.response;
            const own = await requireOwnActiveGmailConnection(guard.ctx);
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
                `${body.data.items.length} item(s) added.`
            );
        } catch (error) {
            return handleApiError(error);
        }
    });
}

export async function DELETE(request: Request) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const guard = await requireGmailWriter();
            if (!guard.ok) return guard.response;
            const own = await requireOwnActiveGmailConnection(guard.ctx);
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
                "Selection updated. Already-imported emails were kept."
            );
        } catch (error) {
            return handleApiError(error);
        }
    });
}
