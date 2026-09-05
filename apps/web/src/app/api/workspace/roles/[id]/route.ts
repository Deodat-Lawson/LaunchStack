import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { DeleteRoleSchema, UpdateRoleSchema } from "~/lib/validation";
import {
    invalidIdResponse,
    parseIdParam,
    parseJsonBody,
    parseValue,
    readOptionalJson,
    workspaceErrorResponse,
} from "~/server/workspace/http";
import { deleteRole, updateRole } from "~/server/workspace/roles";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
    const ctx = await requireWorkspacePermission("roles.manage");
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).id);
    if (id === null) return invalidIdResponse();
    const body = await parseJsonBody(request, UpdateRoleSchema);
    if (!body.success) return body.response;
    try {
        return NextResponse.json({ role: await updateRole(ctx.data, id, body.data) });
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/roles PATCH]");
    }
}

export async function DELETE(request: Request, { params }: Params) {
    const ctx = await requireWorkspacePermission("roles.manage");
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).id);
    if (id === null) return invalidIdResponse();
    const body = parseValue(await readOptionalJson(request), DeleteRoleSchema);
    if (!body.success) return body.response;
    try {
        return NextResponse.json(await deleteRole(ctx.data, id, body.data.reassignTo));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/roles DELETE]");
    }
}
