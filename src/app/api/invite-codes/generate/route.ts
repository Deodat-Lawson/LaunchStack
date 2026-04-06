import { NextResponse } from "next/server";
import { auth } from "~/lib/auth-server";
import { eq } from "drizzle-orm";
import crypto from "crypto";

import { db } from "~/server/db";
import { users, inviteCodes } from "~/server/db/schema";

function generateCode(): string {
    return crypto.randomBytes(4).toString("hex").toUpperCase(); // 8-char hex code
}

export async function POST(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
        }

        const body = (await request.json()) as { role?: string };
        const role = body.role;

        if (!role || (role !== "employer" && role !== "employee")) {
            return NextResponse.json(
                { success: false, message: "Role must be 'employer' or 'employee'" },
                { status: 400 }
            );
        }

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
