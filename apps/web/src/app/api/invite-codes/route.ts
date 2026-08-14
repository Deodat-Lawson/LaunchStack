import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";

import { db } from "~/server/db";
import { inviteCodes } from "~/server/db/schema";
import {
  isManagementRole,
  requireWorkspaceContext,
} from "~/lib/require-workspace-context";

export async function GET() {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        if (!isManagementRole(ctx.data.role)) {
            return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
        }

        const codes = await db
            .select({
                id: inviteCodes.id,
                code: inviteCodes.code,
                role: inviteCodes.role,
                isActive: inviteCodes.isActive,
                createdAt: inviteCodes.createdAt,
            })
            .from(inviteCodes)
            .where(
                and(
                    eq(inviteCodes.companyId, ctx.data.companyId),
                    eq(inviteCodes.isActive, true)
                )
            );

        return NextResponse.json({ success: true, data: codes });
    } catch (error) {
        console.error("Error fetching invite codes:", error);
        return NextResponse.json(
            { success: false, message: "Failed to fetch invite codes" },
            { status: 500 }
        );
    }
}
