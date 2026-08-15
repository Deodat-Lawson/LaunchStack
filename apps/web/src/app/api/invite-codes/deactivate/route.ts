import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";

import { db } from "~/server/db";
import { inviteCodes } from "~/server/db/schema";
import { validateRequestBody, DeactivateInviteCodeSchema } from "~/lib/validation";
import { isManagementRole, requireWorkspaceContext } from "~/lib/require-workspace-context";

export async function POST(request: Request) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const validation = await validateRequestBody(request, DeactivateInviteCodeSchema);
        if (!validation.success) return validation.response;
        const { codeId } = validation.data;

        if (!isManagementRole(ctx.data.role)) {
            return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
        }

        // Only deactivate codes belonging to the caller's company
        const result = await db
            .update(inviteCodes)
            .set({ isActive: false })
            .where(and(eq(inviteCodes.id, codeId), eq(inviteCodes.companyId, ctx.data.companyId)))
            .returning({ id: inviteCodes.id });

        if (!result || result.length === 0) {
            return NextResponse.json(
                { success: false, message: "Invite code not found or already deactivated" },
                { status: 404 }
            );
        }

        return NextResponse.json({
            success: true,
            message: "Invite code deactivated successfully",
        });
    } catch (error) {
        console.error("Error deactivating invite code:", error);
        return NextResponse.json(
            { success: false, message: "Failed to deactivate invite code" },
            { status: 500 }
        );
    }
}
