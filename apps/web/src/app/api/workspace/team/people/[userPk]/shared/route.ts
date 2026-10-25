/**
 * What the caller and one member share with each other (ADR-014 §7).
 *
 * GET → { sharedWithMe: SharedItem[], iShared: SharedItem[] }
 *
 * `userPk` is the member's `users.id` (the Team tab's people list carries
 * it). 404 when they are not in this workspace.
 */

import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { invalidIdResponse, parseIdParam, workspaceErrorResponse } from "~/server/workspace/http";
import { sharedBetween } from "~/server/workspace/team/shared-between";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ userPk: string }> };

export async function GET(request: Request, { params }: Params) {
    const ctx = await requireWorkspacePermission("members.view");
    if (!ctx.success) return ctx.response;
    const id = parseIdParam((await params).userPk);
    if (id === null) return invalidIdResponse(request);
    try {
        return NextResponse.json(await sharedBetween(ctx.data, BigInt(id)));
    } catch (error) {
        return workspaceErrorResponse(error, "[workspace/team/people/shared GET]", request);
    }
}
