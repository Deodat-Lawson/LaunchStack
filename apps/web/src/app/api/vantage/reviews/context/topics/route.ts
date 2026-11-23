import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { weeklyReviewServices } from "~/server/vantage/weekly-review-service";
import {
    PersonalTopicInput,
    listPersonalTopics,
} from "~/server/vantage/weekly-review-personal-topics";
import { WeeklyReviewConflict } from "~/server/vantage/weekly-review-types";
import { reviewActor, reviewError } from "../../_http";

export async function GET() {
    const auth = await reviewActor();
    if (!auth.ok) return auth.response;
    try {
        return NextResponse.json(
            await weeklyReviewServices().authority.withReadableDocuments(
                auth.actor,
                async (query, documents, actor) => ({
                    topics: await listPersonalTopics(
                        query,
                        actor,
                        new Set(documents.map(d => d.id))
                    ),
                    documents,
                    canEdit: actor.canMutate,
                })
            )
        );
    } catch (error) {
        return reviewError(error);
    }
}

async function write(request: Request, update: boolean) {
    const auth = await reviewActor(true);
    if (!auth.ok) return auth.response;
    try {
        const schema = update
            ? PersonalTopicInput.extend({
                  id: z.string().uuid(),
                  expectedRevision: z.number().int().positive(),
              })
            : PersonalTopicInput;
        const body = schema.parse(await request.json());
        const id = "id" in body ? String(body.id) : randomUUID();
        const revision = "expectedRevision" in body ? Number(body.expectedRevision) : 0;
        const result = await weeklyReviewServices().authority.withReadableDocuments(
            auth.actor,
            async (query, documents, actor) => {
                if (!actor.canMutate) throw new WeeklyReviewConflict("review_access_denied", 403);
                const allowed = new Set(documents.map(d => d.id));
                if (body.watches.some(w => !allowed.has(w)))
                    throw new WeeklyReviewConflict("source_not_offered", 400);
                const { title, status, watches } = body;
                const guidance = PersonalTopicInput.omit({
                    title: true,
                    status: true,
                    watches: true,
                }).parse({
                    openQuestions: body.openQuestions,
                    decisionChangers: body.decisionChangers,
                    keywords: body.keywords,
                    people: body.people,
                    metrics: body.metrics,
                });
                const rows = update
                    ? await query(
                          "UPDATE pdr_ai_v2_vantage_personal_topics SET title=$4,guidance=$5::jsonb,status=$6,revision=revision+1,updated_at=now(),closed_at=CASE WHEN $6='closed' THEN now() ELSE NULL END WHERE id=$1::uuid AND company_id=$2::bigint AND owner_id=$3 AND revision=$7 RETURNING revision",
                          [
                              id,
                              actor.companyId,
                              actor.userId,
                              title,
                              JSON.stringify(guidance),
                              status,
                              revision,
                          ]
                      )
                    : await query(
                          "INSERT INTO pdr_ai_v2_vantage_personal_topics(id,company_id,owner_id,title,guidance,status,closed_at) VALUES($1::uuid,$2::bigint,$3,$4,$5::jsonb,$6,CASE WHEN $6='closed' THEN now() ELSE NULL END) RETURNING revision",
                          [
                              id,
                              actor.companyId,
                              actor.userId,
                              title,
                              JSON.stringify(guidance),
                              status,
                          ]
                      );
                if (!rows[0]) throw new WeeklyReviewConflict("stale_personal_topic", 409);
                await query(
                    "DELETE FROM pdr_ai_v2_vantage_personal_topic_watches WHERE topic_id=$1::uuid AND company_id=$2::bigint AND owner_id=$3",
                    [id, actor.companyId, actor.userId]
                );
                for (const documentId of new Set(watches))
                    await query(
                        "INSERT INTO pdr_ai_v2_vantage_personal_topic_watches(topic_id,company_id,owner_id,document_id) VALUES($1::uuid,$2::bigint,$3,$4::bigint)",
                        [id, actor.companyId, actor.userId, documentId]
                    );
                return { id, revision: Number(rows[0].revision) };
            }
        );
        return NextResponse.json(result);
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError)
            return NextResponse.json({ error: "invalid_personal_topic" }, { status: 400 });
        return reviewError(error);
    }
}
export function POST(request: Request) {
    return write(request, false);
}
export function PATCH(request: Request) {
    return write(request, true);
}
