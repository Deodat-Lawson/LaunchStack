// GET   /api/prospects/segments/[id]
// PATCH /api/prospects/segments/[id] — { fields: { offering?, industries?, geographies?, disqualifiers? } }
import type { NextRequest } from "next/server";

import { getSegment, patchSegment } from "~/server/prospects/service";

import { handleProspectsError, json, prospectsContext, readBody } from "../../_http";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        return json({ segment: await getSegment(auth.ctx, id) });
    } catch (err) {
        return handleProspectsError("GET segment", err);
    }
}

export async function PATCH(request: NextRequest, { params }: Params) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const body = await readBody(request);
        const fields = (body.fields ?? {}) as Record<string, string | string[]>;
        return json({ segment: await patchSegment(auth.ctx, id, fields) });
    } catch (err) {
        return handleProspectsError("PATCH segment", err);
    }
}
