// GET /api/extraction/sources — the documents the viewer can put in a table
import { extractionSourceOptions } from "~/server/extraction/service";

import { extractionContext, handleExtractionError, json } from "../_http";

export async function GET(request: Request) {
    const auth = await extractionContext();
    if (!auth.ok) return auth.response;
    try {
        return json({ sources: await extractionSourceOptions(auth.ctx) });
    } catch (err) {
        return handleExtractionError("GET sources", err, request);
    }
}
