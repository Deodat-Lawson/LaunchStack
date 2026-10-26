// GET /api/prospects/segments/suggestion — a first segment drafted from the
//   company profile: what it sells and where it is (who buys is the member's).
import type { NextRequest } from "next/server";

import { suggestSegment } from "~/server/prospects/service";

import { handleProspectsError, json, prospectsContext } from "../../_http";

export async function GET(request: NextRequest) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    try {
        return json({ suggestion: await suggestSegment(auth.ctx) });
    } catch (err) {
        return handleProspectsError("GET segment suggestion", err, request);
    }
}
