import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq, and } from "drizzle-orm";

import { db } from "~/server/db";
import { users, inviteCodes } from "@launchstack/core/db/schema";
import { validateRequestBody, DeactivateInviteCodeSchema } from "~/lib/validation";

export async function POST(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
        }

        const validation = await validateRequestBody(request, DeactivateInviteCodeSchema);
        if (!validation.success) return validation.response;
        const { codeId } = validation.data;

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

        // Only deactivate codes belonging to the caller's company
        const result = await db
            .update(inviteCodes)
            .set({ isActive: false })
            .where(
                and(
                    eq(inviteCodes.id, codeId),
                    eq(inviteCodes.companyId, userRecord.companyId)
                )
            )
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
