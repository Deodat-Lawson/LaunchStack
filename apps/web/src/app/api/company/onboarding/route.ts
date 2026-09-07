import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { company } from "@launchstack/store/schema";
import { validateRequestBody, CompanyOnboardingSchema } from "~/lib/validation";
import {
    requireWorkspaceContext,
    requireWorkspacePermission,
} from "~/lib/require-workspace-context";

export async function POST(request: Request) {
    try {
        const ctx = await requireWorkspacePermission("settings.manage");
        if (!ctx.success) return ctx.response;

        const validation = await validateRequestBody(request, CompanyOnboardingSchema);
        if (!validation.success) return validation.response;
        const body = validation.data;

        await db
            .update(company)
            .set({
                description: body.description ?? null,
                industry: body.industry ?? null,
            })
            .where(eq(company.id, Number(ctx.data.companyId)));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("[company/onboarding] POST error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function GET() {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const [companyRow] = await db
            .select({
                name: company.name,
                description: company.description,
                industry: company.industry,
            })
            .from(company)
            .where(eq(company.id, Number(ctx.data.companyId)));

        return NextResponse.json({
            name: companyRow?.name ?? null,
            description: companyRow?.description ?? null,
            industry: companyRow?.industry ?? null,
        });
    } catch (error) {
        console.error("[company/onboarding] GET error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
