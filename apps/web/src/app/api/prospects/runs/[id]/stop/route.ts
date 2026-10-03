// POST /api/prospects/runs/[id]/stop — ask the worker to stop after the current company
import type { NextRequest } from "next/server";

import { stopRun } from "~/server/prospects/service";

import { handleProspectsError, json, prospectsContext } from "../../../_http";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        return json({ run: await stopRun(auth.ctx, id) });
    } catch (err) {
        return handleProspectsError("POST stop", err);
    }
}
