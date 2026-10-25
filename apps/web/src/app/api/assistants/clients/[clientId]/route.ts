/**
 * Delete one of this workspace's hand-made OAuth clients.
 *
 * DELETE — `settings.manage`. Only a client this workspace owns matches;
 * another workspace's client, or one an assistant registered itself, answers
 * 404. Everyone connected through it is cut off (its consents and tokens go
 * with it).
 */

import { NextResponse } from "next/server";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { deleteManualClient } from "~/server/mcp/oauth-clients";
import { requestTranslator } from "~/i18n/server";

export const runtime = "nodejs";

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ clientId: string }> }
) {
    return withRateLimit(request, RateLimitPresets.standard, async () => {
        const ctx = await requireWorkspacePermission("settings.manage");
        if (!ctx.success) return ctx.response;
        const t = requestTranslator(request, "settings.server.errors");
        const clientId = (await params).clientId.trim();
        // better-auth issues 32-character alphanumeric ids for these clients.
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(clientId)) {
            return NextResponse.json(
                { error: requestTranslator(request, "errors.api")("invalidId") },
                { status: 400 }
            );
        }

        try {
            const deleted = await deleteManualClient({ companyId: ctx.data.companyId, clientId });
            if (!deleted) return NextResponse.json({ error: t("clientNotFound") }, { status: 404 });
            return NextResponse.json({ deleted: true });
        } catch (error) {
            console.error("[assistants clients DELETE] failed:", error);
            return NextResponse.json({ error: t("oauthClientDeleteFailed") }, { status: 500 });
        }
    });
}
