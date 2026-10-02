// PATCH  /api/proposals/applications/[id]/sections/[sectionId] — draft text, status, question, guidance, limit
// DELETE /api/proposals/applications/[id]/sections/[sectionId]
import type { NextRequest } from "next/server";
import { z } from "zod";

import { patchSection, removeSection } from "~/server/proposals/service";

import { error, proposalsContext, handleProposalsError, json, readBody } from "../../../../_http";

const PatchSchema = z.object({
    draft: z.string().max(100_000).optional().nullable(),
    status: z.enum(["empty", "drafted", "edited", "approved"]).optional(),
    question: z.string().min(1).max(1_000).optional(),
    guidance: z.string().max(2_000).optional().nullable(),
    wordLimit: z.number().int().positive().max(100_000).optional().nullable(),
});

type Params = { params: Promise<{ id: string; sectionId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        const { id, sectionId } = await params;
        const parsed = PatchSchema.safeParse(await readBody(request));
        if (!parsed.success) return error("Check the change and try again", 400);
        return json({ section: await patchSection(auth.ctx, id, sectionId, parsed.data) });
    } catch (err) {
        return handleProposalsError("PATCH section", err);
    }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        const { id, sectionId } = await params;
        await removeSection(auth.ctx, id, sectionId);
        return json({ ok: true });
    } catch (err) {
        return handleProposalsError("DELETE section", err);
    }
}
