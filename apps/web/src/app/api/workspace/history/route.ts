/**
 * GET /api/workspace/history — the sidebar's History feed.
 *
 * One request returns everything the rail draws: this person's chats, the
 * chats shared with them (ADR-014), and the workspace's pipeline runs, already
 * merged and sorted newest first. Every chat row carries the caller's own
 * pin / archive / unread state; the rail draws Pinned, Shared with you and the
 * dated recents from that. The rail does no per-kind fetching and knows no
 * vertical's endpoint, which is what lets a new vertical appear in history
 * without a client change.
 *
 * `?archived=1` returns only the caller's archived chats (the Archived view).
 *
 * `degraded` names any kind whose loader failed. The feed still renders; the
 * rail says which part of it is missing rather than pretending the workspace
 * has no distribution runs.
 */

import { NextResponse } from "next/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { serverError } from "~/lib/validation";
import { loadWorkspaceHistory, parseKindsParam } from "~/server/history";
import { localeOfRequest, requestTranslator } from "~/i18n/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    try {
        const { searchParams } = new URL(request.url);
        const page = await loadWorkspaceHistory({
            companyId: ctx.data.companyId,
            userId: ctx.data.authUserId,
            actor: ctx.data,
            limit: Number(searchParams.get("limit")) || undefined,
            kinds: parseKindsParam(searchParams.getAll("kind")),
            archived: searchParams.get("archived") === "1",
            locale: localeOfRequest(request),
        });
        return NextResponse.json(page);
    } catch (error) {
        console.error("[workspace/history] load failed:", error);
        return serverError(
            requestTranslator(request, "workspace.server.errors")("loadHistoryFailed")
        );
    }
}
