import { error, say, vantageContext } from "../../_http";

// Historical agendas are retained read-only. Canonical reviews own new decisions.
export async function PATCH(request: Request, _context: { params: Promise<{ id: string }> }) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    if (!auth.ctx.can("documents.edit"))
        return error(say(request, "legacyMutationForbidden"), 403, { code: "forbidden" });
    return error(say(request, "canonicalWeeklyReviewRequired"), 410, {
        code: "canonical_weekly_review_required",
    });
}
export async function DELETE(request: Request, _context: { params: Promise<{ id: string }> }) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    if (!auth.ctx.can("documents.edit"))
        return error(say(request, "legacyMutationForbidden"), 403, { code: "forbidden" });
    return error(say(request, "canonicalWeeklyReviewRequired"), 410, {
        code: "canonical_weekly_review_required",
    });
}
