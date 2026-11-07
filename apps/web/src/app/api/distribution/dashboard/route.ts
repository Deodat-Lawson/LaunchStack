// GET /api/distribution/dashboard?programId= — aggregates for the overview (computed at read time)
import type { NextRequest } from "next/server";

import { getDashboard, getProgram } from "@launchstack/pipelines/distribution/db";
import { requestTranslator } from "~/i18n/server";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { error, json } from "~/server/distribution/http";
import { distributionRouteError } from "~/server/distribution/stage-errors";

const growth = (request: Request) => requestTranslator(request, "growth.server.errors");

export async function GET(request: NextRequest) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const programId = request.nextUrl.searchParams.get("programId");
        if (!programId) return error(growth(request)("programIdRequired"), 400);
        const program = await getProgram(programId, ctx.data.companyId);
        if (!program) return error(growth(request)("programNotFound"), 404);
        return json({ dashboard: await getDashboard(ctx.data.companyId, programId) });
    } catch (err) {
        return distributionRouteError("GET dashboard", err, request);
    }
}
