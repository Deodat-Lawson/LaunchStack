/**
 * Per-request identity for workspace routes.
 *
 * Pages are owned by a Clerk user and tagged with the active workspace, but a
 * user who has not finished onboarding has no company row yet. That must not
 * block them from writing a page, so `companyId` is nullable and resolution
 * failures degrade to null instead of throwing.
 */

import { auth } from "@clerk/nextjs/server";

import { getActiveCompanyId } from "~/lib/active-workspace";

export interface WorkspaceSession {
    userId: string;
    companyId: string | null;
}

export async function getWorkspaceSession(): Promise<WorkspaceSession | null> {
    const { userId } = await auth();
    if (!userId) return null;

    let companyId: string | null = null;
    try {
        companyId = String(await getActiveCompanyId(userId));
    } catch {
        // Not onboarded into a workspace yet — pages are still personal.
        companyId = null;
    }

    return { userId, companyId };
}
