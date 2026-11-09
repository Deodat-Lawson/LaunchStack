import { NextResponse } from "next/server";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { WeeklyReviewConflict } from "~/server/vantage/weekly-review-types";
export async function reviewActor(mutate = false) {
    const auth = await requireWorkspaceContext();
    if (!auth.success) return { ok: false as const, response: auth.response };
    if (!auth.data.can(mutate ? "documents.edit" : "documents.read"))
        return {
            ok: false as const,
            response: NextResponse.json({ error: "review_access_denied" }, { status: 403 }),
        };
    return {
        ok: true as const,
        ctx: auth.data,
        actor: { companyId: String(auth.data.companyId), userId: auth.data.authUserId },
    };
}
export function reviewError(error: unknown) {
    if (error instanceof WeeklyReviewConflict)
        return NextResponse.json({ error: error.code }, { status: error.status });
    console.error("[vantage] weekly review request failed");
    return NextResponse.json({ error: "review_unavailable" }, { status: 503 });
}
export function requestKey(request: Request) {
    const key = request.headers.get("Idempotency-Key");
    if (!key || !/^[A-Za-z0-9_-]{8,128}$/.test(key))
        throw new WeeklyReviewConflict("idempotency_key_required", 400);
    return key;
}
