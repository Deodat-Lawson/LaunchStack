import { NextResponse } from "next/server";
import { z } from "zod";
import {
    BusinessRoleInputSchema,
    parseConfirmedBusinessRole,
    type BusinessRoleContext,
} from "~/server/vantage/weekly-review-business-role";
import {
    weeklyReviewDatabase,
    weeklyReviewEnabled,
    weeklyReviewServices,
    budgetAwareInternalRetrievalEnabled,
} from "~/server/vantage/weekly-review-service";
import { WeeklyReviewConflict } from "~/server/vantage/weekly-review-types";
import { reviewActor, reviewError } from "../../_http";

const expectedVersion = z.number().int().nonnegative();
const roleWrite = z.union([
    BusinessRoleInputSchema.extend({ expectedVersion }),
    z.object({ expectedVersion, role: z.null() }).strict(),
]);

export async function GET() {
    const auth = await reviewActor();
    if (!auth.ok) return auth.response;
    try {
        const result = await weeklyReviewServices().authority.withReadableDocuments(
            auth.actor,
            async (query, _documents, actor) => {
                const row = (
                    await query(
                        "SELECT business_role_context,version FROM pdr_ai_v2_vantage_weekly_review_preferences WHERE company_id=$1::bigint AND actor_id=$2",
                        [auth.actor.companyId, auth.actor.userId]
                    )
                )[0];
                return {
                    role:
                        parseConfirmedBusinessRole(row?.business_role_context, auth.actor) ?? null,
                    version: Number(row?.version ?? 0),
                    canEdit: actor.canMutate,
                    enabled: budgetAwareInternalRetrievalEnabled(),
                };
            }
        );
        return NextResponse.json(result);
    } catch (error) {
        return reviewError(error);
    }
}

export async function PATCH(request: Request) {
    const auth = await reviewActor(true);
    if (!auth.ok) return auth.response;
    if (!weeklyReviewEnabled())
        return NextResponse.json({ error: "weekly_review_disabled" }, { status: 404 });
    if (!budgetAwareInternalRetrievalEnabled())
        return NextResponse.json({ error: "dynamic_retrieval_disabled" }, { status: 404 });
    try {
        const body = roleWrite.parse(await request.json());
        const result = await weeklyReviewDatabase.transaction(async query => {
            await query(
                "INSERT INTO pdr_ai_v2_vantage_weekly_review_epochs(company_id) VALUES($1::bigint) ON CONFLICT DO NOTHING",
                [auth.actor.companyId]
            );
            await query(
                "SELECT version FROM pdr_ai_v2_vantage_weekly_review_epochs WHERE company_id=$1::bigint FOR UPDATE",
                [auth.actor.companyId]
            );
            const fresh = await reviewActor(true);
            if (
                !fresh.ok ||
                fresh.actor.companyId !== auth.actor.companyId ||
                fresh.actor.userId !== auth.actor.userId ||
                !fresh.ctx.can("documents.read")
            )
                throw new WeeklyReviewConflict("review_access_denied", 403);
            const existing = (
                await query(
                    "SELECT version FROM pdr_ai_v2_vantage_weekly_review_preferences WHERE company_id=$1::bigint AND actor_id=$2 FOR UPDATE",
                    [auth.actor.companyId, auth.actor.userId]
                )
            )[0];
            if (Number(existing?.version ?? 0) !== body.expectedVersion)
                throw new WeeklyReviewConflict("stale_context_preferences");
            const revision = body.expectedVersion + 1;
            const role: BusinessRoleContext | null =
                "role" in body
                    ? null
                    : {
                          schemaVersion: "vantage-business-role/v1",
                          primaryRole: body.primaryRole,
                          responsibilities: body.responsibilities,
                          priorities: body.priorities,
                          confirmed: true,
                          confirmedBy: auth.actor.userId,
                          companyId: auth.actor.companyId,
                          revision,
                      };
            const rows = await query(
                "INSERT INTO pdr_ai_v2_vantage_weekly_review_preferences(company_id,actor_id,business_role_context) VALUES($1::bigint,$2,$3::text::jsonb) ON CONFLICT(company_id,actor_id) DO UPDATE SET business_role_context=EXCLUDED.business_role_context,version=pdr_ai_v2_vantage_weekly_review_preferences.version+1 WHERE pdr_ai_v2_vantage_weekly_review_preferences.version=$4 RETURNING version",
                [
                    auth.actor.companyId,
                    auth.actor.userId,
                    role ? JSON.stringify(role) : null,
                    body.expectedVersion,
                ]
            );
            if (!rows[0]) throw new WeeklyReviewConflict("stale_context_preferences");
            return { role, version: Number(rows[0].version) };
        });
        return NextResponse.json(result);
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError)
            return NextResponse.json({ error: "invalid_business_role" }, { status: 400 });
        return reviewError(error);
    }
}
