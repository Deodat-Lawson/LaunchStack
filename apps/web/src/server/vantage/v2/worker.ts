import { inngest } from "~/server/inngest/client";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";
import { WeeklyReviewConflict } from "../weekly-review-types";
import { vantageV2Enabled } from "./enabled";
import { executeVantageTask } from "./execute";
import { createTaskExecutionRepository } from "./execution-repository";
import { vantageV2RetryPolicy } from "./model-journal";
import { createVantageTaskModel } from "./task-model";

export const VANTAGE_TASK_EVENT = "vantage/task.requested" as const;

export async function runVantageTask(taskId: string) {
    if (!vantageV2Enabled()) return { status: "disabled" };
    const repository = createTaskExecutionRepository();
    const claim = await repository.claim(taskId);
    if (!claim) return { status: "skipped" };
    const authorize = async () => {
        await repository.inspect(claim);
    };
    try {
        const frozen = await repository.inspect(claim);
        const policy = vantageV2RetryPolicy({
            actor: { companyId: claim.companyId, userId: claim.ownerId },
            reviewId: claim.reviewId,
            stage: "task_execution",
            deadlineAt: claim.deadlineAt,
            assertAuthority: query => repository.assertInTransaction(query, claim),
        });
        return await withWorkspaceChatModels(
            BigInt(claim.companyId),
            { feature: "vantage", userId: claim.ownerId, enforce: false },
            () =>
                executeVantageTask(claim, {
                    authorize,
                    refs: frozen.sources.map(source => source.ref),
                    readBrief: async () => (await repository.inspect(claim)).brief,
                    readExcerpt: async (_claim, ref) => {
                        const source = (await repository.inspect(claim)).sources.find(
                            item => item.ref === ref
                        );
                        if (!source) throw new Error("task_source_unavailable");
                        return source.text;
                    },
                    beforeAttempt: info => policy.beforeAttempt(info),
                    model: (_turn, retry) => createVantageTaskModel(claim.deadlineAt, retry),
                    commit: (current, result) => repository.commit(current, result),
                    fail: (current, reason) => repository.fail(current, reason),
                })
        );
    } catch (error) {
        await repository.fail(
            claim,
            error instanceof WeeklyReviewConflict
                ? "task_authority_revoked"
                : "task_provider_unavailable"
        );
        return { status: "failed" };
    }
}

export async function wakeVantageTasks(taskIds: readonly string[]) {
    if (!vantageV2Enabled() || !taskIds.length) return;
    await inngest.send(taskIds.map(taskId => ({ name: VANTAGE_TASK_EVENT, data: { taskId } })));
}

export const vantageTaskJob = inngest.createFunction(
    {
        id: "vantage-task",
        name: "Vantage read-only task",
        retries: 0,
        concurrency: [{ key: "event.data.taskId", limit: 1 }, { limit: 4 }],
    },
    { event: VANTAGE_TASK_EVENT },
    async ({ event, step }) => step.run("execute", () => runVantageTask(event.data.taskId))
);
