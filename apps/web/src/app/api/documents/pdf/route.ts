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
 */

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import {
    OFFICE_CONVERTIBLE_EXTENSIONS,
    RenderingConfigError,
    RenderingServiceError,
} from "@launchstack/export-engine";
import { document } from "@launchstack/store/schema";
import { db } from "~/server/db";
import { getGotenbergClient } from "~/server/rendering";
import { fetchFile } from "~/lib/storage";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

export const runtime = "nodejs";
// LibreOffice cold starts plus a large document can pass the default budget.
export const maxDuration = 60;

function fail(status: number, error: string, message?: string): NextResponse {
    return NextResponse.json({ success: false, error, message }, { status });
}

/** The extension Gotenberg's import filter will be picked from. */
function documentExtension(fileType: string | null, title: string): string {
    const fromType = (fileType ?? "").toLowerCase().replace(/^\./, "");
    if (fromType) return fromType;
    const dot = title.lastIndexOf(".");
    return dot === -1 ? "" : title.slice(dot + 1).toLowerCase();
}

export async function GET(request: Request) {
    const url = new URL(request.url);
    const raw = url.searchParams.get("documentId");
    const documentId = Number(raw);

    if (!raw || !Number.isInteger(documentId) || documentId <= 0) {
        return fail(400, "invalid_request", "documentId is required");
    }

    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    const companyId = BigInt(ctx.data.companyId);

    const [row] = await db
        .select({
            id: document.id,
            title: document.title,
            url: document.url,
            fileType: document.fileType,
        })
        .from(document)
        .where(and(eq(document.id, documentId), eq(document.companyId, companyId)));

    if (!row) {
        // Same response whether it does not exist or belongs to another
        // company — the distinction would leak which ids are real.
        return fail(404, "not_found", "Document not found");
    }

    const extension = documentExtension(row.fileType, row.title);
    if (!OFFICE_CONVERTIBLE_EXTENSIONS.has(extension)) {
        return fail(
            415,
            "unsupported_type",
            extension === "pdf"
                ? "This document is already a PDF — download it directly."
                : "PDF rendering handles Office documents (Word, Excel, PowerPoint, OpenDocument). This document is a different format."
        );
    }

    const gotenberg = getGotenbergClient();
    if (!gotenberg) {
        return fail(
            503,
            "service_not_configured",
            "The PDF rendering service is not configured. Set GOTENBERG_SERVICE_URL (and its " +
                "basic-auth pair), and make sure the gotenberg service is running."
        );
    }

    let bytes: Buffer;
    try {
        const res = await fetchFile(row.url);
        if (!res.ok) {
            return fail(
                502,
                "fetch_failed",
                `Could not read the document from storage (HTTP ${res.status}).`
            );
        }
        bytes = Buffer.from(await res.arrayBuffer());
    } catch (err) {
        return fail(
            502,
            "fetch_failed",
            err instanceof Error ? err.message : "Could not read the document from storage."
        );
    }

    const sourceName = row.title.toLowerCase().endsWith(`.${extension}`)
        ? row.title
        : `${row.title}.${extension}`;

    try {
        const { pdf } = await gotenberg.officeToPdf({ file: bytes, filename: sourceName });
        const pdfName = sourceName.replace(new RegExp(`\\.${extension}$`, "i"), ".pdf");
        return new NextResponse(new Uint8Array(pdf), {
            status: 200,
            headers: {
                "Content-Type": "application/pdf",
                "Content-Length": String(pdf.byteLength),
                // The bytes change whenever an edit is applied — a cached
                // copy would ship the pre-edit document.
                "Cache-Control": "no-store",
                "Content-Disposition": `attachment; filename="${pdfName.replace(/["\\\r\n]/g, "_")}"`,
            },
        });
    } catch (err) {
        if (err instanceof RenderingConfigError) {
            return fail(415, "unsupported_type", err.message);
        }
        if (err instanceof RenderingServiceError) {
            // 4xx from the service is this document's problem and worth
            // relaying; anything else is an outage.
            const status = err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 502;
            const trace = err.trace ? ` (trace ${err.trace})` : "";
            return fail(status, "rendering_failed", `${err.detail}${trace}`);
        }
        return fail(500, "internal_error", err instanceof Error ? err.message : "Unknown error");
    }
}
