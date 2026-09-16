/**
 * GET /api/workspace/history — the sidebar's History feed.
 *
 * One request returns everything the rail draws: this person's chat sessions
 * and the workspace's pipeline runs, already merged and sorted. The rail does
 * no per-kind fetching and knows no vertical's endpoint, which is what lets a
 * new vertical appear in history without a client change.
 *
 * `degraded` names any kind whose loader failed. The feed still renders; the
 * rail says which part of it is missing rather than pretending the workspace
 * has no distribution runs.
 */

import { NextResponse } from "next/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { serverError } from "~/lib/validation";
import { loadWorkspaceHistory, parseKindsParam } from "~/server/history";

export const runtime = "nodejs";

export async function GET(request: Request) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    try {
        const { searchParams } = new URL(request.url);
        const page = await loadWorkspaceHistory({
            companyId: ctx.data.companyId,
            userId: ctx.data.authUserId,
            limit: Number(searchParams.get("limit")) || undefined,
            kinds: parseKindsParam(searchParams.getAll("kind")),
        });
        return NextResponse.json(page);
    } catch (error) {
        console.error("[workspace/history] load failed:", error);
        return serverError("Failed to load history");
    }
}
