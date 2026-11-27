/**
 * From per-seed outcomes to the numbers a reader needs: per pool and overall,
 * each way of checking beside today's, with intervals.
 *
 * Intervals are E4's: over seeds within a pool, and over pools and then seeds
 * for the overall figures (../e4-whom-to-check/stats.ts says why).
 */
import { clustered, difference, mean, round, type Spread } from "../e4-whom-to-check/stats";
import { ARMS, BUDGETS, type Arm, type SeedOutcome } from "./shortlist-replay";

export interface SegmentOutcomes {
    segment: string;
    pool: string;
    briefLanguage: string;
    /** Companies in a seed's draw. */
    candidates: number;
    /** Good companies in the whole pool. */
    good: number;
    /** [seed] per way of checking. */
    arms: Record<Arm, SeedOutcome[]>;
}

type Metric = "found25" | "found50" | "found100" | "found200" | "checksTo25" | "spent" | "rounds";
const METRICS: Metric[] = [
    "found25",
    "found50",
    "found100",
    "found200",
    "checksTo25",
    "spent",
    "rounds",
];

function valuesOf(outcomes: readonly SeedOutcome[], metric: Metric): number[] {
    if (metric === "checksTo25") return outcomes.map(o => o.checksTo25);
    if (metric === "spent") return outcomes.map(o => o.spent);
    if (metric === "rounds") return outcomes.map(o => o.rounds);
    const at = BUDGETS.indexOf(Number(metric.slice(5)) as (typeof BUDGETS)[number]);
    return outcomes.map(o => o.found[at]!);
}

export interface ShortlistSummary {
    seeds: number;
    perSegment: Array<{
        segment: string;
        pool: string;
        briefLanguage: string;
        candidates: number;
        good: number;
        /** Mean over seeds. */
        arms: Record<Arm, Record<Metric, number>>;
    }>;
    /** Mean of the segments' means, 95% interval over segments and seeds. */
    overall: Record<Arm, Record<Metric, Spread>>;
    /** Each way of checking minus today's, paired by seed. */
    vsToday: Record<Exclude<Arm, "today">, Record<Metric, Spread>>;
}

export function summarise(segments: readonly SegmentOutcomes[]): ShortlistSummary {
    const digits = (metric: Metric): number => (metric === "rounds" ? 1 : 2);
    const perSegment = segments.map(s => ({
        segment: s.segment,
        pool: s.pool,
        briefLanguage: s.briefLanguage,
        candidates: s.candidates,
        good: s.good,
        arms: Object.fromEntries(
            ARMS.map(arm => [
                arm,
                Object.fromEntries(
                    METRICS.map(metric => [metric, round(mean(valuesOf(s.arms[arm], metric)), 2)])
                ),
            ])
        ) as Record<Arm, Record<Metric, number>>,
    }));
    const overall = Object.fromEntries(
        ARMS.map(arm => [
            arm,
            Object.fromEntries(
                METRICS.map(metric => [
                    metric,
                    clustered(
                        segments.map(s => valuesOf(s.arms[arm], metric)),
                        digits(metric)
                    ),
                ])
            ),
        ])
    ) as ShortlistSummary["overall"];
    const vsToday = Object.fromEntries(
        ARMS.filter(arm => arm !== "today").map(arm => [
            arm,
            Object.fromEntries(
                METRICS.map(metric => [
                    metric,
                    clustered(
                        segments.map(s =>
                            difference(
                                valuesOf(s.arms[arm], metric),
                                valuesOf(s.arms.today, metric)
                            )
                        ),
                        digits(metric)
                    ),
                ])
            ),
        ])
    ) as ShortlistSummary["vsToday"];
    return { seeds: segments[0]?.arms.today.length ?? 0, perSegment, overall, vsToday };
}

const pad = (value: string | number, width: number): string => String(value).padStart(width);
const signed = (value: number): string => (value > 0 ? `+${value}` : String(value));

/** The table a run prints: today's ranking and the learner side by side. */
export function table(summary: ShortlistSummary): string {
    const lines: string[] = [];
    lines.push(
        `Good companies found in 100 checks, and checks a run spends to fill 25 places (${summary.seeds} seeds)`
    );
    lines.push(
        `${"segment".padEnd(22)}${pad("today", 8)}${pad("learner", 9)}${pad("gain", 8)}   | spent: ${pad("today", 6)}${pad("in rounds", 11)}${pad("learner", 9)}`
    );
    for (const s of summary.perSegment) {
        const gain = round(s.arms.learner.found100 - s.arms.today.found100, 2);
        lines.push(
            `${s.segment.padEnd(22)}${pad(s.arms.today.found100, 8)}${pad(s.arms.learner.found100, 9)}${pad(signed(gain), 8)}   |        ${pad(s.arms.today.spent, 6)}${pad(s.arms["today-in-rounds"].spent, 11)}${pad(s.arms.learner.spent, 9)}`
        );
    }
    const o = summary.overall;
    const d = summary.vsToday.learner;
    lines.push(
        `${"all segments".padEnd(22)}${pad(o.today.found100.mean, 8)}${pad(o.learner.found100.mean, 9)}${pad(signed(d.found100.mean), 8)}   |        ${pad(o.today.spent.mean, 6)}${pad(o["today-in-rounds"].spent.mean, 11)}${pad(o.learner.spent.mean, 9)}`
    );
    lines.push(
        `learner minus today, found in 100 checks: ${signed(d.found100.mean)} (95% interval ${signed(d.found100.lo)} to ${signed(d.found100.hi)})`
    );
    lines.push(
        `at 25 / 50 / 200 checks: ${signed(d.found25.mean)} (${signed(d.found25.lo)} to ${signed(d.found25.hi)}) / ${signed(d.found50.mean)} (${signed(d.found50.lo)} to ${signed(d.found50.hi)}) / ${signed(d.found200.mean)} (${signed(d.found200.lo)} to ${signed(d.found200.hi)})`
    );
    lines.push(
        `checks until the 25th good company: today ${o.today.checksTo25.mean}, learner ${o.learner.checksTo25.mean} (${signed(d.checksTo25.mean)}, ${signed(d.checksTo25.lo)} to ${signed(d.checksTo25.hi)})`
    );
    lines.push(
        `checks a run spends to fill 25 places: today ${o.today.spent.mean}, today in rounds ${o["today-in-rounds"].spent.mean}, learner ${o.learner.spent.mean}`
    );
    return lines.join("\n");
}
