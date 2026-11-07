/**
 * Assistants (MCP) in Settings: what the signed-in person needs to connect
 * Claude, ChatGPT or Gemini to this workspace, and to see what is connected.
 *
 * GET — any active member. The server URL (or why the MCP server is off), the
 * assistants this person has connected here over OAuth, their own access
 * keys, and what they may do: create a key that saves conversations
 * (`documents.upload`) and manage the workspace's hand-made OAuth clients
 * (`settings.manage`, listed by /api/assistants/clients). Only ever the
 * caller's own connections and keys, never a colleague's.
 */

import { NextResponse } from "next/server";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { listAccessKeys } from "~/server/mcp/access-keys";
import { mcpAvailability } from "~/server/mcp/config";
import { listConnections } from "~/server/mcp/connections";
import { requestTranslator } from "~/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    return withRateLimit(request, RateLimitPresets.permissive, async () => {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const { authUserId, companyId, userPk } = ctx.data;

        try {
            const availability = mcpAvailability();
            const [connections, keys] = await Promise.all([
                listConnections({ authUserId, companyId }),
                listAccessKeys({ companyId, userPk }),
            ]);
            return NextResponse.json({
                availability: availability.enabled
                    ? { enabled: true, serverUrl: availability.resource }
                    : { enabled: false, reason: availability.reason },
                connections,
                keys,
                canSave: ctx.data.can("documents.upload"),
                canManageClients: ctx.data.can("settings.manage"),
            });
        } catch (error) {
            console.error("[assistants GET] failed:", error);
            return NextResponse.json(
                {
                    error: requestTranslator(
                        request,
                        "settings.server.errors"
                    )("assistantsLoadFailed"),
                },
                { status: 500 }
            );
        }
    });
}
