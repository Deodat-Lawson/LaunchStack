import { createWeeklyReviewRepository } from "~/server/vantage/weekly-review-repository";
import {
    topicManifestHash,
    topicInputHash,
    type TopicManifest,
} from "~/server/vantage/weekly-review-topic-types";
import type { WeeklyReviewQuery } from "~/server/vantage/weekly-review-types";
jest.mock("@launchstack/store/crypto", () => ({
    encryptSecret: jest.fn(),
    decryptSecret: jest.fn(),
}));
function fixture() {
    const actor = { companyId: "1", userId: "owner" };
    const manifest: TopicManifest = {
        week: "2026-11-09",
        cutoff: "2026-11-15T00:00:00.000Z",
        asOf: "2026-11-15T00:00:00.000Z",
        epoch: "7",
        expectedActiveId: "previous",
        configuration: { provider: "seeds", scoped: false },
        revisions: { policy: 1, preference: 1, role: null },
        topics: [],
        fixed: [],
        fixedDependencies: [],
        offered: [],
        lane: [],
        carryover: "unavailable",
    };
    const row = {
        id: "run",
        status: "reserved",
        retrieval_mode: "topic-first",
        input_hash: topicInputHash(manifest),
        authority_epoch: "7",
        dependencies: [],
        exploration_dispatched: false,
        generation_dispatched: false,
        judge_dispatched: false,
        snapshot_hash: null as string | null,
        exploration_deadline_at: new Date(Date.now() + 10000).toISOString(),
        week_start: manifest.week,
    };
    const state = { active: "previous", inserted: true };
    const query: WeeklyReviewQuery = jest.fn(async (sql, args = []) => {
        if (sql.startsWith("SET ")) return [];
        if (sql.startsWith("SELECT * FROM pdr_ai_v2_vantage_weekly_review_runs")) return [row];
        if (sql.startsWith("SELECT * FROM pdr_ai_v2_vantage_weekly_review_run_manifests"))
            return [{ manifest, manifest_hash: topicManifestHash(manifest) }];
        if (sql.startsWith("SELECT run_id")) return [{ run_id: state.active }];
        if (sql.includes("SET exploration_dispatched=true")) {
            row.exploration_dispatched = true;
            return [{ exploration_deadline_at: row.exploration_deadline_at }];
        }
        if (sql.includes("SET generation_dispatched=true")) {
            row.generation_dispatched = true;
            return [];
        }
        if (sql.includes("SET judge_dispatched=true")) {
            row.judge_dispatched = true;
            return [];
        }
        if (sql.includes("last_dispatch_at=")) return [];
        if (sql.includes("INSERT INTO pdr_ai_v2_vantage_weekly_review_runs"))
            return state.inserted ? [{ id: args[0], status: "reserved" }] : [];
        if (sql.includes("INSERT INTO pdr_ai_v2_vantage_weekly_review_run_manifests")) return [];
        if (sql.startsWith("SELECT id,week_start,status"))
            return [{ id: "original", week_start: manifest.week, status: "reserved" }];
        throw Error(sql);
    });
    const authority = jest.fn(async () => {});
    const repository = createWeeklyReviewRepository(
        { transaction: work => work(query) },
        authority
    );
    return { actor, manifest, row, state, query, authority, repository };
}
it("claims once under pinned E0 before provider dispatch", async () => {
    const f = fixture();
    await f.repository.claimExploration(f.actor, "run");
    expect(f.authority).toHaveBeenCalledWith(
        f.query,
        { ...f.actor, authorityEpoch: "7" },
        [],
        "exploration"
    );
    await expect(f.repository.claimExploration(f.actor, "run")).rejects.toThrow(
        "dispatch_already_reserved_or_invalid_order"
    );
});
it("rejects stale active pointer before exploration", async () => {
    const f = fixture();
    f.state.active = "other";
    await expect(f.repository.claimExploration(f.actor, "run")).rejects.toThrow(
        "active_review_changed"
    );
    expect(f.row.exploration_dispatched).toBe(false);
});
it("honors fresh mutation authority at claim", async () => {
    const f = fixture();
    f.authority.mockRejectedValueOnce(new Error("edit_denied"));
    await expect(f.repository.claimExploration(f.actor, "run")).rejects.toThrow("edit_denied");
    expect(f.row.exploration_dispatched).toBe(false);
});
it("rejects generation before freeze", async () => {
    const f = fixture();
    await expect(
        f.repository.authorizeDispatch(f.actor, "run", "generation", "previous")
    ).rejects.toThrow("candidate_admission_invalid");
    expect(f.row.generation_dispatched).toBe(false);
});
it("rejects Judge against a changed snapshot commitment", async () => {
    const f = fixture();
    f.row.snapshot_hash = "frozen";
    f.row.generation_dispatched = true;
    await expect(
        f.repository.authorizeDispatch(f.actor, "run", "judge", "previous", "changed")
    ).rejects.toThrow("candidate_admission_invalid");
    expect(f.row.judge_dispatched).toBe(false);
});
it("same-key loser keeps the originally pinned run", async () => {
    const f = fixture();
    f.state.inserted = false;
    const changed = { ...f.manifest, cutoff: "2026-11-16T00:00:00.000Z" };
    await expect(f.repository.reserveTopic(f.actor, "key", "new", changed)).resolves.toEqual({
        id: "original",
        status: "reserved",
        created: false,
    });
    expect(f.query).not.toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO pdr_ai_v2_vantage_weekly_review_run_manifests"),
        expect.anything()
    );
});
it("manifest identity binds pinned cutoff and authority", () => {
    const f = fixture();
    expect(topicInputHash({ ...f.manifest, epoch: "8" })).not.toBe(topicInputHash(f.manifest));
    expect(topicInputHash({ ...f.manifest, cutoff: "2026-11-16T00:00:00.000Z" })).not.toBe(
        topicInputHash(f.manifest)
    );
});
