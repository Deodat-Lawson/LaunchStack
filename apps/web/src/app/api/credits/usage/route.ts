import { NextResponse } from "next/server";
import { getUsageHistory, getTransactionHistory, getBalance } from "~/lib/credits";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

export async function GET(request: Request) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const companyId = ctx.data.companyId;

        const url = new URL(request.url);
        const startDate = url.searchParams.get("startDate") ?? undefined;
        const endDate = url.searchParams.get("endDate") ?? undefined;
        const type = url.searchParams.get("type") ?? "daily";

        if (type === "transactions") {
            const transactions = await getTransactionHistory(companyId, 50);
            return NextResponse.json({ transactions });
        }

        const [balanceTokens, usage] = await Promise.all([
            getBalance(companyId),
            getUsageHistory({
                companyId,
                startDate,
                endDate,
            }),
        ]);

        return NextResponse.json({ balanceTokens, usage });
    } catch (error) {
        console.error("[Tokens] Error fetching usage:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
