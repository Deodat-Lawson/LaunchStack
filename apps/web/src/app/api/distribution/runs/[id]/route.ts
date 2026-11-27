// GET /api/distribution/runs/[id] — status, plan, summary, credits used
import type { NextRequest } from "next/server";

import { getRun } from "@launchstack/pipelines/distribution/db";
import { requestTranslator } from "~/i18n/server";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { error, json } from "~/server/distribution/http";
import { distributionRouteError } from "~/server/distribution/stage-errors";

const api = (request: Request) => requestTranslator(request, "errors.api");

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const { id } = await params;
        const run = await getRun(id, ctx.data.companyId);
        if (!run) return error(api(request)("notFound"), 404);
        return json({ run });
    } catch (err) {
        return distributionRouteError("GET run", err, request);
    }
}
