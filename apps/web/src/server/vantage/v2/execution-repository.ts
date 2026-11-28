import { randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret } from "@launchstack/store/crypto";
import { z } from "zod";
import { weeklyReviewDatabase } from "../weekly-review-service";
import { inspectFrozenEvidence } from "../weekly-review-evidence-inspection";
import {
    WeeklyReviewConflict,
    type WeeklyReviewDatabase,
    type WeeklyReviewQuery,
} from "../weekly-review-types";
import { assertVantageV2Authority } from "./authority";
import { vantageV2Enabled } from "./enabled";
import { TaskResultSchema, type TaskExecutionClaim, type VantageTaskResult } from "./execute";
import { loadSettings } from "./settings";

const SourcesSchema = z
    .object({
        inputSnapshot: z
            .object({
                sources: z.array(z.object({ ref: z.string(), text: z.string() }).passthrough()),
            })
            .passthrough(),
    })
    .passthrough();
const unavailable = () => new WeeklyReviewConflict("task_unavailable", 409);
const identity = (row: Record<string, unknown>) => ({
    companyId: String(row.company_id),
    userId: String(row.owner_id),
});

export function createTaskExecutionRepository(
    database: WeeklyReviewDatabase = weeklyReviewDatabase
) {
    async function locked(query: WeeklyReviewQuery, taskId: string) {
        const select =
            "SELECT t.*,p.review_id,p.company_id,p.owner_id,p.version AS plan_version,p.hash AS plan_hash,p.approved_version,p.approved_hash FROM pdr_ai_v2_vantage_v2_tasks t JOIN pdr_ai_v2_vantage_v2_plans p ON p.id=t.plan_id WHERE t.id=$1::uuid";
        const observed = (await query(select, [taskId]))[0];
        if (!observed || !vantageV2Enabled()) throw unavailable();
        // Match owner mutation order: V1 epoch/source guard before plan/task locks.
        await assertVantageV2Authority(query, identity(observed), String(observed.review_id));
        const rows = await query(select + " FOR UPDATE OF p,t", [taskId]);
        const row = rows[0];
        if (!row || !vantageV2Enabled()) throw unavailable();
        return row;
    }
    async function authorize(
        query: WeeklyReviewQuery,
        row: Record<string, unknown>,
        claim?: TaskExecutionClaim
    ) {
        if (
            row.approved_version === null ||
            Number(row.approved_version) !== Number(row.plan_version) ||
            row.approved_hash !== row.plan_hash
        )
            throw unavailable();
        if (row.assignee_type !== "persona") throw unavailable();
        const settings = await loadSettings(query, identity(row));
        if (!settings.personaIds.includes(String(row.assignee_id))) throw unavailable();
        const persona = (
            await query(
                "SELECT role FROM pdr_ai_v2_collab_agent_persona WHERE id=$1 AND company_id=$2::bigint AND archived=false",
                [row.assignee_id, row.company_id]
            )
        )[0];
        if (!persona) throw unavailable();
        if (claim) {
            if (
                row.status !== "running" ||
                row.claim_token !== claim.claimToken ||
                row.attempt_id !== claim.attemptId ||
                Number(row.plan_version) !== claim.planVersion ||
                row.plan_hash !== claim.planHash
            )
                throw unavailable();
            const live = await query("SELECT 1 WHERE $1::timestamptz>clock_timestamp()", [
                row.lease_until,
            ]);
            if (!live.length) throw unavailable();
        }
        const review = await assertVantageV2Authority(query, identity(row), String(row.review_id));
        return { review, persona };
    }
    return {
        async assertInTransaction(query: WeeklyReviewQuery, claim: TaskExecutionClaim) {
            const row = await locked(query, claim.taskId);
            await authorize(query, row, claim);
        },
        async claim(taskId: string): Promise<TaskExecutionClaim | null> {
            try {
                return await database.transaction(async query => {
                    const row = await locked(query, taskId);
                    // An expired attempt terminalizes. Replayed deliveries cannot silently restart it.
                    if (row.status !== "queued") return null;
                    const { persona } = await authorize(query, row);
                    const task = z
                        .object({ title: z.string(), description: z.string() })
                        .passthrough()
                        .parse(
                            JSON.parse(
                                decryptSecret(
                                    String(row.ciphertext),
                                    `vantage-v2-task:${String(row.company_id)}:${String(row.owner_id)}:${taskId}`
                                )
                            )
                        );
                    const claimToken = randomUUID();
                    const attemptId = randomUUID();
                    const updated = await query(
                        "UPDATE pdr_ai_v2_vantage_v2_tasks SET status='running',claim_token=$2::uuid,attempt_id=$3::uuid,lease_until=clock_timestamp()+interval '3 minutes',attempt=attempt+1,version=version+1 WHERE id=$1::uuid AND status='queued' RETURNING lease_until",
                        [taskId, claimToken, attemptId]
                    );
                    if (!updated[0]) return null;
                    return {
                        taskId,
                        planId: String(row.plan_id),
                        reviewId: String(row.review_id),
                        companyId: String(row.company_id),
                        ownerId: String(row.owner_id),
                        claimToken,
                        attemptId,
                        planVersion: Number(row.plan_version),
                        planHash: String(row.plan_hash),
                        deadlineAt: new Date(String(updated[0].lease_until)).getTime(),
                        instructions: JSON.stringify(task),
                        personaRole: String(persona.role),
                    };
                });
            } catch (error) {
                if (!(error instanceof WeeklyReviewConflict)) throw error;
                // Denied dispatch stays visible as a blocked attempt, without private error text.
                await database.transaction(query =>
                    query(
                        "UPDATE pdr_ai_v2_vantage_v2_tasks SET status='blocked',reason='task_authority_revoked',attempt=attempt+1,attempt_id=$2::uuid,claim_token=NULL,lease_until=NULL,version=version+1 WHERE id=$1::uuid AND status='queued' AND assignee_type='persona'",
                        [taskId, randomUUID()]
                    ).then(() => undefined)
                );
                return null;
            }
        },
        async inspect(claim: TaskExecutionClaim) {
            return database.transaction(async query => {
                const row = await locked(query, claim.taskId);
                const { review } = await authorize(query, row, claim);
                const sources = SourcesSchema.parse(review.evidence).inputSnapshot.sources.map(
                    source => inspectFrozenEvidence(review.evidence, source.ref)
                );
                return { brief: review.report, sources };
            });
        },
        async commit(claim: TaskExecutionClaim, result: VantageTaskResult) {
            return database.transaction(async query => {
                const row = await locked(query, claim.taskId);
                const { review } = await authorize(query, row, claim);
                const parsed = TaskResultSchema.parse(result);
                const refs = new Set(
                    SourcesSchema.parse(review.evidence).inputSnapshot.sources.map(
                        source => source.ref
                    )
                );
                if (parsed.claims.some(item => item.refs.some(ref => !refs.has(ref))))
                    throw unavailable();
                const ciphertext = encryptSecret(
                    JSON.stringify(parsed),
                    `vantage-v2-task:${claim.companyId}:${claim.ownerId}:${claim.taskId}:result`
                ).ciphertext;
                const updated = await query(
                    "UPDATE pdr_ai_v2_vantage_v2_tasks SET status='submitted',result_ciphertext=$3,claim_token=NULL,lease_until=NULL,version=version+1 WHERE id=$1::uuid AND claim_token=$2::uuid AND attempt_id=$4::uuid AND lease_until>clock_timestamp() RETURNING id",
                    [claim.taskId, claim.claimToken, ciphertext, claim.attemptId]
                );
                if (!updated.length) throw unavailable();
            });
        },
        async fail(claim: TaskExecutionClaim, reason: string) {
            await database.transaction(query =>
                query(
                    "UPDATE pdr_ai_v2_vantage_v2_tasks SET status=$5,reason=$3,claim_token=NULL,lease_until=NULL,version=version+1 WHERE id=$1::uuid AND claim_token=$2::uuid AND attempt_id=$4::uuid",
                    [
                        claim.taskId,
                        claim.claimToken,
                        reason,
                        claim.attemptId,
                        reason === "task_authority_revoked" ? "blocked" : "failed",
                    ]
                ).then(() => undefined)
            );
        },
    };
}
