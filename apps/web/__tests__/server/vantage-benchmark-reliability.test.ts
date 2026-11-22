import {
    PRIOR_SWEEP_CAPTURE_SHA256,
    PRIOR_SWEEP_LEDGER_SHA256,
    reliabilitySweepSchedule,
} from "../../scripts/vantage-benchmark-reliability";
import type { BenchmarkGroup } from "../../scripts/vantage-benchmark-retrieval";

const groups: BenchmarkGroup[] = ["a", "b"].map(groupId => ({
    groupId,
    enterprise: "Fixture",
    workspaceId: "1",
    topics: [1, 2, 3].map(n => ({ caseId: String(n), question: "Example?" })),
}));
const results = Array.from({ length: 300 }, (_, index) => {
    const primary = {
        workId: "sweep-" + String(index + 1).padStart(3, "0"),
        caseId: index === 0 ? "a" : "b",
        cohort: "heldout",
        status: index === 0 ? "failed" : "ok",
        failure: index === 0 ? "topic_exploration_failed:provider_or_submission" : undefined,
        retrievalLimits: { sharedEvidenceBytes: 16000 },
    };
    return [
        { ...primary, arm: "configured-live" },
        { ...primary, arm: "configured-live+backfill" },
    ];
}).flat();
const audit = {
    schemaVersion: "vantage-budget-sweep-failure-audit/1",
    ledgerSha256: PRIOR_SWEEP_LEDGER_SHA256,
    captureSha256: PRIOR_SWEEP_CAPTURE_SHA256,
    eligibleWorkIds: ["sweep-001"],
    failures: [{ workId: "sweep-001", wave: 1, classification: "transport" }],
    eligibleJobs: [
        {
            workId: "sweep-001",
            groupId: "a",
            evidenceCapBytes: 16000,
            classification: "transport",
            causeWorkIds: [],
        },
    ],
};
it("runs both free caps and schedules only verified previous transport failures live", () => {
    expect(reliabilitySweepSchedule(groups).map(x => x.evidenceCapBytes)).toEqual([
        8000, 16000, 8000, 16000,
    ]);
    expect(
        reliabilitySweepSchedule(groups, { audit, results }).map(step => [
            step.request.groupId,
            step.evidenceCapBytes,
            step.replacesWorkId,
        ])
    ).toEqual([
        ["a", 8000, undefined],
        ["a", 16000, "sweep-001"],
        ["b", 8000, undefined],
    ]);
});
it("cannot mark a successful original as a replacement", () => {
    const altered = {
        ...audit,
        eligibleWorkIds: ["sweep-002"],
        failures: [{ workId: "sweep-002", wave: 1, classification: "transport" }],
        eligibleJobs: [{ ...audit.eligibleJobs[0], workId: "sweep-002", groupId: "b" }],
    };
    expect(() => reliabilitySweepSchedule(groups, { audit: altered, results })).toThrow(
        "benchmark_reliability_eligibility_invalid"
    );
});
it("rejects eligibility metadata from a different archive", () => {
    expect(() =>
        reliabilitySweepSchedule(groups, {
            audit: { ...audit, ledgerSha256: "0".repeat(64) },
            results,
        })
    ).toThrow();
});
