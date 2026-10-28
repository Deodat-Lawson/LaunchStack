/**
 * The chat model configuration and the web search engine, made legible.
 * Gated on `settings.manage`. It names routes, capabilities and the search
 * engine only; the endpoint, model ids and every key stay on the server (see
 * `~/server/settings/models`).
 */

import { NextResponse } from "next/server";

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { modelsOverview } from "~/server/settings/models";
import { requestTranslator } from "~/i18n/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
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
                error: requestTranslator(request, "settings.server.errors")("chatModelsUnreadable"),
            },
            { status: 500 }
        );
    }
}
