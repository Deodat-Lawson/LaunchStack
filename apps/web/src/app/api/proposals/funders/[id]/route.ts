// PATCH  /api/proposals/funders/[id] — { status: saved | dismissed | candidate }
// DELETE /api/proposals/funders/[id]
import type { NextRequest } from "next/server";
import { z } from "zod";

import { removeFunder, setFunderStatus } from "~/server/proposals/service";

import { error, proposalsContext, handleProposalsError, json, readBody } from "../../_http";

const PatchSchema = z.object({ status: z.enum(["candidate", "saved", "dismissed", "applied"]) });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const parsed = PatchSchema.safeParse(await readBody(request));
        if (!parsed.success) return error("Unknown status", 400);
        return json({ funder: await setFunderStatus(auth.ctx, id, parsed.data.status) });
    } catch (err) {
        return handleProposalsError("PATCH funder", err);
    }
}

export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        await removeFunder(auth.ctx, id);
        return json({ ok: true });
    } catch (err) {
        return handleProposalsError("DELETE funder", err);
    }
}
