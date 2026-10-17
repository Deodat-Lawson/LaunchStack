/**
 * Disconnect one assistant from the active workspace, for the caller only.
 *
 * DELETE — any active member. Removes this person's consent for that client
 * in this workspace and revokes the tokens it issued; the MCP route checks
 * consent on every call, so the assistant is cut off at its next request.
 * The same assistant connected to another workspace, or by a colleague, is
 * untouched.
 */

import { NextResponse } from "next/server";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { revokeConnection } from "~/server/mcp/connections";

export const runtime = "nodejs";

/**
 * Client ids can be URLs (a client ID metadata document), which the page
 * sends encoded. Decoding twice is harmless for every id better-auth issues;
 * a stray `%` that is not an escape is kept as written.
 */
function decodeParam(raw: string): string {
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ clientId: string }> }
) {
    return withRateLimit(request, RateLimitPresets.standard, async () => {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const clientId = decodeParam((await params).clientId).trim();
        if (!clientId || clientId.length > 2048) {
            return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        }

        try {
            const revoked = await revokeConnection({
                authUserId: ctx.data.authUserId,
                companyId: ctx.data.companyId,
                clientId,
            });
            if (!revoked) {
                return NextResponse.json({ error: "Connection not found" }, { status: 404 });
            }
            return NextResponse.json({ revoked: true });
        } catch (error) {
            console.error("[assistants connections DELETE] failed:", error);
            return NextResponse.json(
                { error: "Could not disconnect the assistant." },
                { status: 500 }
            );
        }
    });
}
