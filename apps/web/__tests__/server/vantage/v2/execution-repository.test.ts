jest.mock("~/server/vantage/weekly-review-service", () => ({ weeklyReviewDatabase: {} }));
jest.mock("~/server/vantage/v2/authority", () => ({
    assertVantageV2Authority: jest.fn(async () => ({
        report: {},
        evidence: { inputSnapshot: { sources: [{ ref: "frozen:1", text: "source" }] } },
    })),
}));
jest.mock("~/server/vantage/v2/enabled", () => ({ vantageV2Enabled: () => true }));
jest.mock("~/server/vantage/v2/settings", () => ({
    loadSettings: async () => ({ personaIds: ["persona"] }),
}));
jest.mock("@launchstack/store/crypto", () => ({
    encryptSecret: (text: string) => ({ ciphertext: text }),
    decryptSecret: (text: string) => text,
}));

import { createTaskExecutionRepository } from "~/server/vantage/v2/execution-repository";
import type { TaskExecutionClaim } from "~/server/vantage/v2/execute";
import type { WeeklyReviewQuery } from "~/server/vantage/weekly-review-types";
import { WeeklyReviewConflict } from "~/server/vantage/weekly-review-types";
import { assertVantageV2Authority } from "~/server/vantage/v2/authority";

const claim: TaskExecutionClaim = {
    taskId: "task",
    planId: "plan",
    reviewId: "review",
    companyId: "1",
    ownerId: "owner",
    claimToken: "token",
    attemptId: "attempt",
    planVersion: 1,
    planHash: "hash",
    deadlineAt: Date.now() + 180_000,
    instructions: "work",
    personaRole: "analyst",
};
function fixture(patch: Record<string, unknown> = {}) {
    const row = {
        id: "task",
        plan_id: "plan",
        review_id: "review",
        company_id: "1",
        owner_id: "owner",
        plan_version: 1,
        plan_hash: "hash",
        approved_version: 1,
        approved_hash: "hash",
        expires_at: "future",
        status: "running",
        assignee_type: "persona",
        assignee_id: "persona",
        claim_token: "token",
        attempt_id: "attempt",
        lease_until: "future",
        ciphertext: JSON.stringify({ title: "task", description: "work" }),
        ...patch,
    };
    const query = jest.fn(
        async (sql: string, parameters: unknown[] = []): Promise<Record<string, unknown>[]> => {
            if (sql.startsWith("SELECT t.*")) return [row];
            if (sql.includes("collab_agent_persona")) return [{ role: "analyst" }];
            if (sql.startsWith("SELECT 1"))
                return parameters[0] === "expired" ? [] : [{ "?column?": 1 }];
            if (sql.startsWith("UPDATE") && sql.includes("RETURNING lease_until")) {
                row.status = "running";
                return [{ lease_until: new Date(Date.now() + 180_000).toISOString() }];
            }
            return [];
        }
    );
    const repository = createTaskExecutionRepository({
        transaction: work => work(query as WeeklyReviewQuery),
    });
    return { repository, query, row };
}

test("an existing live attempt cannot be claimed by a duplicate delivery", async () => {
    const { repository, query } = fixture();
    expect(await repository.claim("task")).toBeNull();
    expect(query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
});
test("a claim is locked and receives an expiring distinct attempt and fence", async () => {
    const { repository, query } = fixture({ status: "queued" });
    const first = await repository.claim("task");
    expect(first?.claimToken).toBeTruthy();
    expect(first?.attemptId).not.toBe(first?.claimToken);
    expect(query.mock.calls.some(([sql]) => sql.includes("FOR UPDATE OF p,t"))).toBe(true);
    expect(await repository.claim("task")).toBeNull();
});
test.each([
    { claim_token: "newer" },
    { attempt_id: "newer" },
    { lease_until: "expired" },
    { approved_hash: "changed" },
])("stale or revoked completion is fenced %j", async patch => {
    const { repository, query } = fixture(patch);
    await expect(
        repository.commit(claim, {
            summary: "draft",
            claims: [],
            unknowns: [],
            disposition: "ready_for_review",
        })
    ).rejects.toThrow("task_unavailable");
    expect(query.mock.calls.some(([sql]) => sql.includes("result_ciphertext="))).toBe(false);
});
test("blocked terminal update is conditional on both current attempt and token", async () => {
    const { repository, query } = fixture();
    await repository.fail(claim, "task_authority_revoked");
    expect(query).toHaveBeenCalledWith(
        expect.stringContaining("claim_token=$2::uuid AND attempt_id=$4::uuid"),
        ["task", "token", "task_authority_revoked", "attempt", "blocked"]
    );
});

test("revoked authority before claim records a blocked attempt without model dispatch", async () => {
    const { repository, query } = fixture({ status: "queued" });
    jest.mocked(assertVantageV2Authority).mockRejectedValueOnce(
        new WeeklyReviewConflict("review_access_denied", 403)
    );
    expect(await repository.claim("task")).toBeNull();
    expect(query).toHaveBeenCalledWith(
        expect.stringContaining("status='blocked',reason='task_authority_revoked'"),
        ["task", expect.any(String)]
    );
    expect(query.mock.calls.some(([sql]) => sql.includes("status='running'"))).toBe(false);
});
