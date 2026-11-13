// GET /api/extraction/[id]/export?format=csv|xlsx — the table as a file, as the viewer sees it
import type { NextRequest } from "next/server";

import { localeOfRequest } from "~/i18n/server";
import { exportExtractionTable } from "~/server/extraction/service";

import { extractionContext, handleExtractionError, tableIdFrom, tableNotFound } from "../../_http";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await extractionContext();
    if (!auth.ok) return auth.response;
    try {
        const id = await tableIdFrom(params);
        if (id === null) return tableNotFound(request);
        const format = new URL(request.url).searchParams.get("format") ?? "csv";
        const file = await exportExtractionTable(auth.ctx, id, format, localeOfRequest(request));
        const body = typeof file.body === "string" ? file.body : new Uint8Array(file.body);
        return new Response(body, {
            status: 200,
            headers: {
                "Content-Type": file.contentType,
                "Content-Disposition": file.disposition,
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch (err) {
        return handleExtractionError("GET export", err, request);
    }
}
