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
            return NextResponse.json({ transactions: transactions.map(withStringCompanyId) });
        }

        const [balanceTokens, usage] = await Promise.all([
            getBalance(companyId),
            getUsageHistory({
                companyId,
                startDate,
                endDate,
            }),
        ]);

        return NextResponse.json({ balanceTokens, usage: usage.map(withStringCompanyId) });
    } catch (error) {
        console.error("[Tokens] Error fetching usage:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

/** JSON has no bigint; company_id is a bigint column on both tables. */
function withStringCompanyId<T extends { companyId: bigint }>(row: T) {
    return { ...row, companyId: row.companyId.toString() };
}
