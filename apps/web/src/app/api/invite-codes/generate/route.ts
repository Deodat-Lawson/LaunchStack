import { NextResponse } from "next/server";
import crypto from "crypto";

import { db } from "~/server/db";
import { inviteCodes } from "~/server/db/schema";
import { validateRequestBody, GenerateInviteCodeSchema } from "~/lib/validation";
import { isManagementRole, requireWorkspaceContext } from "~/lib/require-workspace-context";

function generateCode(): string {
    return crypto.randomBytes(4).toString("hex").toUpperCase(); // 8-char hex code
}

export async function POST(request: Request) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const validation = await validateRequestBody(request, GenerateInviteCodeSchema);
        if (!validation.success) return validation.response;
        const { role } = validation.data;

        if (!isManagementRole(ctx.data.role)) {
            return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
        }

        const code = generateCode();

        const [newCode] = await db
            .insert(inviteCodes)
            .values({
                code,
                companyId: ctx.data.companyId,
                role,
                createdBy: ctx.data.clerkUserId,
            })
            .returning();

        return NextResponse.json({
            success: true,
            data: {
                id: newCode!.id,
                code: newCode!.code,
                role: newCode!.role,
                isActive: newCode!.isActive,
                createdAt: newCode!.createdAt,
            },
            message: "Invite code generated successfully",
        });
    } catch (error) {
        console.error("Error generating invite code:", error);
        return NextResponse.json(
            { success: false, message: "Failed to generate invite code" },
            { status: 500 }
        );
    }
}
