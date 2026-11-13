// GET    /api/extraction/[id] — the full table (poll while it's going)
// PATCH  /api/extraction/[id] — { title?, shared? }, creator only
// DELETE /api/extraction/[id] — creator only
import type { NextRequest } from "next/server";

import { localeOfRequest } from "~/i18n/server";
import {
    deleteExtractionTable,
    pollExtractionTable,
    updateExtractionTable,
} from "~/server/extraction/service";

import {
    extractionContext,
    handleExtractionError,
    json,
    readBody,
    tableIdFrom,
    tableNotFound,
} from "../_http";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
    const auth = await extractionContext();
    if (!auth.ok) return auth.response;
    try {
        const id = await tableIdFrom(params);
        if (id === null) return tableNotFound(request);
        // Also resumes a table whose in-process executor went away.
        return json({ table: await pollExtractionTable(auth.ctx, id, localeOfRequest(request)) });
    } catch (err) {
        return handleExtractionError("GET table", err, request);
    }
}

export async function PATCH(request: NextRequest, { params }: Params) {
    const auth = await extractionContext();
    if (!auth.ok) return auth.response;
    try {
        const id = await tableIdFrom(params);
        if (id === null) return tableNotFound(request);
        const body = await readBody(request);
        return json({
            table: await updateExtractionTable(
                auth.ctx,
                id,
                { title: body.title, shared: body.shared },
                localeOfRequest(request)
            ),
        });
    } catch (err) {
        return handleExtractionError("PATCH table", err, request);
    }
}

export async function DELETE(request: NextRequest, { params }: Params) {
    const auth = await extractionContext();
    if (!auth.ok) return auth.response;
    try {
        const id = await tableIdFrom(params);
        if (id === null) return tableNotFound(request);
        await deleteExtractionTable(auth.ctx, id);
        return json({ ok: true });
    } catch (err) {
        return handleExtractionError("DELETE table", err, request);
    }
}
