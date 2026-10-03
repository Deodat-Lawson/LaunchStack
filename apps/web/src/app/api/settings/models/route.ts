/**
 * The chat model configuration, made legible. Gated on `settings.manage`.
 * It names routes and capabilities only; the endpoint and model ids stay on
 * the server (see `~/server/settings/models`).
 */

import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { modelsOverview } from "~/server/settings/models";

export const dynamic = "force-dynamic";

export async function GET() {
    const ctx = await requireWorkspacePermission("settings.manage");
    if (!ctx.success) return ctx.response;
    try {
        return NextResponse.json(modelsOverview());
    } catch (error) {
        // The validation error quotes model ids and preset names, so the detail
        // goes to the server log and the page says only that the file is wrong.
        console.error("[settings/models] chat model configuration is invalid:", error);
        return NextResponse.json(
            {
                error: "The chat model configuration could not be read. The server log has the details.",
            },
            { status: 500 }
        );
    }
}
