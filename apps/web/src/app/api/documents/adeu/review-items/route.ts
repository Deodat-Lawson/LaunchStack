/**
 * GET /api/documents/adeu/review-items?documentId=123
 *
 * Lists the tracked changes and comments in a Word document so the editor can
 * render a review pane. Ids come back exactly as adeu writes them, which is
 * what makes accept / reject / reply addressable.
 */

import { NextResponse } from "next/server";
import { listReviewItems } from "@launchstack/features/adeu";

import { adeuErrorResponse, loadDocument } from "../_shared";

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

    try {
        const items = await listReviewItems(loaded.data.bytes, {
            filename: loaded.data.filename,
        });
        return NextResponse.json({ success: true, ...items });
    } catch (err) {
        console.error("[adeu/review-items] failed", err);
        return adeuErrorResponse(err);
    }
}
