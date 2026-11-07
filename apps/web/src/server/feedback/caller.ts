import "server-only";

/**
 * Who is asking, for the feedback routes.
 *
 * Feedback needs a session and nothing else: a report can be filed from the
 * workspace picker, before onboarding finishes, or from a workspace the
 * person was just removed from. The email is the session's (it decides
 * triage, ./access); the active workspace is looked up softly, only when a
 * report is filed, and is simply absent when there is none.
 */

import { NextResponse } from "next/server";

import { requestTranslator } from "~/i18n/server";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { getServerSession } from "~/server/auth";

import { isFeedbackTriager } from "./access";
import type { FeedbackViewer } from "./present";

export interface FeedbackCaller extends FeedbackViewer {
    email: string;
}

export type FeedbackCallerResult =
    | { success: true; data: FeedbackCaller }
    | { success: false; response: NextResponse };

export async function resolveFeedbackCaller(request: Request): Promise<FeedbackCallerResult> {
    const session = await getServerSession();
    const authUserId = session?.user.id;
    if (!authUserId) {
        return {
            success: false,
            response: NextResponse.json(
                { error: requestTranslator(request, "errors.api")("unauthorized") },
                { status: 401 }
            ),
        };
    }
    const email = session.user.email ?? "";
    return { success: true, data: { authUserId, email, triager: isFeedbackTriager(email) } };
}

/**
 * The caller's active workspace, or null — never a failure. The picker page
 * has none; a membership that is suspended, or a lookup that fails, files the
 * report without one rather than losing it.
 */
export async function activeWorkspaceId(): Promise<bigint | null> {
    try {
        const ctx = await requireWorkspaceContext();
        return ctx.success ? ctx.data.companyId : null;
    } catch {
        return null;
    }
}
