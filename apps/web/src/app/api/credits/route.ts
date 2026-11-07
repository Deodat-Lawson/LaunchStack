import { NextResponse } from "next/server";
import { ensureTokenAccount } from "~/lib/credits";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { requestTranslator } from "~/i18n/server";

export async function GET(request: Request) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const balanceTokens = await ensureTokenAccount(ctx.data.companyId);

        return NextResponse.json({ balanceTokens });
    } catch (error) {
        console.error("[Tokens] Error fetching balance:", error);
        return NextResponse.json(
            { error: requestTranslator(request, "errors.api")("internal") },
            { status: 500 }
        );
    }
}
