import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { users } from "@launchstack/core/db/schema";
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";
import { db } from "~/server/db";
import { getStorageDeletionMetrics } from "~/server/services/storage-deletion-metrics";

const AUTHORIZED_ROLES = new Set(["employer", "owner"]);

export async function GET() {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        const [userInfo] = await db.select().from(users).where(eq(users.userId, userId));
        if (!userInfo) {
            return NextResponse.json({ success: false, error: "Unknown user" }, { status: 401 });
        }
        if (!AUTHORIZED_ROLES.has(userInfo.role)) {
            return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
        }

        const companyId = await resolveActiveCompanyForUser(userInfo.id, userInfo.companyId);
        const metrics = await getStorageDeletionMetrics(Number(companyId));
        return NextResponse.json({ success: true, ...metrics });
    } catch (error) {
        console.error("[GET /api/storage/deletion-metrics] error:", error);
        return NextResponse.json(
            { success: false, error: "Failed to read storage deletion metrics" },
            { status: 500 }
        );
    }
}
