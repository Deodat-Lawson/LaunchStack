/**
 * POST /api/documents/adeu/apply
 *
 * Applies tracked-change edits and/or review actions to a Word document and
 * writes the result back to storage.
 *
 * Two things this deliberately does not do, both of which the previous
 * apply-edits route did:
 *
 *  1. It never falls back to plain-text substitution. If the editing service
 *     is unreachable the request fails and says so. Silently replacing text
 *     without a tracked change, then reporting success, is the worst possible
 *     outcome in a review flow — the reviewer sees a clean document and has no
 *     idea an AI rewrote it.
 *  2. It sends the whole batch in one call. Resolving ambiguous targets now
 *     happens inside the service, where the document is already parsed, so N
 *     edits cost one round trip instead of 2N.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
    acceptAllChanges,
    processDocumentBatchDetailed,
    rejectAllChanges,
    type DocumentEdit,
    type ReviewAction,
} from "@launchstack/features/adeu";
import { eq } from "drizzle-orm";

import { document } from "@launchstack/core/db/schema";
import { db } from "~/server/db";
import { uploadFile } from "~/lib/storage";
import { validateRequestBody } from "~/lib/validation";
import { DOCX_MIME, adeuErrorResponse, loadDocument } from "../_shared";

export const runtime = "nodejs";

const editSchema = z.object({
    target_text: z.string().min(1),
    new_text: z.string(),
    comment: z.string().optional(),
    match_mode: z.enum(["strict", "first", "all"]).optional(),
});

const actionSchema = z.object({
    action: z.enum(["ACCEPT", "REJECT", "REPLY"]),
    target_id: z.string().min(1),
    text: z.string().optional(),
    comment: z.string().optional(),
});

const ApplySchema = z
    .object({
        documentId: z.number().int().positive(),
        authorName: z.string().min(1).max(120).default("LaunchStack Review"),
        edits: z.array(editSchema).optional(),
        actions: z.array(actionSchema).optional(),
        /** Apply everything that validates and report the rest. */
        partial: z.boolean().default(false),
        /** Bulk operations, which adeu exposes as dedicated calls. */
        resolveAll: z.enum(["accept", "reject"]).optional(),
    })
    .refine(v => Boolean(v.resolveAll) || Boolean(v.edits?.length) || Boolean(v.actions?.length), {
        message: "Provide at least one edit, action, or resolveAll",
    });

export async function POST(request: Request) {
    const validation = await validateRequestBody(request, ApplySchema);
    if (!validation.success) return validation.response;

    const { documentId, edits, actions, resolveAll } = validation.data;
    // The validator infers the schema's *input* type, where defaulted fields
    // are still optional — so the defaults are applied here rather than
    // trusted from the inferred type.
    const authorName = validation.data.authorName ?? "LaunchStack Review";
    const partial = validation.data.partial ?? false;

    const loaded = await loadDocument(documentId);
    if (!loaded.ok) return loaded.response;

    try {
        let modified: Buffer;
        let result: Awaited<ReturnType<typeof processDocumentBatchDetailed>>["result"] | null =
            null;

        if (resolveAll) {
            const blob =
                resolveAll === "accept"
                    ? await acceptAllChanges(loaded.data.bytes)
                    : await rejectAllChanges(loaded.data.bytes);
            modified = Buffer.from(await blob.arrayBuffer());
        } else {
            const response = await processDocumentBatchDetailed(
                loaded.data.bytes,
                {
                    author_name: authorName,
                    edits: edits as DocumentEdit[] | undefined,
                    actions: actions as ReviewAction[] | undefined,
                    partial,
                    self_contained: true,
                },
                { filename: loaded.data.filename }
            );
            modified = Buffer.from(response.document_base64, "base64");
            result = response.result;
        }

        // Store as a new object and repoint the document, rather than
        // overwriting in place: a failed write must never leave a document
        // half-rewritten, and the previous bytes stay recoverable.
        const stored = await uploadFile({
            filename: loaded.data.filename,
            data: modified,
            contentType: DOCX_MIME,
            userId: loaded.userId,
        });

        await db
            .update(document)
            .set({ url: stored.url, updatedAt: new Date() })
            .where(eq(document.id, documentId));

        return NextResponse.json({
            success: true,
            documentId,
            url: stored.url,
            result,
        });
    } catch (err) {
        console.error("[adeu/apply] failed", err);
        return adeuErrorResponse(err);
    }
}
