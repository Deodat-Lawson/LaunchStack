/**
 * Models & usage › Models: each model's chat use in the window — the
 * workspace's own models by id and the name they are offered under, the
 * server's by route only (see ~/server/usage/models). Gated on
 * `models.manage`: it is the model setup's own readout, beside the screen
 * that changes it.
 */

import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import type { UsageModels } from "~/lib/usage/types";
import { readUsageQuery } from "~/server/usage";
import { usageByModel } from "~/server/usage/models";
import { workspaceErrorResponse } from "~/server/workspace/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const ctx = await requireWorkspacePermission("models.manage");
    if (!ctx.success) return ctx.response;
    try {
        const query = readUsageQuery(new URL(request.url).searchParams);
        return NextResponse.json<UsageModels>(await usageByModel(ctx.data.companyId, query.window));
    } catch (error) {
        return workspaceErrorResponse(error, "[usage/models GET]", request);
    }
}
