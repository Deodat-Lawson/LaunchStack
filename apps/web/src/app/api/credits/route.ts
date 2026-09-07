import { NextResponse } from "next/server";
import { ensureTokenAccount } from "~/lib/credits";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

export async function GET() {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const balanceTokens = await ensureTokenAccount(ctx.data.companyId);

        return NextResponse.json({ balanceTokens });
    } catch (error) {
        console.error("[Tokens] Error fetching balance:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
