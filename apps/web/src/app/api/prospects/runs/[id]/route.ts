// GET /api/prospects/runs/[id]
import type { NextRequest } from "next/server";

import { getRun } from "@launchstack/pipelines/distribution/db";
import { toRunDto } from "~/server/prospects/adapter";
import { runProgress } from "~/server/prospects/service";

import { error, handleProspectsError, json, prospectsContext } from "../../_http";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const run = await getRun(id, auth.ctx.companyId);
        if (!run) return error("Run not found", 404);
        return json({ run: toRunDto(run, await runProgress(auth.ctx, run)) });
    } catch (err) {
        return handleProspectsError("GET run", err);
    }
}
