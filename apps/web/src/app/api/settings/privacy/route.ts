/**
 * What leaves the deployment. Any member may read it — it names hosts, not
 * credentials, and the people whose documents are processed are exactly the
 * people entitled to the answer.
 */

import { NextResponse } from "next/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { privacyOverview } from "~/server/settings/privacy";

export const dynamic = "force-dynamic";

export async function GET() {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    return NextResponse.json(privacyOverview());
}
