// POST /api/extraction/[id]/cancel — stop a table at its next batch, creator only
import type { NextRequest } from "next/server";

import { localeOfRequest } from "~/i18n/server";
import { cancelExtractionTable } from "~/server/extraction/service";

import {
    extractionContext,
    handleExtractionError,
    json,
    tableIdFrom,
    tableNotFound,
} from "../../_http";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await extractionContext();
    if (!auth.ok) return auth.response;
    try {
        const id = await tableIdFrom(params);
        if (id === null) return tableNotFound(request);
        return json({ table: await cancelExtractionTable(auth.ctx, id, localeOfRequest(request)) });
    } catch (err) {
        return handleExtractionError("POST cancel", err, request);
    }
}
