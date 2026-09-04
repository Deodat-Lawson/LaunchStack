// GET /api/distribution/dashboard?programId= — aggregates for the overview (computed at read time)
import type { NextRequest } from "next/server";

import { getDashboard, getProgram } from "@launchstack/pipelines/distribution/db";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { error, handleRouteError, json } from "~/server/distribution/http";

export async function GET(request: NextRequest) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const programId = request.nextUrl.searchParams.get("programId");
        if (!programId) return error("programId is required", 400);
        const program = await getProgram(programId, ctx.data.companyId);
        if (!program) return error("Program not found", 404);
        return json({ dashboard: await getDashboard(ctx.data.companyId, programId) });
    } catch (err) {
        return handleRouteError("GET dashboard", err);
    }
}
