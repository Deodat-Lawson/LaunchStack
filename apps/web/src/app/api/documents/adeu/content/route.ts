/**
 * GET /api/documents/adeu/content?documentId=123
 *
 * Streams a Word document's bytes to the editor for rendering.
 *
 * The editor renders the real OOXML in the browser, so it needs the file
 * itself rather than a converted approximation. Serving it through the app
 * keeps the company scope check on the request and means the browser never
 * needs credentials for the storage backend.
 */

import { NextResponse } from "next/server";

import { DOCX_MIME, loadDocument } from "../_shared";

export const runtime = "nodejs";

export async function GET(request: Request) {
    const url = new URL(request.url);
    const raw = url.searchParams.get("documentId");
    const documentId = Number(raw);

    if (!raw || !Number.isInteger(documentId) || documentId <= 0) {
        return NextResponse.json(
            { success: false, error: "invalid_request", message: "documentId is required" },
            { status: 400 }
        );
    }

    const loaded = await loadDocument(documentId);
    if (!loaded.ok) return loaded.response;

    const body = new Uint8Array(loaded.data.bytes);
    return new NextResponse(body, {
        status: 200,
        headers: {
            "Content-Type": DOCX_MIME,
            "Content-Length": String(body.byteLength),
            // The bytes change whenever an edit is applied, and the editor
            // refetches immediately after saving — a cached copy would show
            // the pre-edit document.
            "Cache-Control": "no-store",
            "Content-Disposition": `inline; filename="${loaded.data.filename.replace(/["\\\r\n]/g, "_")}"`,
        },
    });
}
