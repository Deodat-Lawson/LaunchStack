import { z } from "zod";
import { TaskResultSchema } from "./execute";
import { createHash, randomUUID } from "node:crypto";
import { encryptSecret, decryptSecret } from "@launchstack/store/crypto";
import {
    WeeklyReviewConflict,
    type WeeklyReviewActor,
    type WeeklyReviewQuery,
    type WeeklyReviewDatabase,
} from "../weekly-review-types";
import { type VantagePlan, type VantageTask, TaskPatch, ActionInput } from "./contracts";
import { assertVantageV2Authority } from "./authority";
import { eligiblePersonas, loadSettings } from "./settings";
export const planAAD = (a: WeeklyReviewActor, id: string) =>
    "vantage-v2-plan:" + a.companyId + ":" + a.userId + ":" + id;
export const taskAAD = (a: WeeklyReviewActor, id: string) =>
    "vantage-v2-task:" + a.companyId + ":" + a.userId + ":" + id;
export const planHash = (tasks: VantageTask[]) =>
    createHash("sha256")
        .update(
            JSON.stringify(
                [...tasks]
                    .sort((a, b) => a.id.localeCompare(b.id))
                    .map(
                        ({
                            id,
                            topicId,
                            parentId,
                            title,
                            description,
                            acceptanceCriterion,
                            workType,
                            priority,
                            assigneeType,
                            assigneeId,
                            refs,
                            provenance,
                        }) => ({
                            id,
                            topicId,
                            parentId,
                            title,
                            description,
                            acceptanceCriterion,
                            workType,
                            priority,
                            assigneeType,
                            assigneeId,
                            refs,
                            provenance,
                        })
                    )
            )
        )
        .digest("hex");
function resultProjection(ciphertext: string, aad: string) {
    const text = decryptSecret(ciphertext, aad);
    try {
        const parsed = TaskResultSchema.safeParse(JSON.parse(text));
        return parsed.success
            ? { result: parsed.data.summary, structuredResult: parsed.data }
            : { result: text };
    } catch {
        return { result: text };
    }
}
export function createVantageV2Repository(db: WeeklyReviewDatabase) {
    async function planFor(
        q: WeeklyReviewQuery,
        a: WeeklyReviewActor,
        reviewId: string,
        lock = false
    ): Promise<VantagePlan | null> {
        const rows = await q(
            "SELECT * FROM pdr_ai_v2_vantage_v2_plans WHERE review_id=$1::uuid AND company_id=$2::bigint AND owner_id=$3" +
                (lock ? " FOR UPDATE" : ""),
            [reviewId, a.companyId, a.userId]
        );
        if (!rows[0]) return null;
        const r = rows[0];
        const p = JSON.parse(
            decryptSecret(String(r.ciphertext), planAAD(a, String(r.id)))
        ) as VantagePlan;
        const ts = await q(
            "SELECT * FROM pdr_ai_v2_vantage_v2_tasks WHERE plan_id=$1::uuid ORDER BY id",
            [r.id]
        );
        p.tasks = ts.map(t => ({
            ...(JSON.parse(
                decryptSecret(String(t.ciphertext), taskAAD(a, String(t.id)))
            ) as VantageTask),
            status: t.status as VantageTask["status"],
            version: Number(t.version),
            ...(t.attempt_id
                ? {
                      latestAttempt: {
                          id: z.string().parse(t.attempt_id),
                          number: Number(t.attempt),
                          status: t.status as VantageTask["status"],
                          reason: typeof t.reason === "string" ? t.reason : undefined,
                          leaseUntil: t.lease_until
                              ? new Date(t.lease_until as string).toISOString()
                              : null,
                      },
                  }
                : {}),
            ...(t.reason ? { reason: z.string().parse(t.reason) } : {}),
            ...(t.result_ciphertext
                ? resultProjection(
                      z.string().parse(t.result_ciphertext),
                      taskAAD(a, String(t.id)) + ":result"
                  )
                : {}),
        }));
        return {
            ...p,
            version: Number(r.version),
            hash: String(r.hash),
            approvedVersion: r.approved_version === null ? null : Number(r.approved_version),
            approvedHash: r.approved_hash === null ? null : z.string().parse(r.approved_hash),
        };
    }
    async function saveTask(
        q: WeeklyReviewQuery,
        a: WeeklyReviewActor,
        p: VantagePlan,
        t: VantageTask
    ) {
        await q(
            "INSERT INTO pdr_ai_v2_vantage_v2_tasks(id,plan_id,topic_id,parent_id,assignee_type,assignee_id,status,version,ciphertext) VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET assignee_type=EXCLUDED.assignee_type,assignee_id=EXCLUDED.assignee_id,status=EXCLUDED.status,version=EXCLUDED.version,ciphertext=EXCLUDED.ciphertext",
            [
                t.id,
                p.id,
                t.topicId,
                t.parentId,
                t.assigneeType,
                t.assigneeId,
                t.status,
                t.version,
                encryptSecret(JSON.stringify(t), taskAAD(a, t.id)).ciphertext,
            ]
        );
    }
    async function selected(q: WeeklyReviewQuery, a: WeeklyReviewActor, tasks: VantageTask[]) {
        const settings = await loadSettings(q, a);
        const personas = await eligiblePersonas(q, a);
        for (const t of tasks) {
            if (
                t.assigneeType === "persona" &&
                !["analysis", "comparison", "draft"].includes(t.workType ?? "")
            )
                throw new WeeklyReviewConflict("task_read_only_work_required", 400);
            if (
                t.assigneeType === "owner"
                    ? t.assigneeId !== a.userId
                    : !settings.personaIds.includes(t.assigneeId) ||
                      !personas.some(p => p.id === t.assigneeId)
            )
                throw new WeeklyReviewConflict("task_assignee_invalid", 400);
        }
    }
    async function mutate(
        a: WeeklyReviewActor,
        id: string,
        expected: number,
        work: (q: WeeklyReviewQuery, p: VantagePlan, t: VantageTask) => Promise<boolean>
    ) {
        return db.transaction(async q => {
            const rows = await q(
                "SELECT p.review_id FROM pdr_ai_v2_vantage_v2_tasks t JOIN pdr_ai_v2_vantage_v2_plans p ON p.id=t.plan_id WHERE t.id=$1::uuid AND p.company_id=$2::bigint AND p.owner_id=$3",
                [id, a.companyId, a.userId]
            );
            if (!rows[0]) throw new WeeklyReviewConflict("task_unavailable", 404);
            const reviewId = String(rows[0].review_id);
            await assertVantageV2Authority(q, a, reviewId);
            const p = await planFor(q, a, reviewId, true);
            const t = p?.tasks.find(t => t.id === id);
            if (!p || !t) throw new WeeklyReviewConflict("task_unavailable", 404);
            if (t.version !== expected) throw new WeeklyReviewConflict("task_version_conflict");
            const edited = await work(q, p, t);
            if (edited) {
                p.version++;
                p.hash = planHash(p.tasks);
                p.approvedVersion = null;
                p.approvedHash = null;
                for (const active of p.tasks)
                    if (active.status === "queued" || active.status === "running") {
                        active.status = "proposed";
                        active.version++;
                        delete active.result;
                        delete active.structuredResult;
                        delete active.reason;
                        delete active.latestAttempt;
                        await saveTask(q, a, p, active);
                    }
                await q(
                    "UPDATE pdr_ai_v2_vantage_v2_tasks SET claim_token=NULL,lease_until=NULL,attempt_id=NULL,result_ciphertext=NULL,reason=NULL WHERE plan_id=$1::uuid AND status='proposed'",
                    [p.id]
                );
                await q(
                    "UPDATE pdr_ai_v2_vantage_v2_plans SET version=$2,hash=$3,approved_version=NULL,approved_hash=NULL WHERE id=$1::uuid",
                    [p.id, p.version, p.hash]
                );
            }
            return { plan: p };
        });
    }
    return {
        get(a: WeeklyReviewActor, id: string) {
            return db.transaction(async q => {
                await assertVantageV2Authority(q, a, id, "read");
                return { plan: await planFor(q, a, id) };
            });
        },
        create(
            a: WeeklyReviewActor,
            reviewId: string,
            proposals: { tasks: VantageTask[]; discarded: { reason: string }[] }
        ) {
            return db.transaction(async q => {
                await assertVantageV2Authority(q, a, reviewId);
                await q(
                    "SELECT id FROM pdr_ai_v2_vantage_weekly_review_runs WHERE id=$1::uuid FOR UPDATE",
                    [reviewId]
                );
                const old = await planFor(q, a, reviewId);
                if (old) return { plan: old };
                await selected(q, a, proposals.tasks);
                const p: VantagePlan = {
                    id: randomUUID(),
                    reviewId,
                    version: 1,
                    hash: planHash(proposals.tasks),
                    approvedVersion: null,
                    approvedHash: null,
                    ...proposals,
                };
                await q(
                    "INSERT INTO pdr_ai_v2_vantage_v2_plans(id,review_id,company_id,owner_id,version,hash,ciphertext) VALUES($1::uuid,$2::uuid,$3::bigint,$4,1,$5,$6)",
                    [
                        p.id,
                        reviewId,
                        a.companyId,
                        a.userId,
                        p.hash,
                        encryptSecret(JSON.stringify({ ...p, tasks: [] }), planAAD(a, p.id))
                            .ciphertext,
                    ]
                );
                for (const t of p.tasks) await saveTask(q, a, p, t);
                return { plan: p };
            });
        },
        patch(a: WeeklyReviewActor, id: string, input: unknown) {
            const { expectedVersion, ...patch } = TaskPatch.parse(input);
            if (patch.assigneeType === "owner") patch.assigneeId = a.userId;
            return mutate(a, id, expectedVersion, async (q, p, t) => {
                const assignmentChanged =
                    (patch.assigneeType !== undefined && patch.assigneeType !== t.assigneeType) ||
                    (patch.assigneeId !== undefined && patch.assigneeId !== t.assigneeId);
                const criterionChanged =
                    patch.acceptanceCriterion !== undefined &&
                    patch.acceptanceCriterion !== t.acceptanceCriterion;
                if (
                    (patch.assigneeType ?? t.assigneeType) === "persona" &&
                    (assignmentChanged || criterionChanged) &&
                    !patch.workType
                )
                    throw new WeeklyReviewConflict("task_read_only_work_required", 400);
                Object.assign(t, patch);
                t.status = "proposed";
                delete t.result;
                delete t.structuredResult;
                delete t.reason;
                delete t.latestAttempt;
                await selected(q, a, [t]);
                t.version++;
                await saveTask(q, a, p, t);
                return true;
            });
        },
        remove(a: WeeklyReviewActor, id: string, expected: number) {
            return mutate(a, id, expected, async (q, p, t) => {
                await q("DELETE FROM pdr_ai_v2_vantage_v2_tasks WHERE id=$1::uuid", [t.id]);
                p.tasks = p.tasks.filter(x => x.id !== id);
                return true;
            });
        },
        approve(a: WeeklyReviewActor, id: string, version: number, hash: string) {
            return db.transaction(async q => {
                await assertVantageV2Authority(q, a, id);
                const p = await planFor(q, a, id, true);
                if (!p) throw new WeeklyReviewConflict("plan_unavailable", 404);
                if (p.version !== version || p.hash !== hash)
                    throw new WeeklyReviewConflict("plan_version_conflict");
                if (p.approvedVersion !== null) return { plan: p };
                await selected(q, a, p.tasks);
                await q(
                    "UPDATE pdr_ai_v2_vantage_v2_plans SET approved_version=version,approved_hash=hash WHERE id=$1::uuid",
                    [p.id]
                );
                for (const t of p.tasks)
                    if (
                        t.assigneeType === "persona" &&
                        ["proposed", "failed", "blocked"].includes(t.status)
                    ) {
                        t.status = "queued";
                        t.version++;
                        await saveTask(q, a, p, t);
                    }
                p.approvedVersion = p.version;
                p.approvedHash = p.hash;
                return { plan: p };
            });
        },
        action(a: WeeklyReviewActor, id: string, input: unknown) {
            const action = ActionInput.parse(input);
            if (action.action === "complete" && !action.result?.trim())
                throw new WeeklyReviewConflict("invalid_request", 400);
            return mutate(a, id, action.expectedVersion, async (q, p, t) => {
                if (p.approvedVersion === null)
                    throw new WeeklyReviewConflict("plan_approval_required");
                if (action.action === "run" || action.action === "rework")
                    await selected(q, a, [t]);
                if (action.action === "cancel") {
                    if (["completed", "cancelled"].includes(t.status))
                        throw new WeeklyReviewConflict("task_transition_invalid");
                    t.status = "cancelled";
                    await q(
                        "UPDATE pdr_ai_v2_vantage_v2_tasks SET claim_token=NULL,lease_until=NULL WHERE id=$1::uuid",
                        [t.id]
                    );
                } else if (action.action === "complete") {
                    if (t.assigneeType !== "owner" || t.status !== "proposed")
                        throw new WeeklyReviewConflict("task_transition_invalid");
                    t.status = "completed";
                    t.result = action.result;
                } else if (action.action === "accept") {
                    if (t.status !== "submitted")
                        throw new WeeklyReviewConflict("task_transition_invalid");
                    t.status = "completed";
                } else {
                    const expiredRunning = action.action === "run" && t.status === "running";
                    if (expiredRunning) {
                        const expired = await q(
                            "SELECT 1 FROM pdr_ai_v2_vantage_v2_tasks WHERE id=$1::uuid AND lease_until<=now()",
                            [t.id]
                        );
                        if (!expired.length) throw new WeeklyReviewConflict("task_in_progress");
                    }
                    if (
                        t.assigneeType !== "persona" ||
                        (!(
                            action.action === "rework"
                                ? ["submitted", "failed", "blocked"]
                                : ["queued", "failed", "blocked"]
                        ).includes(t.status) &&
                            !expiredRunning)
                    )
                        throw new WeeklyReviewConflict("task_transition_invalid");
                    t.status = "queued";
                    delete t.result;
                    delete t.structuredResult;
                    delete t.reason;
                    delete t.latestAttempt;
                    await q(
                        "UPDATE pdr_ai_v2_vantage_v2_tasks SET claim_token=NULL,lease_until=NULL,attempt_id=NULL,result_ciphertext=NULL,reason=NULL WHERE id=$1::uuid",
                        [t.id]
                    );
                }
                t.version++;
                await saveTask(q, a, p, t);
                return false;
            });
        },
    };
}
