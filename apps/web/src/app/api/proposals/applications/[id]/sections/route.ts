// POST /api/proposals/applications/[id]/sections — { question, guidance?, wordLimit? } add a section by hand
import type { NextRequest } from "next/server";
import { z } from "zod";

import { newSection } from "~/server/proposals/service";

import { error, proposalsContext, handleProposalsError, json, readBody } from "../../../_http";

const Schema = z.object({
    question: z.string().min(1).max(1_000),
    guidance: z.string().max(2_000).optional().nullable(),
    wordLimit: z.number().int().positive().max(100_000).optional().nullable(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const parsed = Schema.safeParse(await readBody(request));
        if (!parsed.success) return error("A section needs a question", 400);
        return json({ section: await newSection(auth.ctx, id, parsed.data) }, 201);
    } catch (err) {
        return handleProposalsError("POST sections", err);
    }
}
