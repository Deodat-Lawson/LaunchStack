// POST /api/proposals/applications/[id]/export — publish the application into Sources as markdown
import type { NextRequest } from "next/server";

import { exportApplication } from "~/server/proposals/service";

import { proposalsContext, handleProposalsError, json } from "../../../_http";

export const maxDuration = 60;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        return json({ application: await exportApplication(auth.ctx, id, request.url) });
    } catch (err) {
        return handleProposalsError("POST export", err);
    }
}
