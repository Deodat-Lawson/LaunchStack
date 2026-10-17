/**
 * Revoke one of the caller's own access keys in the active workspace.
 *
 * DELETE — any active member. The service only matches a live key that
 * belongs to this person in this workspace, so someone else's key id answers
 * 404 exactly like a missing one. The next request with the key fails.
 */

import { NextResponse } from "next/server";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { revokeAccessKey } from "~/server/mcp/access-keys";
import { invalidIdResponse, parseIdParam } from "~/server/workspace/http";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    return withRateLimit(request, RateLimitPresets.standard, async () => {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const keyId = parseIdParam((await params).id);
        if (keyId === null) return invalidIdResponse();

        try {
            const revoked = await revokeAccessKey({
                companyId: ctx.data.companyId,
                userPk: ctx.data.userPk,
                keyId,
            });
            if (!revoked) return NextResponse.json({ error: "Key not found" }, { status: 404 });
            return NextResponse.json({ revoked: true });
        } catch (error) {
            console.error("[assistants keys DELETE] failed:", error);
            return NextResponse.json({ error: "Could not revoke the key." }, { status: 500 });
        }
    });
}
