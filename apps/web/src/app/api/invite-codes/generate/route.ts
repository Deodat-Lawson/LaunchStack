import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import crypto from "crypto";

import { db } from "~/server/db";
import { users, inviteCodes } from "@launchstack/core/db/schema";
import { validateRequestBody, GenerateInviteCodeSchema } from "~/lib/validation";

function generateCode(): string {
    return crypto.randomBytes(4).toString("hex").toUpperCase(); // 8-char hex code
}

export async function POST(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
        }

        const validation = await validateRequestBody(request, GenerateInviteCodeSchema);
        if (!validation.success) return validation.response;
        const { role } = validation.data;

        // Verify the caller is an owner or employer
        const [userRecord] = await db
            .select({ companyId: users.companyId, role: users.role })
            .from(users)
            .where(eq(users.userId, userId));

        if (!userRecord) {
            return NextResponse.json({ success: false, message: "User not found" }, { status: 404 });
        }

        if (userRecord.role !== "owner" && userRecord.role !== "employer") {
            return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
        }

        const code = generateCode();

        const [newCode] = await db
            .insert(inviteCodes)
            .values({
                code,
                companyId: userRecord.companyId,
                role,
                createdBy: userId,
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
