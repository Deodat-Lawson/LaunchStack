import { z } from "zod";
import type { WeeklyReviewActor, WeeklyReviewQuery } from "./weekly-review-types";

const items = (max: number) => z.array(z.string().trim().min(1).max(400)).max(max);
export const PersonalTopicInput = z
    .object({
        title: z.string().trim().min(1).max(200),
        openQuestions: items(8),
        decisionChangers: items(8),
        keywords: items(16),
        people: items(8),
        metrics: items(8),
        status: z.enum(["active", "closed"]),
        watches: z.array(z.string().regex(/^[1-9]\d*$/)).max(50),
    })
    .strict();
export type PersonalTopic = z.infer<typeof PersonalTopicInput> & { id: string; revision: number };

export async function listPersonalTopics(
    query: WeeklyReviewQuery,
    actor: WeeklyReviewActor,
    readableIds: ReadonlySet<string>
): Promise<PersonalTopic[]> {
    const rows = await query(
        "SELECT id,title,guidance,status,revision FROM pdr_ai_v2_vantage_personal_topics WHERE company_id=$1::bigint AND owner_id=$2 ORDER BY created_at,id LIMIT 100",
        [actor.companyId, actor.userId]
    );
    const watches = await query(
        "SELECT w.topic_id,w.document_id FROM pdr_ai_v2_vantage_personal_topic_watches w JOIN pdr_ai_v2_vantage_personal_topics t ON t.id=w.topic_id AND t.company_id=w.company_id AND t.owner_id=w.owner_id WHERE w.company_id=$1::bigint AND w.owner_id=$2",
        [actor.companyId, actor.userId]
    );
    return rows.map(row => ({
        ...PersonalTopicInput.parse({
            title: row.title,
            ...(row.guidance as object),
            status: row.status,
            watches: watches
                .filter(
                    w =>
                        String(w.topic_id) === String(row.id) &&
                        readableIds.has(String(w.document_id))
                )
                .map(w => String(w.document_id)),
        }),
        id: String(row.id),
        revision: Number(row.revision),
    }));
}
