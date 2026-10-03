/**
 * Workspace onboarding.
 *
 * GET  — what onboarding already knows (name, website, description, idea,
 *        industry), so going through it again starts filled in.
 * POST — { website?, description?, idea?, industry? }: saved to the company
 *        record and to the company profile as the person's own facts; the
 *        profile is reassembled after the response. settings.manage.
 */
import { NextResponse } from "next/server";

import { validateRequestBody, CompanyOnboardingSchema } from "~/lib/validation";
import {
    requireWorkspaceContext,
    requireWorkspacePermission,
} from "~/lib/require-workspace-context";
import { loadOnboarding, saveOnboarding } from "~/server/company-profile/onboarding";
import { reassembleAfterResponse } from "~/server/company-profile/service";

export async function POST(request: Request) {
    try {
        const ctx = await requireWorkspacePermission("settings.manage");
        if (!ctx.success) return ctx.response;

        const validation = await validateRequestBody(request, CompanyOnboardingSchema);
        if (!validation.success) return validation.response;

        const saved = await saveOnboarding(ctx.data, validation.data);
        if (saved.facts > 0) await reassembleAfterResponse(ctx.data.companyId, ctx.data.authUserId);
        return NextResponse.json({ success: true, website: saved.website });
    } catch (error) {
        console.error("[company/onboarding] POST error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function GET() {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        return NextResponse.json(await loadOnboarding(ctx.data));
    } catch (error) {
        console.error("[company/onboarding] GET error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
