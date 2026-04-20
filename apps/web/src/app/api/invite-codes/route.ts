import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq, and } from "drizzle-orm";

import { db } from "~/server/db";
import { users, inviteCodes } from "~/server/db/schema";

export async function GET() {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
        }

        // Get the caller's company
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
                    eq(inviteCodes.companyId, userRecord.companyId),
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
