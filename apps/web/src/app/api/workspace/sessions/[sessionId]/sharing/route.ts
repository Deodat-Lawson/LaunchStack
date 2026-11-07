/**
 * GET/PUT /api/workspace/sessions/{id}/sharing — who can read a chat (ADR-014).
 *
 * The contract is `ChatSharing` in `_workspace/access/chatShareAdapter.ts`:
 *
 *   GET → { general, grants, canManage, owner, workspaceName, audienceCount }
 *   PUT { general: "private" | "workspace", grants: [{ principalType, principalId, level: "view" }] }
 *       → the same shape, after the change
 *
 * Anyone who can read the chat may GET (`canManage` false unless it's theirs);
 * a chat they can't read is 404. Only the owner may PUT — a reader gets 403,
 * since they already know the chat exists. Chats carry no permission atom of
 * their own, so the gate is ownership plus `documents.read` (sharing a chat
 * shares what its answers say about the workspace's documents).
 */

import { NextResponse } from "next/server";

import {
    requireWorkspaceContext,
    requireWorkspacePermission,
} from "~/lib/require-workspace-context";
import { ChatSharingSchema } from "~/lib/validation";
import { getChatSharing, setChatSharing } from "~/server/sessions/sharing";
import { parseJsonBody, workspaceErrorResponse } from "~/server/workspace/http";

export const runtime = "nodejs";

type Params = { params: Promise<{ sessionId: string }> };

export async function GET(request: Request, { params }: Params) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    try {
        return NextResponse.json(await getChatSharing(ctx.data, (await params).sessionId));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/sessions/sharing GET]", request);
    }
}

export async function PUT(request: Request, { params }: Params) {
    const ctx = await requireWorkspacePermission("documents.read");
    if (!ctx.success) return ctx.response;
    const body = await parseJsonBody(request, ChatSharingSchema);
    if (!body.success) return body.response;
    try {
        return NextResponse.json(
            await setChatSharing(ctx.data, (await params).sessionId, body.data)
        );
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/sessions/sharing PUT]", request);
    }
}
