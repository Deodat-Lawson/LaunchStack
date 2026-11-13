// POST /api/extraction/[id]/rerun — { rowIds? }: run those rows again, or every failed row; creator only
import type { NextRequest } from "next/server";

import { localeOfRequest } from "~/i18n/server";
import { rerunExtractionTable } from "~/server/extraction/service";

import {
    extractionContext,
    handleExtractionError,
    json,
    readBody,
    tableIdFrom,
    tableNotFound,
} from "../../_http";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await extractionContext();
    if (!auth.ok) return auth.response;
    try {
        const id = await tableIdFrom(params);
        if (id === null) return tableNotFound(request);
        const body = await readBody(request);
        return json({
            table: await rerunExtractionTable(auth.ctx, id, body.rowIds, localeOfRequest(request)),
        });
    } catch (err) {
        return handleExtractionError("POST rerun", err, request);
    }
}
