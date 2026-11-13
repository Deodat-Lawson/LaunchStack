// GET  /api/extraction — the viewer's tables plus tables shared with the workspace
// POST /api/extraction — make a table and start it: { title?, fields, documentIds }
import type { NextRequest } from "next/server";

import { localeOfRequest } from "~/i18n/server";
import { createExtractionTable, listExtractionTables } from "~/server/extraction/service";

import { extractionContext, handleExtractionError, json, readBody } from "./_http";

export async function GET(request: Request) {
    const auth = await extractionContext();
    if (!auth.ok) return auth.response;
    try {
        return json({ tables: await listExtractionTables(auth.ctx, localeOfRequest(request)) });
    } catch (err) {
        return handleExtractionError("GET", err, request);
    }
}

export async function POST(request: NextRequest) {
    const auth = await extractionContext();
    if (!auth.ok) return auth.response;
    try {
        const table = await createExtractionTable(
            auth.ctx,
            await readBody(request),
            localeOfRequest(request)
        );
        return json({ table }, 201);
    } catch (err) {
        return handleExtractionError("POST", err, request);
    }
}
