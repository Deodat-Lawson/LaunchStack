/**
 * Update Upload Preference API
 * Lightweight endpoint to toggle between UploadThing and database storage
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { company } from "@launchstack/core/db/schema";
import { validateRequestBody, UpdateUploadPreferenceSchema } from "~/lib/validation";
import { isManagementRole, requireWorkspaceContext } from "~/lib/require-workspace-context";

export async function POST(request: Request) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const validation = await validateRequestBody(request, UpdateUploadPreferenceSchema);
        if (!validation.success) {
            return validation.response;
        }

        const { useUploadThing } = validation.data;

        if (!isManagementRole(ctx.data.role)) {
            return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
        }

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
