import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { users } from "@launchstack/core/db/schema";
import { ensureTokenAccount } from "~/lib/credits";

export async function GET() {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const [user] = await db
            .select({ companyId: users.companyId })
            .from(users)
            .where(eq(users.userId, userId));

        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        const balanceTokens = await ensureTokenAccount(user.companyId);

        return NextResponse.json({ balanceTokens });
    } catch (error) {
        console.error("[Tokens] Error fetching balance:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
