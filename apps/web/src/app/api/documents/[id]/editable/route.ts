/**
 * The in-app editor's document: GET loads it as editor HTML (or plain
 * text), PUT saves it as a new version. Markdown, plain text and Word files,
 * and Drive-linked Docs — whose save goes to Google Drive first and comes
 * back as a version (see `~/server/services/file-editing/editable`).
 *
 * Both take what replacing a file takes (the versions route's rule):
 * `documents.upload`, the document in the caller's read scope, and edit
 * access to the document itself (ADR-014). A document out of scope reads
 * like a missing one.
 *
 * Every refusal is `{ error: <code>, message: <sentence> }`, the sentence in
 * the caller's language; the editor shows `message`.
 */
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { document } from "@launchstack/store/schema";

import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import {
    FileEditError,
    MAX_SAVE_BYTES,
    loadEditable,
    saveEditable,
    type EditableDocument,
} from "~/server/services/file-editing/editable";
import { canEditDocument } from "~/server/workspace/item-access";

export const runtime = "nodejs";
// A Drive-linked save is a push, a pull and an export: several round trips.
export const maxDuration = 60;

const SaveSchema = z
    .object({
        base: z.string().min(1).max(200),
        html: z.string().optional(),
        text: z.string().optional(),
    })
    .refine(body => (body.html === undefined) !== (body.text === undefined));

type Translator = ReturnType<typeof translatorFor<"fileEditing">>;

function refuse(t: Translator, status: number, error: string, key: string, values = {}) {
    return NextResponse.json(
        { error, message: t(`server.${key}` as Parameters<Translator>[0], values) },
        { status }
    );
}

/** The caller and the document they may edit, or the response refusing them. */
async function authorize(
    request: Request,
    rawId: string,
    t: Translator
): Promise<
    { ok: true; userId: string; doc: EditableDocument } | { ok: false; response: NextResponse }
> {
    const documentId = Number(rawId);
    if (!Number.isInteger(documentId) || documentId <= 0) {
        return { ok: false, response: refuse(t, 400, "invalid_id", "invalidDocumentId") };
    }

    const ctx = await requireWorkspacePermission("documents.upload");
    if (!ctx.success) return { ok: false, response: ctx.response };

    const [doc] = await db
        .select({
            id: document.id,
            companyId: document.companyId,
            title: document.title,
            category: document.category,
            url: document.url,
            mimeType: document.mimeType,
            fileType: document.fileType,
            currentVersionId: document.currentVersionId,
            ocrMetadata: document.ocrMetadata,
        })
        .from(document)
        .where(
            and(
                eq(document.id, documentId),
                scopedDocumentWhere(ctx.data.companyId, await ctx.data.documentScope())
            )
        );
    if (!doc) return { ok: false, response: refuse(t, 404, "not_found", "notFound") };

    if (!(await canEditDocument(ctx.data, { id: doc.id, category: doc.category }))) {
        return { ok: false, response: refuse(t, 403, "edit_denied", "editDenied") };
    }

    return {
        ok: true,
        userId: ctx.data.authUserId,
        doc: {
            ...doc,
            companyId: BigInt(doc.companyId),
            currentVersionId: doc.currentVersionId === null ? null : BigInt(doc.currentVersionId),
        },
    };
}

function failure(
    err: unknown,
    t: Translator,
    where: string,
    action: "open" | "save"
): NextResponse {
    if (err instanceof FileEditError) {
        return refuse(t, err.status, err.code, err.key, err.values);
    }
    console.error(`[editable] ${where} failed:`, err);
    // Say what failed: a file that could not be opened is not a failed save.
    return action === "open"
        ? refuse(t, 500, "open_failed", "openFailed")
        : refuse(t, 500, "save_failed", "saveFailed");
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
    const t = translatorFor(localeOfRequest(request), "fileEditing");
    return withRateLimit(request, RateLimitPresets.permissive, async () => {
        const { id } = await context.params;
        const auth = await authorize(request, id, t);
        if (!auth.ok) return auth.response;
        try {
            const { noticeKey, ...payload } = await loadEditable(auth.doc);
            return NextResponse.json({
                ...payload,
                notice: noticeKey ? t(`server.${noticeKey}`) : null,
            });
        } catch (err) {
            return failure(err, t, `GET doc=${auth.doc.id}`, "open");
        }
    });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
    const t = translatorFor(localeOfRequest(request), "fileEditing");
    // Every save is a version and a re-index, but people save often: the
    // standard bucket, not the strict one uploads use.
    return withRateLimit(request, RateLimitPresets.standard, async () => {
        const { id } = await context.params;
        const auth = await authorize(request, id, t);
        if (!auth.ok) return auth.response;

        const declared = Number(request.headers.get("content-length") ?? "0");
        if (declared > MAX_SAVE_BYTES) {
            return refuse(t, 413, "too_large", "tooLarge", {
                mb: String(MAX_SAVE_BYTES / (1024 * 1024)),
            });
        }
        const raw = await request.text().catch(() => "");
        if (Buffer.byteLength(raw, "utf8") > MAX_SAVE_BYTES) {
            return refuse(t, 413, "too_large", "tooLarge", {
                mb: String(MAX_SAVE_BYTES / (1024 * 1024)),
            });
        }
        let body: unknown;
        try {
            body = JSON.parse(raw);
        } catch {
            return refuse(t, 400, "invalid", "invalid");
        }
        const parsed = SaveSchema.safeParse(body);
        if (!parsed.success) return refuse(t, 400, "invalid", "invalid");

        try {
            const result = await saveEditable({
                doc: auth.doc,
                base: parsed.data.base,
                html: parsed.data.html,
                text: parsed.data.text,
                userId: auth.userId,
                requestUrl: request.url,
            });
            return NextResponse.json({ success: true, ...result });
        } catch (err) {
            return failure(err, t, `PUT doc=${auth.doc.id}`, "save");
        }
    });
}
