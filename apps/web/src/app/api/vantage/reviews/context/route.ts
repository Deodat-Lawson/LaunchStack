import { NextResponse } from "next/server";
import { z } from "zod";
import {
    weeklyReviewDatabase,
    weeklyReviewEnabled,
    weeklyReviewServices,
} from "~/server/vantage/weekly-review-service";
import { WeeklyReviewConflict } from "~/server/vantage/weekly-review-types";
import { reviewActor, reviewError } from "../_http";
const id = z.string().regex(/^[1-9]\d{0,17}$/);
export async function GET() {
    const auth = await reviewActor();
    if (!auth.ok) return auth.response;
    try {
        const documents = await weeklyReviewServices().authority.listReadableDocuments(auth.actor);
        return NextResponse.json(
            await weeklyReviewDatabase.transaction(async query => ({
                documents,
                enabled: weeklyReviewEnabled(),
                canConfigure: auth.ctx.can("settings.manage"),
                policy:
                    (
                        await query(
                            "SELECT architecture_document_id,required_document_ids,version FROM pdr_ai_v2_vantage_weekly_review_policy WHERE company_id=$1::bigint",
                            [auth.actor.companyId]
                        )
                    )[0] ?? null,
                preferences:
                    (
                        await query(
                            "SELECT star_document_ids,version FROM pdr_ai_v2_vantage_weekly_review_preferences WHERE company_id=$1::bigint AND actor_id=$2",
                            [auth.actor.companyId, auth.actor.userId]
                        )
                    )[0] ?? null,
            }))
        );
    } catch (error) {
        return reviewError(error);
    }
}
export async function POST(request: Request) {
    const auth = await reviewActor(true);
    if (!auth.ok) return auth.response;
    if (!weeklyReviewEnabled())
        return NextResponse.json({ error: "weekly_review_disabled" }, { status: 404 });
    if (!auth.ctx.can("settings.manage"))
        return NextResponse.json({ error: "review_policy_forbidden" }, { status: 403 });
    try {
        const body = z
            .object({
                expectedVersion: z.number().int().nonnegative(),
                architectureDocumentId: id,
                requiredDocumentIds: z.array(id).max(12),
            })
            .strict()
            .parse(await request.json());
        const version = await weeklyReviewDatabase.transaction(async query => {
            await query(
                "INSERT INTO pdr_ai_v2_vantage_weekly_review_epochs(company_id) VALUES($1::bigint) ON CONFLICT DO NOTHING",
                [auth.actor.companyId]
            );
            await query(
                "SELECT version FROM pdr_ai_v2_vantage_weekly_review_epochs WHERE company_id=$1::bigint FOR UPDATE",
                [auth.actor.companyId]
            );
            const existing = (
                await query(
                    "SELECT version FROM pdr_ai_v2_vantage_weekly_review_policy WHERE company_id=$1::bigint FOR UPDATE",
                    [auth.actor.companyId]
                )
            )[0];
            if (Number(existing?.version ?? 0) !== body.expectedVersion)
                throw new WeeklyReviewConflict("stale_context_policy");
            await weeklyReviewServices().authority.validateCompanySources(
                query,
                auth.actor,
                body.architectureDocumentId,
                body.requiredDocumentIds
            );
            const rows = await query(
                "INSERT INTO pdr_ai_v2_vantage_weekly_review_policy(company_id,architecture_document_id,required_document_ids) VALUES($1::bigint,$2::bigint,$3::jsonb) ON CONFLICT(company_id) DO UPDATE SET architecture_document_id=EXCLUDED.architecture_document_id,required_document_ids=EXCLUDED.required_document_ids,version=pdr_ai_v2_vantage_weekly_review_policy.version+1 WHERE pdr_ai_v2_vantage_weekly_review_policy.version=$4 RETURNING version",
                [
                    auth.actor.companyId,
                    body.architectureDocumentId,
                    JSON.stringify(body.requiredDocumentIds),
                    body.expectedVersion,
                ]
            );
            if (!rows[0]) throw new WeeklyReviewConflict("stale_context_policy");
            return rows[0].version;
        });
        return NextResponse.json({ version });
    } catch (error) {
        if (error instanceof z.ZodError)
            return NextResponse.json({ error: "invalid_context_policy" }, { status: 400 });
        return reviewError(error);
    }
}
export async function PATCH(request: Request) {
    const auth = await reviewActor(true);
    if (!auth.ok) return auth.response;
    if (!weeklyReviewEnabled())
        return NextResponse.json({ error: "weekly_review_disabled" }, { status: 404 });
    try {
        const body = z
            .object({
                expectedVersion: z.number().int().nonnegative(),
                starDocumentIds: z.array(id).max(8),
            })
            .strict()
            .parse(await request.json());
        const version = await weeklyReviewDatabase.transaction(async query => {
            const existing = (
                await query(
                    "SELECT version FROM pdr_ai_v2_vantage_weekly_review_preferences WHERE company_id=$1::bigint AND actor_id=$2 FOR UPDATE",
                    [auth.actor.companyId, auth.actor.userId]
                )
            )[0];
            if (Number(existing?.version ?? 0) !== body.expectedVersion)
                throw new WeeklyReviewConflict("stale_context_preferences");
            const rows = await query(
                "INSERT INTO pdr_ai_v2_vantage_weekly_review_preferences(company_id,actor_id,star_document_ids) VALUES($1::bigint,$2,$3::jsonb) ON CONFLICT(company_id,actor_id) DO UPDATE SET star_document_ids=EXCLUDED.star_document_ids,version=pdr_ai_v2_vantage_weekly_review_preferences.version+1 WHERE pdr_ai_v2_vantage_weekly_review_preferences.version=$4 RETURNING version",
                [
                    auth.actor.companyId,
                    auth.actor.userId,
                    JSON.stringify(body.starDocumentIds),
                    body.expectedVersion,
                ]
            );
            if (!rows[0]) throw new WeeklyReviewConflict("stale_context_preferences");
            return rows[0].version;
        });
        return NextResponse.json({ version });
    } catch (error) {
        if (error instanceof z.ZodError)
            return NextResponse.json({ error: "invalid_context_preferences" }, { status: 400 });
        return reviewError(error);
    }
}
