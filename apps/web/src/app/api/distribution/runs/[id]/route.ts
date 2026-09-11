// GET /api/distribution/runs/[id] — status, plan, summary, credits used
import type { NextRequest } from "next/server";

import { getRun } from "@launchstack/pipelines/distribution/db";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { error, handleRouteError, json } from "~/server/distribution/http";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const { id } = await params;
        const run = await getRun(id, ctx.data.companyId);
        if (!run) return error("Not found", 404);
        return json({ run });
    } catch (err) {
        return handleRouteError("GET run", err);
    }
}
