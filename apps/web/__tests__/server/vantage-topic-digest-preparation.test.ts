import { getDigestsForVersions } from "@launchstack/store/document-digests";
import { prewarmTopicDigests } from "~/server/vantage/weekly-review-topic-run";
import { WeeklyReviewConflict } from "~/server/vantage/weekly-review-types";

import { createWeeklyReviewRepository } from "~/server/vantage/weekly-review-repository";
import {
    topicInputHash,
    topicManifestHash,
    type TopicManifest,
} from "~/server/vantage/weekly-review-topic-types";
import type { WeeklyReviewQuery } from "~/server/vantage/weekly-review-types";

jest.mock("@launchstack/store/document-digests", () => ({
    ...jest.requireActual("@launchstack/store/document-digests"),
    getDigestsForVersions: jest.fn(),
}));
const actor = {
    companyId: "1",
    userId: "owner",
    role: "admin",
    canRead: true,
    canMutate: true,
    documentScope: { kind: "everything" as const },
};
const options = () => ({
    actor,
    versionIds: ["1"],
    query: jest.fn(async () => []),
    provider: jest.fn(async () => ({ headline: "", items: [] })),
    authorizeDocument: jest.fn(async () => true),
});
beforeEach(() => jest.clearAllMocks());

it("bounds prewarm concurrency and returns independent digest timestamps", async () => {
    let active = 0,
        peak = 0;
    jest.mocked(getDigestsForVersions).mockImplementation(async input => {
        active++;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active--;
        return new Map([
            [
                input.versionIds[0]!,
                {
                    id: input.versionIds[0]!,
                    versionId: input.versionIds[0]!,
                    contentHash: "hash",
                    formatVersion: "doc-digest/1",
                    headline: "",
                    items: [],
                },
            ],
        ]);
    });
    const result = await prewarmTopicDigests({
        ...options(),
        versionIds: Array.from({ length: 13 }, (_, i) => String(i + 1)),
    });
    expect(peak).toBe(6);
    expect(result.digests.size).toBe(13);
    expect(result.digestIds).toHaveLength(13);
    expect(Date.parse(result.timing.digestCompletedAt)).toBeGreaterThanOrEqual(
        Date.parse(result.timing.digestStartedAt)
    );
    expect(result.timing.digestDurationMs).toBeGreaterThanOrEqual(0);
});
it("times out a digest segment and aborts an ignoring provider without claiming exploration", async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    jest.mocked(getDigestsForVersions).mockImplementation(input => {
        signal = input.signal;
        return new Promise(() => {});
    });
    try {
        const work = prewarmTopicDigests({ ...options(), timeoutMs: 25 });
        const rejection = expect(work).rejects.toThrow("topic_digest_failed:timeout");
        await jest.advanceTimersByTimeAsync(25);
        await rejection;
        expect(signal?.aborted).toBe(true);
    } finally {
        jest.useRealTimers();
    }
});
it("preserves authority errors and passes the explicit ephemeral policy", async () => {
    jest.mocked(getDigestsForVersions).mockImplementation(async input => {
        expect(input.cachePolicy).toBe("ephemeral");
        await input.authorizeDocument?.({ id: 1, category: "Shared" });
        return new Map();
    });
    await expect(
        prewarmTopicDigests({
            ...options(),
            cachePolicy: "ephemeral",
            authorizeDocument: async () => {
                throw new WeeklyReviewConflict("source_authority_changed");
            },
        })
    ).rejects.toThrow("source_authority_changed");
});
it("refuses a prewarm without current mutation authority before any provider access", async () => {
    await expect(
        prewarmTopicDigests({ ...options(), actor: { ...actor, canMutate: false } })
    ).rejects.toThrow("review_mutation_denied");
    expect(getDigestsForVersions).not.toHaveBeenCalled();
});
it("records digest preparation before the exploration claim and preserves timing when recording trace", async () => {
    const manifest = {
        week: "2026-11-09",
        cutoff: "2026-11-16T00:00:00.000Z",
        asOf: "2026-11-16T00:00:00.000Z",
        epoch: "7",
        expectedActiveId: null,
        configuration: { provider: "scripted", scoped: false },
        revisions: { policy: 1, preference: 1, role: null },
        topics: [],
        fixed: [],
        fixedDependencies: [],
        offered: [],
        lane: [],
        carryover: "unavailable",
    } as TopicManifest;
    const row = {
        status: "reserved",
        retrieval_mode: "topic-first",
        exploration_dispatched: false,
        authority_epoch: "7",
        input_hash: topicInputHash(manifest),
    };
    const statements: string[] = [];
    const query: WeeklyReviewQuery = async text => {
        statements.push(text);
        if (text.startsWith("SELECT * FROM pdr_ai_v2_vantage_weekly_review_runs")) return [row];
        if (text.startsWith("SELECT * FROM pdr_ai_v2_vantage_weekly_review_run_manifests"))
            return [{ manifest, manifest_hash: topicManifestHash(manifest) }];
        if (text.includes("SET exploration_dispatched=true")) {
            row.exploration_dispatched = true;
            return [{ exploration_deadline_at: new Date(Date.now() + 150000).toISOString() }];
        }
        return [];
    };
    const authority = jest.fn(async () => {});
    const repository = createWeeklyReviewRepository(
        { transaction: work => work(query) },
        authority
    );
    await repository.beginDigestPreparation(actor, "candidate");
    expect(authority).toHaveBeenCalledTimes(1);
    expect(row.exploration_dispatched).toBe(false);
    expect(statements.some(text => text.includes("exploration_deadline_at"))).toBe(false);
    await repository.recordDigestPreparation(actor, "candidate", {
        digestIds: ["1"],
        timing: {
            digestCompletedAt: new Date().toISOString(),
            digestDurationMs: 40,
            digestOutcome: "ready",
        },
    });
    const deadline = await repository.claimExploration(actor, "candidate");
    expect(deadline).toBeGreaterThan(Date.now());
    expect(row.exploration_dispatched).toBe(true);
    await repository.recordExploration(actor, "candidate", { trace: { calls: [] } });
    expect(statements.at(-1)).toContain("COALESCE(trace->'stages'");
});
