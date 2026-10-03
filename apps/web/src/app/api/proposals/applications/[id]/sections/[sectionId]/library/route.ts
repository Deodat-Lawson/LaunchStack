// POST /api/proposals/applications/[id]/sections/[sectionId]/library — { tags? } keep this answer for reuse
import type { NextRequest } from "next/server";
import { z } from "zod";

import { saveSectionToLibrary } from "~/server/proposals/service";

import {
    error,
    proposalsContext,
    handleProposalsError,
    json,
    readBody,
} from "../../../../../_http";

const Schema = z.object({ tags: z.array(z.string().min(1).max(40)).max(10).default([]) });

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        const { id, sectionId } = await params;
        const parsed = Schema.safeParse(await readBody(request));
        if (!parsed.success) return error("Check the tags and try again", 400);
        return json(
            { item: await saveSectionToLibrary(auth.ctx, id, sectionId, parsed.data.tags) },
            201
        );
    } catch (err) {
        return handleProposalsError("POST section/library", err);
    }
}
