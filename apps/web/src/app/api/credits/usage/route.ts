import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { users } from "@launchstack/core/db/schema";
import { getUsageHistory, getTransactionHistory, getBalance } from "~/lib/credits";

export async function GET(request: Request) {
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

        const url = new URL(request.url);
        const startDate = url.searchParams.get("startDate") ?? undefined;
        const endDate = url.searchParams.get("endDate") ?? undefined;
        const type = url.searchParams.get("type") ?? "daily";

        if (type === "transactions") {
            const transactions = await getTransactionHistory(user.companyId, 50);
            return NextResponse.json({ transactions });
        }

        const [balanceTokens, usage] = await Promise.all([
            getBalance(user.companyId),
            getUsageHistory({
                companyId: user.companyId,
                startDate,
                endDate,
            }),
        ]);

        return NextResponse.json({ balanceTokens, usage });
    } catch (error) {
        console.error("[Tokens] Error fetching usage:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
