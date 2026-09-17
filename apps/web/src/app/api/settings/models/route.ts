/**
 * The chat model configuration, made legible. Gated on `settings.manage`:
 * it names the endpoint host and the model ids, which is operator detail.
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
        // A misconfigured file is exactly what this page exists to show.
        const message =
            error instanceof Error
                ? error.message
                : "The chat model configuration could not be read.";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
