// PATCH  /api/proposals/library/[id] — { question?, answer?, tags? }
// DELETE /api/proposals/library/[id]
import type { NextRequest } from "next/server";
import { z } from "zod";

import { editLibraryItem, removeLibraryItem } from "~/server/proposals/service";

import { error, proposalsContext, handleProposalsError, json, readBody } from "../../_http";

const Schema = z.object({
    question: z.string().min(1).max(1_000).optional(),
    answer: z.string().min(1).max(100_000).optional(),
    tags: z.array(z.string().min(1).max(40)).max(10).optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const parsed = Schema.safeParse(await readBody(request));
        if (!parsed.success) return error("Check the change and try again", 400);
        return json({ item: await editLibraryItem(auth.ctx, id, parsed.data) });
    } catch (err) {
        return handleProposalsError("PATCH library item", err);
    }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        await removeLibraryItem(auth.ctx, id);
        return json({ ok: true });
    } catch (err) {
        return handleProposalsError("DELETE library item", err);
    }
}
