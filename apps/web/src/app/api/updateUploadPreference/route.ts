/**
 * Update Upload Preference API
 * Lightweight endpoint to toggle between UploadThing and database storage
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { company } from "@launchstack/store/schema";
import { validateRequestBody, UpdateUploadPreferenceSchema } from "~/lib/validation";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { recordAuditEvent } from "~/lib/authz/audit";

export async function POST(request: Request) {
    try {
        const ctx = await requireWorkspacePermission("settings.manage");
        if (!ctx.success) return ctx.response;

        const validation = await validateRequestBody(request, UpdateUploadPreferenceSchema);
        if (!validation.success) {
            return validation.response;
        }

        const { useUploadThing } = validation.data;

        const updateResult = await db
            .update(company)
            .set({ useUploadThing })
            .where(eq(company.id, Number(ctx.data.companyId)))
            .returning({ id: company.id, useUploadThing: company.useUploadThing });

        if (!updateResult || updateResult.length === 0) {
            return NextResponse.json(
                { success: false, message: "Company not found" },
                { status: 404 }
            );
        }

        await recordAuditEvent(db, {
            companyId: ctx.data.companyId,
            actorUserId: ctx.data.authUserId,
            action: "settings.changed",
            targetType: "workspace",
            targetId: ctx.data.companyId,
            detail: { keys: ["useUploadThing"] },
        });

        return NextResponse.json({
            success: true,
            useUploadThing: updateResult[0]!.useUploadThing,
        });
    } catch (error) {
        console.error("Error updating upload preference:", error);
        return NextResponse.json(
            { success: false, message: "Failed to update preference" },
            { status: 500 }
        );
    }
}
