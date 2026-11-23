import { createWeeklyReviewRepository } from "~/server/vantage/weekly-review-repository";
import { fitTopicEvidence } from "~/server/vantage/weekly-review-topic-freeze";
import {
    topicManifestHash,
    topicInputHash,
    type TopicManifest,
} from "~/server/vantage/weekly-review-topic-types";
import type { FrozenDependency, WeeklyReviewQuery } from "~/server/vantage/weekly-review-types";
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
        retrieval_mode: "topic_first",
        input_hash: topicInputHash(manifest),
        authority_epoch: "7",
        dependencies: [] as FrozenDependency[],
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
        if (sql.includes("snapshot_hash=$3")) {
            row.dependencies = JSON.parse(String(args[1]));
            row.snapshot_hash = String(args[2]);
            return [{ id: row.id }];
        }
        if (sql.includes("SET snapshot_commitment=")) return [];
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
it("fences late exploration even when provider ignores abort", async () => {
    const f = fixture();
    f.row.exploration_dispatched = true;
    f.row.exploration_deadline_at = new Date(Date.now() - 1).toISOString();
    const build = jest.fn();
    await expect(f.repository.freezeTopic(f.actor, "run", build)).rejects.toThrow(
        "topic_exploration_failed:timeout"
    );
    expect(build).not.toHaveBeenCalled();
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
it("commits the degraded marker before using the same generation admission", async () => {
    const f = fixture();
    const fixed = {
        kind: "document",
        id: "1",
        ref: "doc:1@1",
        version: "1",
        hash: "a".repeat(64),
        purpose: "company-architecture",
        audience: "company",
        text: "Pinned architecture evidence",
        title: "Architecture",
    } as const;
    f.manifest.fixed.push(fixed);
    f.manifest.fixedDependencies.push(fixed);
    f.row.input_hash = topicInputHash(f.manifest);
    await f.repository.claimExploration(f.actor, "run");
    const degradation = {
        code: "topic_exploration_degraded:non_submission",
        reason: "submission_missing",
        provenance: "successful_canonical_excerpt_reads",
    } as const;
    await f.repository.freezeTopic(f.actor, "run", () =>
        fitTopicEvidence(
            "run",
            {
                manifest: f.manifest,
                context: {
                    actor: f.actor,
                    week: f.manifest.week,
                    role: "owner",
                    preferenceVersion: 1,
                    authorityEpoch: "7",
                    sources: [fixed],
                    mandatoryCoverage: { required: 1, included: 1 },
                },
                documents: [],
            },
            { selected: [], degradation },
            jest.fn()
        )
    );
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining("SET snapshot_commitment="), [
        "run",
        expect.stringContaining(degradation.code),
    ]);
    expect(f.authority).toHaveBeenCalledWith(f.query, f.actor, [fixed], "dispatch");
    await f.repository.authorizeDispatch(
        f.actor,
        "run",
        "generation",
        "previous",
        f.row.snapshot_hash!
    );
    expect(f.row.generation_dispatched).toBe(true);
    expect(f.authority).toHaveBeenLastCalledWith(f.query, f.actor, [fixed], "dispatch");
});

it("rechecks fresh mutation authority at freeze", async () => {
    const f = fixture();
    f.row.exploration_dispatched = true;
    f.authority.mockRejectedValueOnce(new Error("mutation_revoked"));
    const build = jest.fn();
    await expect(f.repository.freezeTopic(f.actor, "run", build)).rejects.toThrow(
        "mutation_revoked"
    );
    expect(build).not.toHaveBeenCalled();
});
