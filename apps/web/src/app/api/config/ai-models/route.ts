import { NextResponse } from "next/server";
import { describeChatResolutionFailure, getConfiguredPublicChatConfig } from "~/lib/models";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";
import { localeOfRequest } from "~/i18n/server";

export const dynamic = "force-dynamic";

/**
 * Sanitized chat configuration for the browser.
 *
 * The UI drives its vision and reasoning controls from this: a route reported
 * unavailable disables the matching control, and the reasoning levels here
 * are the only ones the server will accept. Endpoint URLs, credentials,
 * reasoning request patches, and internal context/output limits never appear.
 *
 * Read inside the caller's workspace scope, so a workspace that brought its
 * own models sees the routes those models serve. A signed-out caller gets the
 * deployment's, as before.
 */
export async function GET(request: Request) {
    try {
        const ctx = await requireWorkspaceContext();
        const companyId = ctx.success ? ctx.data.companyId : null;
        const aiUse = {
            feature: "ask",
            userId: ctx.success ? ctx.data.authUserId : null,
            enforce: false,
        } as const;
        return await withWorkspaceChatModels(companyId, aiUse, () =>
            NextResponse.json(getConfiguredPublicChatConfig())
        );
    } catch (error) {
        // A broken configuration must not take the whole UI down — report every
        // route unavailable so controls disable themselves cleanly.
        // describeChatResolutionFailure logs the detail and keeps only words
        // fit for every user: the fixed reason for a broken server file, or
        // the workspace's own "fix it in Settings" when its endpoint is down.
        const { message } = describeChatResolutionFailure(error, localeOfRequest(request));
        return NextResponse.json(
            {
                routes: {
                    default: { available: false, unavailableReason: message },
                    fast: { available: false, unavailableReason: message },
                    reasoning: { available: false, unavailableReason: message },
                    vision: { available: false, unavailableReason: message },
                },
            },
            { status: 200 }
        );
    }
}
