// POST /api/prospects/segments/[id]/confirm — programs are explicit, so this only echoes the segment
import type { NextRequest } from "next/server";

import { getSegment } from "~/server/prospects/service";

import { handleProspectsError, json, prospectsContext } from "../../../_http";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        return json({ segment: await getSegment(auth.ctx, id) });
    } catch (err) {
        return handleProspectsError("POST confirm", err);
    }
}
