import { NextResponse } from "next/server";
import { getConfiguredPublicChatConfig } from "~/lib/models";

export const dynamic = "force-dynamic";

/**
 * Sanitized chat configuration for the browser.
 *
 * The UI drives its vision and reasoning controls from this: a route reported
 * unavailable disables the matching control, and the reasoning levels here
 * are the only ones the server will accept. Endpoint URLs, credentials,
 * reasoning request patches, and internal context/output limits never appear.
 */
export async function GET() {
    try {
        return NextResponse.json(getConfiguredPublicChatConfig());
    } catch (error) {
        // A broken configuration must not take the whole UI down — report every
        // route unavailable so controls disable themselves cleanly. The
        // validation error quotes the file path, model ids and preset names,
        // so it goes to the server log; every user sees this reason.
        console.error("[config/ai-models] chat model configuration is invalid:", error);
        const message =
            "Chat models are not configured correctly. An administrator needs to check the server's chat model file.";
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
