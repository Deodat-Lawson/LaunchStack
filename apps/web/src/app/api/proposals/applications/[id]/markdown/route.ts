// GET /api/proposals/applications/[id]/markdown — the proposal as one markdown document
import type { NextRequest } from "next/server";

import { renderProposalMarkdown } from "~/server/proposals/service";

import { handleProposalsError, json, proposalsContext } from "../../../_http";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        return json(await renderProposalMarkdown(auth.ctx, id));
    } catch (err) {
        return handleProposalsError("GET markdown", err);
    }
}
