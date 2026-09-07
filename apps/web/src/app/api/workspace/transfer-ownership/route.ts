import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { TransferOwnershipSchema } from "~/lib/validation";
import { parseJsonBody, workspaceErrorResponse } from "~/server/workspace/http";
import { transferOwnership } from "~/server/workspace/members";

export async function POST(request: Request) {
    const ctx = await requireWorkspacePermission("workspace.transfer");
    if (!ctx.success) return ctx.response;
    const body = await parseJsonBody(request, TransferOwnershipSchema);
    if (!body.success) return body.response;
    try {
        return NextResponse.json(await transferOwnership(ctx.data, BigInt(body.data.userId)));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/transfer-ownership POST]");
    }
}
