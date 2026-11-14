import { createWeeklyReviewRepository } from "~/server/vantage/weekly-review-repository";
import type { FrozenDependency, WeeklyReviewQuery } from "~/server/vantage/weekly-review-types";

jest.mock("@launchstack/store/crypto", () => ({
    encryptSecret: jest.fn(),
    decryptSecret: jest.fn(),
}));

function setup() {
    const actor = { companyId: "1", userId: "owner" };
    const dependency: FrozenDependency = {
        kind: "document",
        id: "new-source",
        version: "2",
        hash: "new-hash",
        purpose: "retrieved",
    };
    const row = {
        id: "candidate",
        status: "reserved",
        company_id: "1",
        owner_id: "owner",
        week_start: "2026-11-09",
        dependencies: [dependency],
        generation_dispatched: false,
        judge_dispatched: false,
    };
    const state = { activeId: "previous-active" as string | null };
    const authority = jest.fn(async (_query, _actor, dependencies) => {
        if (dependencies.some((item: FrozenDependency) => item.id === "revoked-old-source")) {
            throw Error("source_access_denied");
        }
    });
    const query: WeeklyReviewQuery = jest.fn(async (text, parameters = []) => {
        if (text.startsWith("SET ") || text.startsWith("SELECT pg_advisory")) return [];
        if (text.startsWith("SELECT * FROM pdr_ai_v2_vantage_weekly_review_runs")) {
            expect(parameters.slice(1)).toEqual([actor.companyId, actor.userId]);
            return [row];
        }
        if (text.startsWith("SELECT run_id FROM pdr_ai_v2_vantage_weekly_review_active")) {
            expect(parameters).toEqual([actor.companyId, actor.userId, row.week_start]);
            return state.activeId ? [{ run_id: state.activeId }] : [];
        }
        if (text.includes("SET generation_dispatched=true")) {
            row.generation_dispatched = true;
            return [];
        }
        if (text.includes("SET judge_dispatched=true")) {
            row.judge_dispatched = true;
            return [];
        }
        throw Error("Unexpected query: " + text);
    });
    const repository = createWeeklyReviewRepository(
        { transaction: work => work(query) },
        authority
    );
    return { actor, row, state, authority, repository, query };
}

describe("Generation active identity preflight", () => {
    test.each([null, "historical-report"])(
        "rejects stale pointer %s before reserving dispatch",
        async expected => {
            const f = setup();
            await expect(
                f.repository.authorizeDispatch(f.actor, "candidate", "generation", expected)
            ).rejects.toMatchObject({ code: "active_review_changed" });
            expect(f.row.generation_dispatched).toBe(false);
            expect(f.row.judge_dispatched).toBe(false);
        }
    );

    test("replaces unreadable prior active using only the new authorized dependencies", async () => {
        const f = setup();
        await f.repository.authorizeDispatch(f.actor, "candidate", "generation", "previous-active");
        expect(f.row.generation_dispatched).toBe(true);
        expect(f.authority).toHaveBeenCalledWith(f.query, f.actor, f.row.dependencies, "dispatch");
        expect(f.query).not.toHaveBeenCalledWith(
            expect.stringContaining("ciphertext"),
            expect.anything()
        );
    });

    test("accepts a null expectation only for a week with no active report", async () => {
        const f = setup();
        f.state.activeId = null;
        await f.repository.authorizeDispatch(f.actor, "candidate", "generation", null);
        expect(f.row.generation_dispatched).toBe(true);
    });

    test("retains final CAS when another candidate wins after preflight", async () => {
        const f = setup();
        await f.repository.authorizeDispatch(f.actor, "candidate", "generation", "previous-active");
        await f.repository.authorizeDispatch(f.actor, "candidate", "judge", "previous-active");
        f.state.activeId = "concurrent-winner";
        await expect(
            f.repository.accept(f.actor, "candidate", {
                report: {},
                evidence: {},
                expectedActiveId: "previous-active",
            })
        ).rejects.toMatchObject({ code: "active_review_changed" });
        expect(f.state.activeId).toBe("concurrent-winner");
    });

    test("retains one-dispatch reservation semantics", async () => {
        const f = setup();
        await f.repository.authorizeDispatch(f.actor, "candidate", "generation", "previous-active");
        await expect(
            f.repository.authorizeDispatch(f.actor, "candidate", "generation", "previous-active")
        ).rejects.toMatchObject({ code: "dispatch_already_reserved_or_invalid_order" });
    });
});
