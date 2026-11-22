import { z } from "zod";
import type { BenchmarkGroup } from "./vantage-benchmark-retrieval";
import type { SweepStep } from "./vantage-benchmark-sweep";

export const RELIABILITY_SWEEP_LIMIT_USD = 5;
export const RELIABILITY_FREE_ARMS = ["seeds", "seeds-windows"] as const;
export const HELDOUT_GROUPS_SHA256 =
    "e2c280a36d51cff52c6abdeac6e085390682cf59089f08155c8b7ccfb185d43a";
export const PRIOR_SWEEP_CAPTURE_SHA256 =
    "568b40ef03510245fdec99493675f0b56e498622415d2a6d0275dd796d196f5d";
export const PRIOR_SWEEP_LEDGER_SHA256 =
    "298dc36e9c3b048a33fd9b93af641deb1a4b13b96995111899a8002e86b87c7c";

const workId = z.string().regex(/^sweep-[0-9]{3}$/);
const eligibilitySchema = z.object({
    schemaVersion: z.literal("vantage-budget-sweep-failure-audit/1"),
    ledgerSha256: z.literal(PRIOR_SWEEP_LEDGER_SHA256),
    captureSha256: z.literal(PRIOR_SWEEP_CAPTURE_SHA256),
    eligibleWorkIds: z.array(workId),
    failures: z.array(
        z.object({ workId, wave: z.number().int().positive(), classification: z.string() })
    ),
    eligibleJobs: z.array(
        z.object({
            workId,
            groupId: z.string(),
            evidenceCapBytes: z.literal(16000),
            classification: z.enum(["transport", "shared_hold_transport"]),
            causeWorkIds: z.array(workId),
        })
    ),
});
const priorRowSchema = z.object({
    arm: z.string(),
    cohort: z.string(),
    status: z.string(),
    runId: z.string().uuid().optional(),
    workId,
    caseId: z.string(),
    failure: z.string().optional(),
    retrievalLimits: z.object({ sharedEvidenceBytes: z.number() }),
});

export function reliabilitySweepSchedule(
    requests: readonly BenchmarkGroup[],
    previous?: { audit: unknown; results: unknown }
): SweepStep[] {
    const replacements = new Map<string, string>();
    if (previous) {
        const audit = eligibilitySchema.parse(previous.audit);
        const rows = z.array(priorRowSchema).length(600).parse(previous.results);
        const previousByWork = new Map(
            rows.filter(row => row.arm === "configured-live").map(row => [row.workId, row])
        );
        const uniqueIds = new Set(audit.eligibleWorkIds);
        const diagnoses = new Map(audit.failures.map(row => [row.workId, row]));
        const validGroups = new Set(requests.map(group => group.groupId));
        if (
            previousByWork.size !== 300 ||
            diagnoses.size !== audit.failures.length ||
            uniqueIds.size !== audit.eligibleJobs.length ||
            uniqueIds.size !== audit.eligibleWorkIds.length
        )
            throw new Error("benchmark_reliability_eligibility_invalid");
        for (const job of audit.eligibleJobs) {
            const old = previousByWork.get(job.workId);
            const diagnosis = diagnoses.get(job.workId);
            const transportEvidence =
                job.classification === "transport"
                    ? job.causeWorkIds.length === 0
                    : job.causeWorkIds.length > 0 &&
                      job.causeWorkIds.every(id => {
                          const cause = diagnoses.get(id);
                          return (
                              cause?.classification === "transport" &&
                              cause.wave === diagnosis?.wave
                          );
                      });
            if (
                !uniqueIds.delete(job.workId) ||
                diagnosis?.classification !== job.classification ||
                !transportEvidence ||
                !validGroups.has(job.groupId) ||
                replacements.has(job.groupId) ||
                old?.cohort !== "heldout" ||
                old.caseId !== job.groupId ||
                old.retrievalLimits.sharedEvidenceBytes !== job.evidenceCapBytes ||
                old.status !== "failed" ||
                old.failure !== "topic_exploration_failed:provider_or_submission"
            )
                throw new Error("benchmark_reliability_eligibility_invalid");
            replacements.set(job.groupId, job.workId);
        }
    }
    return requests
        .flatMap(request => {
            const replaced = replacements.get(request.groupId);
            return [
                { request, evidenceCapBytes: 8000 as const },
                ...(!previous || replaced
                    ? [{ request, evidenceCapBytes: 16000 as const, replacesWorkId: replaced }]
                    : []),
            ];
        })
        .map((step, index) => ({
            ...step,
            workId: "sweep-" + String(index + 1).padStart(3, "0"),
            cohort: "heldout",
        }));
}
