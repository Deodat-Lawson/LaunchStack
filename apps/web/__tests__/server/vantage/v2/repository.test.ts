jest.mock("~/server/vantage/v2/authority", () => ({
    assertVantageV2Authority: jest.fn(async () => ({})),
}));
jest.mock("~/server/vantage/v2/settings", () => ({
    loadSettings: jest.fn(async () => ({ personaIds: ["agent"] })),
    eligiblePersonas: jest.fn(async () => [{ id: "agent" }]),
}));
jest.mock("@launchstack/store/crypto", () => ({
    encryptSecret: (text: string, aad: string) => ({ ciphertext: JSON.stringify([aad, text]) }),
    decryptSecret: (text: string, aad: string) => {
        const [stored, value] = JSON.parse(text);
        if (stored !== aad) throw Error("aad mismatch");
        return value;
    },
}));
import {
    createVantageV2Repository,
    planHash,
    planAAD,
    taskAAD,
} from "~/server/vantage/v2/repository";
import { encryptSecret } from "@launchstack/store/crypto";
import { assertVantageV2Authority } from "~/server/vantage/v2/authority";
import type { WeeklyReviewDatabase, WeeklyReviewQuery } from "~/server/vantage/weekly-review-types";
import type { VantagePlan, VantageTask } from "~/server/vantage/v2/contracts";
const actor = { companyId: "1", userId: "owner" };
const task: VantageTask = {
    id: "task",
    parentId: null,
    topicId: "topic",
    title: "Draft",
    description: "Review",
    acceptanceCriterion: "Reviewed summary",
    workType: "draft",
    priority: "medium",
    assigneeType: "persona",
    assigneeId: "agent",
    refs: [],
    provenance: "proposal",
    version: 1,
    status: "proposed",
};
function fixture(initialTask = task) {
    const plan: VantagePlan = {
        id: "plan",
        reviewId: "review",
        version: 1,
        hash: planHash([initialTask]),
        approvedVersion: null,
        approvedHash: null,
        tasks: [{ ...initialTask }],
        discarded: [],
    };
    let row: Record<string, unknown> = {
        id: plan.id,
        version: 1,
        hash: plan.hash,
        approved_version: null,
        approved_hash: null,
        ciphertext: encryptSecret(JSON.stringify({ ...plan, tasks: [] }), planAAD(actor, plan.id))
            .ciphertext,
    };
    let trow: Record<string, unknown> = {
        ...initialTask,
        assignee_type: initialTask.assigneeType,
        assignee_id: initialTask.assigneeId,
        ciphertext: encryptSecret(JSON.stringify(initialTask), taskAAD(actor, initialTask.id))
            .ciphertext,
    };
    const queries: string[] = [];
    const q: WeeklyReviewQuery = async (text, args = []) => {
        queries.push(text);
        if (text.startsWith("SELECT p.review_id")) return [{ review_id: "review" }];
        if (text.startsWith("SELECT 1 FROM pdr_ai_v2_vantage_v2_tasks"))
            return new Date(trow.lease_until as string).getTime() <= Date.now() ? [{}] : [];
        if (text.startsWith("UPDATE pdr_ai_v2_vantage_v2_tasks SET claim_token")) {
            trow = {
                ...trow,
                claim_token: null,
                lease_until: null,
                attempt_id: null,
                result_ciphertext: null,
                reason: null,
            };
            return [];
        }
        if (text.startsWith("SELECT * FROM pdr_ai_v2_vantage_v2_plans")) return [row];
        if (text.startsWith("SELECT * FROM pdr_ai_v2_vantage_v2_tasks")) return [trow];
        if (text.includes("SET approved_version")) {
            row = { ...row, approved_version: row.version, approved_hash: row.hash };
            return [];
        }
        if (text.startsWith("UPDATE pdr_ai_v2_vantage_v2_plans SET version")) {
            row = {
                ...row,
                version: args[1],
                hash: args[2],
                approved_version: null,
                approved_hash: null,
            };
            return [];
        }
        if (text.startsWith("INSERT INTO pdr_ai_v2_vantage_v2_tasks")) {
            trow = { ...trow, status: args[6], version: args[7], ciphertext: args[8] };
            return [];
        }
        return [];
    };
    let tail = Promise.resolve();
    const database: WeeklyReviewDatabase = {
        transaction: async work => {
            const previous = tail;
            let release!: () => void;
            tail = new Promise<void>(r => {
                release = r;
            });
            await previous;
            try {
                return await work(q);
            } finally {
                release();
            }
        },
    };
    return {
        repo: createVantageV2Repository(database),
        queries,
        plan,
        setTask: (values: Record<string, unknown>) => {
            trow = { ...trow, ...values };
        },
    };
}
beforeEach(() => jest.clearAllMocks());
it("serializes stale edits with exact task version and locks plan before update", async () => {
    const f = fixture();
    const result = await Promise.allSettled([
        f.repo.patch(actor, "task", { expectedVersion: 1, title: "First" }),
        f.repo.patch(actor, "task", { expectedVersion: 1, title: "Second" }),
    ]);
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(result.filter(r => r.status === "rejected")).toHaveLength(1);
    expect(f.queries.some(q => q.endsWith("FOR UPDATE"))).toBe(true);
    expect(assertVantageV2Authority).toHaveBeenCalled();
});
it("rejects stale approval and requires reapproval after editing approved work", async () => {
    const f = fixture();
    await expect(f.repo.approve(actor, "review", 2, f.plan.hash)).rejects.toMatchObject({
        code: "plan_version_conflict",
    });
    const approved = await f.repo.approve(actor, "review", 1, f.plan.hash);
    expect(approved.plan.tasks[0]?.status).toBe("queued");
    expect(approved.plan.approvedHash).toBe(f.plan.hash);
    const edited = await f.repo.patch(actor, "task", { expectedVersion: 2, title: "Changed" });
    expect(edited.plan.approvedHash).toBeNull();
    expect(edited.plan.approvedVersion).toBeNull();
    expect(edited.plan.version).toBe(2);
    expect(edited.plan.tasks[0]?.status).toBe("proposed");
    expect(
        f.queries.some(q => q.includes("claim_token=NULL") && q.includes("result_ciphertext=NULL"))
    ).toBe(true);
    await expect(f.repo.approve(actor, "review", 1, f.plan.hash)).rejects.toMatchObject({
        code: "plan_version_conflict",
    });
    const reapproved = await f.repo.approve(actor, "review", edited.plan.version, edited.plan.hash);
    expect(reapproved.plan.tasks[0]?.status).toBe("queued");
});
it.each(["edit", "approve"] as const)(
    "serializes a simultaneous approve and edit when %s locks first",
    async first => {
        const f = fixture();
        const edit = () => f.repo.patch(actor, "task", { expectedVersion: 1, title: "Changed" });
        const approve = () => f.repo.approve(actor, "review", 1, f.plan.hash);
        const outcomes = await Promise.allSettled(
            first === "edit" ? [edit(), approve()] : [approve(), edit()]
        );
        expect(outcomes[0]?.status).toBe("fulfilled");
        expect(outcomes[1]).toMatchObject({
            status: "rejected",
            reason: { code: first === "edit" ? "plan_version_conflict" : "task_version_conflict" },
        });
        const current = (await f.repo.get(actor, "review")).plan;
        expect(current?.approvedHash).toBe(first === "edit" ? null : f.plan.hash);
    }
);
it("requires a note to complete an owner task", () => {
    const f = fixture();
    expect(() =>
        f.repo.action(actor, "task", { action: "complete", expectedVersion: 1, result: "   " })
    ).toThrow("invalid_request");
    expect(f.queries).toEqual([]);
});
it("does not mutate when current frozen authority is revoked", async () => {
    const f = fixture();
    jest.mocked(assertVantageV2Authority).mockRejectedValueOnce(Error("revoked"));
    await expect(
        f.repo.patch(actor, "task", { expectedVersion: 1, title: "Changed" })
    ).rejects.toThrow("revoked");
    expect(f.queries.some(q => q.startsWith("INSERT") || q.startsWith("UPDATE"))).toBe(false);
});
it("hash binds exact task content and recipient while ignoring progress", () => {
    expect(planHash([task])).toBe(planHash([{ ...task, status: "running", version: 4 }]));
    expect(planHash([task])).not.toBe(planHash([{ ...task, assigneeId: "other" }]));
    expect(planHash([task])).not.toBe(planHash([{ ...task, title: "Changed" }]));
    expect(planHash([task])).not.toBe(planHash([{ ...task, workType: "comparison" }]));
});

it("retains human work on readback until the owner explicitly changes it to persona work", async () => {
    const f = fixture({
        ...task,
        workType: "human_action",
        assigneeType: "owner",
        assigneeId: actor.userId,
    });
    await f.repo.approve(actor, "review", 1, f.plan.hash);
    const reassign = { expectedVersion: 1, assigneeType: "persona", assigneeId: "agent" };
    for (const patch of [reassign, { ...reassign, workType: "human_action" }]) {
        await expect(f.repo.patch(actor, "task", patch)).rejects.toMatchObject({
            code: "task_read_only_work_required",
        });
    }
    const before = (await f.repo.get(actor, "review")).plan;
    expect(before?.approvedHash).toBe(f.plan.hash);
    expect(before?.tasks[0]).toMatchObject({ assigneeType: "owner", workType: "human_action" });
    await f.repo.patch(actor, "task", {
        ...reassign,
        workType: "analysis",
        acceptanceCriterion: "Summarize the available evidence for the owner.",
    });
    const edited = (await f.repo.get(actor, "review")).plan!;
    expect(edited.tasks[0]).toMatchObject({ assigneeId: "agent", workType: "analysis" });
    expect(edited.approvedHash).toBeNull();
    expect(
        (await f.repo.approve(actor, "review", edited.version, edited.hash)).plan.tasks[0]?.status
    ).toBe("queued");
});

it("requires the owner to confirm the work type of a changed persona acceptance criterion", async () => {
    const f = fixture();
    const edit = { expectedVersion: 1, acceptanceCriterion: "Compare the documented risks." };
    await expect(f.repo.patch(actor, "task", edit)).rejects.toMatchObject({
        code: "task_read_only_work_required",
    });
    await expect(
        f.repo.patch(actor, "task", { ...edit, workType: "human_action" })
    ).rejects.toMatchObject({
        code: "task_read_only_work_required",
    });
    const changed = await f.repo.patch(actor, "task", { ...edit, workType: "comparison" });
    expect(changed.plan.tasks[0]?.workType).toBe("comparison");
});

it("reads a legacy persona spec without inventing its type and requires classification for a new approval", async () => {
    const f = fixture({ ...task, workType: undefined });
    const prior = (await f.repo.get(actor, "review")).plan!;
    expect(prior.tasks[0]).not.toHaveProperty("workType");
    await expect(f.repo.approve(actor, "review", prior.version, prior.hash)).rejects.toMatchObject({
        code: "task_read_only_work_required",
    });
    const edited = await f.repo.patch(actor, "task", { expectedVersion: 1, workType: "draft" });
    expect(edited.plan.hash).not.toBe(prior.hash);
    expect(
        (await f.repo.approve(actor, "review", edited.plan.version, edited.plan.hash)).plan.tasks[0]
            ?.status
    ).toBe("queued");
});

it("shows typed current result and attempt, then clears both after an approved edit", async () => {
    const f = fixture();
    await f.repo.approve(actor, "review", 1, f.plan.hash);
    const result = {
        summary: "Findings",
        claims: [{ text: "A fact", refs: ["exact"] }],
        unknowns: ["Open question"],
        disposition: "ready_for_review",
    };
    f.setTask({
        status: "submitted",
        version: 3,
        attempt_id: "attempt",
        attempt: 1,
        result_ciphertext: encryptSecret(JSON.stringify(result), taskAAD(actor, "task") + ":result")
            .ciphertext,
    });
    const read = await f.repo.get(actor, "review");
    expect(read.plan?.tasks[0]?.structuredResult).toEqual(result);
    expect(read.plan?.tasks[0]?.latestAttempt?.number).toBe(1);
    await f.repo.patch(actor, "task", { expectedVersion: 3, title: "New task" });
    const edited = await f.repo.get(actor, "review");
    expect(edited.plan?.tasks[0]?.structuredResult).toBeUndefined();
    expect(edited.plan?.tasks[0]?.latestAttempt).toBeUndefined();
});
it("requeues expired running work but rejects a live claim", async () => {
    const f = fixture();
    await f.repo.approve(actor, "review", 1, f.plan.hash);
    f.setTask({
        status: "running",
        version: 3,
        lease_until: new Date(Date.now() + 60_000).toISOString(),
        attempt_id: "live",
        attempt: 1,
    });
    await expect(
        f.repo.action(actor, "task", { action: "run", expectedVersion: 3 })
    ).rejects.toMatchObject({ code: "task_in_progress" });
    f.setTask({ lease_until: new Date(Date.now() - 1000).toISOString() });
    const retried = await f.repo.action(actor, "task", { action: "run", expectedVersion: 3 });
    expect(retried.plan.tasks[0]?.status).toBe("queued");
    expect(retried.plan.tasks[0]?.latestAttempt).toBeUndefined();
});
it("does not enqueue already completed unchanged work on approval", async () => {
    const f = fixture();
    f.setTask({ status: "completed" });
    const result = await f.repo.approve(actor, "review", 1, f.plan.hash);
    expect(result.plan.tasks[0]?.status).toBe("completed");
});
