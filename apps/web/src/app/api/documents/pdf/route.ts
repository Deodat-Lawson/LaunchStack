/**
 * GET /api/documents/pdf?documentId=123
 *
 * Downloads an Office document (DOCX and friends) as a PDF, rendered by the
 * Gotenberg service (ADR-009) through LibreOffice.
 *
 * Like the Word editor's routes, this takes a `documentId` rather than a URL
 * or a blob: the document's location is looked up server-side and scoped to
 * the caller's company, so a client can never point the renderer at an
 * arbitrary object. Without a Gotenberg deployment the route returns a typed
 * 503 — the DOCX download path stays available either way.
 *
 * The rendering itself is shared with `/api/documents/[id]/preview`, which
 * shows the same PDF inline and keeps it per version; a download is rendered
 * fresh each time, since it is asked for once.
 */

import { NextResponse } from "next/server";

import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import {
    dispositionFilename,
    findOfficeDocument,
    renderOfficeDocumentPdf,
} from "~/server/services/office-pdf";

export const runtime = "nodejs";
// LibreOffice cold starts plus a large document can pass the default budget.
export const maxDuration = 60;

function fail(status: number, error: string, message?: string): NextResponse {
    return NextResponse.json({ success: false, error, message }, { status });
}

export async function GET(request: Request) {
    const url = new URL(request.url);
    const raw = url.searchParams.get("documentId");
    const documentId = Number(raw);
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "viewers.server.errors");

    if (!raw || !Number.isInteger(documentId) || documentId <= 0) {
        return fail(400, "invalid_request", t("documentIdRequired"));
    }

    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const row = await findOfficeDocument(
        documentId,
        BigInt(ctx.data.companyId),
        await ctx.data.documentScope()
    );
    if (!row) {
        // Same response whether it does not exist, belongs to another company,
        // or sits in a folder the caller cannot see — the distinction would
        // leak which ids are real.
        return fail(404, "not_found", translatorFor(locale, "errors.api")("documentNotFound"));
    }

    const result = await renderOfficeDocumentPdf(row, locale);
    if (!result.ok) return fail(result.status, result.error, result.message);

    return new NextResponse(new Uint8Array(result.pdf), {
        status: 200,
        headers: {
            "Content-Type": "application/pdf",
            "Content-Length": String(result.pdf.byteLength),
            // The bytes change whenever an edit is applied — a cached
            // copy would ship the pre-edit document.
            "Cache-Control": "no-store",
            "Content-Disposition": `attachment; filename="${dispositionFilename(result.pdfName)}"`,
        },
    });
}
