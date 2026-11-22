import type { BenchmarkMeterSnapshot } from "./vantage-benchmark-meter";
import {
    SWEEP_CAPS,
    type BenchmarkGroup,
    type SweepCap,
    type SweepCohort,
} from "./vantage-benchmark-retrieval";

export type SweepStep = {
    workId: string;
    request: BenchmarkGroup;
    cohort: SweepCohort;
    evidenceCapBytes: SweepCap;
};

export function sweepSchedule(
    exploratory: readonly BenchmarkGroup[],
    heldout: readonly BenchmarkGroup[]
) {
    const cohorts = [
        { cohort: "exploratory", groups: exploratory, caps: SWEEP_CAPS },
        { cohort: "heldout", groups: heldout, caps: [16_000, 80_000] },
    ] as const;
    const schedule: SweepStep[] = [];
    for (const { cohort, groups, caps } of cohorts) {
        for (const request of groups) {
            for (const evidenceCapBytes of caps) {
                schedule.push({
                    workId: "sweep-" + String(schedule.length + 1).padStart(3, "0"),
                    request,
                    cohort,
                    evidenceCapBytes,
                });
            }
        }
    }
    return schedule;
}

// Means from the 4121a113 live grouped ledger, with 50% padding applied to future work.
const priorMean = { 3: 0.475494312 / 30, 5: 0.518785514 / 20 } as const;
export const SWEEP_WAVE_SIZE = 4;

export function sweepForecast(
    schedule: readonly SweepStep[],
    completed: readonly SweepStep[],
    meter?: Pick<BenchmarkMeterSnapshot, "records" | "projectedTotalUsd">
) {
    const exposure = new Map<string, number>();
    for (const row of meter?.records ?? []) {
        if (row.workId && row.status !== "released") {
            const amount = row.settledListRateUsd ?? row.projectedUsd;
            exposure.set(row.workId, (exposure.get(row.workId) ?? 0) + amount);
        }
    }
    const sizes = ([3, 5] as const).map(size => {
        const sameSize = completed.filter(step => step.request.topics.length === size);
        const observedMean =
            sameSize.length >= 10
                ? sameSize.reduce((sum, step) => sum + (exposure.get(step.workId) ?? 0), 0) /
                  sameSize.length
                : null;
        const projectedUsdPerGroup = Math.max(priorMean[size], observedMean ?? 0) * 1.5;
        const remaining = schedule.filter(step => step.request.topics.length === size).length;
        return {
            size,
            priorMeanUsd: priorMean[size],
            observedMeanUsd: observedMean,
            completed: sameSize.length,
            remaining,
            projectedUsdPerGroup,
        };
    });
    const currentExposureUsd = meter?.projectedTotalUsd ?? 0;
    const projectedUsd =
        currentExposureUsd +
        sizes.reduce((sum, size) => sum + size.remaining * size.projectedUsdPerGroup, 0);
    return { currentExposureUsd, projectedUsd, sizes };
}
