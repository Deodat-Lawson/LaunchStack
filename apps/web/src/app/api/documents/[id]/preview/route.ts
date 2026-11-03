/**
 * GET /api/documents/[id]/preview
 *
 * The document rendered to PDF for viewing in place, through the Gotenberg
 * service (ADR-009). The deck viewer shows a .pptx this way: the slides as
 * PowerPoint lays them out, with nothing leaving the deployment.
 *
 * Unlike `/api/documents/pdf`, which renders for download every time, this
 * keeps the result per document version. The response carries a version
 * ETag with `no-cache`, so a reader's browser asks again and gets a 304
 * until a new version is applied; the server keeps the bytes in memory
 * (`pdfPreviewCache`) so the first reader of a version pays for the render
 * and the next does not. Without a Gotenberg deployment the route returns a
 * typed 503, which the viewer shows beside a download link.
 */

import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import {
    dispositionFilename,
    findOfficeDocument,
    officeFormatRefusal,
    renderOfficeDocumentPdf,
    type OfficeDocumentRow,
    type OfficePdfFailure,
} from "~/server/services/office-pdf";
import { pdfPreviewCache } from "~/server/services/pdf-preview-cache";

export const runtime = "nodejs";
// LibreOffice cold starts plus a large deck can pass the default budget.
export const maxDuration = 60;

interface RouteParams {
    params: Promise<{ id: string }>;
}

function fail(status: number, error: string, message?: string): NextResponse {
    return NextResponse.json({ success: false, error, message }, { status });
}

function failWith(failure: OfficePdfFailure): NextResponse {
    return fail(failure.status, failure.error, failure.message);
}

/**
 * What the preview is keyed by: the version the bytes belong to, or — on a
 * row from before versioning — the stored location, which only a new
 * version ever changes.
 */
export function previewKey(row: Pick<OfficeDocumentRow, "id" | "url" | "currentVersionId">) {
    const version =
        row.currentVersionId !== null
            ? `v${row.currentVersionId}`
            : `u${createHash("sha1").update(row.url).digest("hex").slice(0, 12)}`;
    return `${row.id}:${version}`;
}

export async function GET(request: Request, { params }: RouteParams) {
    const locale = localeOfRequest(request);
    const { id } = await params;
    const documentId = Number(id);
    if (!id || !Number.isInteger(documentId) || documentId <= 0) {
        return fail(
            400,
            "invalid_request",
            translatorFor(locale, "errors.api")("invalidDocumentId")
        );
    }

    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const row = await findOfficeDocument(
        documentId,
        BigInt(ctx.data.companyId),
        await ctx.data.documentScope()
    );
    if (!row) {
        return fail(404, "not_found", translatorFor(locale, "errors.api")("documentNotFound"));
    }

    const refusal = officeFormatRefusal(row, locale);
    if (refusal) return failWith(refusal);

    const key = previewKey(row);
    const etag = `"${key}"`;
    const cacheHeaders = {
        ETag: etag,
        // Revalidate every time: the ETag is the version, so the check is
        // one lookup and a stale copy is never shown after a new version.
        "Cache-Control": "private, no-cache",
    };

    if (request.headers.get("if-none-match") === etag) {
        return new NextResponse(null, { status: 304, headers: cacheHeaders });
    }

    const outcome: { failure?: OfficePdfFailure } = {};
    const pdf = await pdfPreviewCache.getOrRender(key, async () => {
        const result = await renderOfficeDocumentPdf(row, locale);
        if (result.ok) return result.pdf;
        outcome.failure = result;
        return null;
    });

    if (!pdf) {
        // A failure of a render another request started is reported by that
        // request; this one sees only the missing bytes.
        return outcome.failure
            ? failWith(outcome.failure)
            : fail(502, "rendering_failed", translatorFor(locale, "errors.api")("unknownError"));
    }

    const pdfName = row.title.replace(/\.[^.]+$/, "") + ".pdf";

    return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
            ...cacheHeaders,
            "Content-Type": "application/pdf",
            "Content-Length": String(pdf.byteLength),
            "Content-Disposition": `inline; filename="${dispositionFilename(pdfName)}"`,
        },
    });
}
