import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { DocumentAccessSchema } from "~/lib/validation";
import { getDocumentAccess, setDocumentAccess } from "~/server/workspace/document-access";
import {
    invalidIdResponse,
    parseIdParam,
    parseJsonBody,
    workspaceErrorResponse,
} from "~/server/workspace/http";

type Params = { params: Promise<{ documentId: string }> };

export async function GET(_request: Request, { params }: Params) {
    const ctx = await requireWorkspacePermission("documents.read");
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).documentId);
    if (id === null) return invalidIdResponse();
    try {
        return NextResponse.json(await getDocumentAccess(ctx.data, id));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/documents/access GET]");
    }
}

/** `folders.manage`, or `documents.edit` in scope (plus a manage grant once restricted) — checked in the service. */
export async function PUT(request: Request, { params }: Params) {
    const ctx = await requireWorkspacePermission("documents.read");
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).documentId);
    if (id === null) return invalidIdResponse();
    const body = await parseJsonBody(request, DocumentAccessSchema);
    if (!body.success) return body.response;
    try {
        return NextResponse.json(await setDocumentAccess(ctx.data, id, body.data));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/documents/access PUT]");
    }
}
