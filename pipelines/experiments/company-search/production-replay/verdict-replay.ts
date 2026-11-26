/**
 * The learning shortlist on real fit-check verdicts.
 *
 * E4 and the shortlist replay answer a check from a register code. Here a
 * check answers what production's own fit check said about the company: every
 * company of one pool was judged once (record-verdicts.ts) and the verdicts
 * are replayed, so the learner meets the yes's and no's a run really gets,
 * the model's mistakes included.
 *
 * Counted two ways:
 *   judged    a company is good when the fit check said yes. What a run is
 *             after: places on the shortlist it will keep.
 *   register  a company is good by its register code, as in E4, while the
 *             loop still only sees the fit check's verdicts. Shows whether
 *             learning from the model's verdicts still finds the companies an
 *             outside label calls good.
 */
import { SIMULATION } from "../e4-whom-to-check/config";
import { createRecorder, loadPool } from "../e4-whom-to-check/data";
import { segmentById } from "../e4-whom-to-check/segments";
import { round } from "../e4-whom-to-check/stats";
import { runLaterRunReplay, type LaterRunSummary } from "./later-run";
import { summarise, type ShortlistSummary } from "./shortlist-report";
import {
    ARMS,
    prepareSegment,
    replaySeed,
    type Arm,
    type PreparedSegment,
    type SeedOutcome,
} from "./shortlist-replay";
import type { ReplayEmbedder } from "./vectors";
import { readVerdicts } from "./verdicts";

export interface VerdictSummary {
    segment: string;
    briefLanguage: string;
    judge: string;
    companies: number;
    /** The fit check's verdicts beside the register's labels, whole pool. */
    agreement: {
        judgedYes: number;
        registerGood: number;
        /** Yes from the fit check and good by the register. */
        both: number;
        /** Yes from the fit check, not good by the register. */
        judgeOnly: number;
        /** Good by the register, no from the fit check. */
        registerOnly: number;
        /** Share of companies on which the two agree. */
        agree: number;
    };
    /** Companies asked about twice, in different batches, and how many verdicts changed. */
    stability: { asked: number; changed: number } | null;
    /** A company is good when the fit check said yes. */
    judged: ShortlistSummary;
    /** A company is good by its register code; the loop sees the fit check's verdicts. */
    register: ShortlistSummary;
    /** A second run on companies it has never seen, starting from the first run's kept verdicts (later-run.ts). */
    laterRun: LaterRunSummary;
}

export class VerdictsMissingError extends Error {
    constructor(segment: string) {
        super(
            `No recorded fit-check verdicts for ${segment} on this machine (record-verdicts.ts records them).`
        );
        this.name = "VerdictsMissingError";
    }
}

async function replay(
    prepared: PreparedSegment,
    seeds: readonly number[],
    good: number,
    zeroScoreRule?: boolean
): Promise<ShortlistSummary> {
    const arms = Object.fromEntries(ARMS.map(arm => [arm, [] as SeedOutcome[]])) as Record<
        Arm,
        SeedOutcome[]
    >;
    for (const seed of seeds) {
        const outcome = await replaySeed(prepared, seed, { zeroScoreRule });
        for (const arm of ARMS) arms[arm].push(outcome[arm]!);
    }
    return summarise([
        {
            segment: prepared.segment.id,
            pool: prepared.segment.pool,
            briefLanguage: prepared.language,
            candidates: Math.round(prepared.pool.size * SIMULATION.subsample),
            good,
            arms,
        },
    ]);
}

export async function runVerdictReplay(options: {
    embedder: ReplayEmbedder;
    segment?: string;
    seeds?: readonly number[];
    /**
     * Apply a run's relevance-above-zero rule before ranking (shortlist-replay.ts).
     * The later-run part always ranks the whole half.
     */
    zeroScoreRule?: boolean;
}): Promise<VerdictSummary> {
    const segmentId = options.segment ?? "brreg-breweries";
    const seeds = options.seeds ?? SIMULATION.seeds;
    const recorded = readVerdicts(segmentId, "en");
    if (!recorded) throw new VerdictsMissingError(segmentId);
    const segment = segmentById(segmentId);
    const pool = await loadPool(createRecorder("replay"), segment.pool);
    if (recorded.poolFingerprint !== pool.fingerprint)
        throw new Error("The pool changed since its verdicts were recorded");
    const prepared = await prepareSegment(options.embedder, pool, segment, recorded.briefLanguage);

    const judged = new Uint8Array(pool.size);
    for (let i = 0; i < pool.size; i++) {
        const verdict = recorded.verdicts[String(i)];
        if (!verdict) throw new Error(`Company ${i} of ${segmentId} has no recorded verdict`);
        judged[i] = verdict.fit ? 1 : 0;
    }
    const register = prepared.labels;
    let both = 0;
    let judgeOnly = 0;
    let registerOnly = 0;
    for (let i = 0; i < pool.size; i++) {
        if (judged[i] === 1 && register[i] === 1) both += 1;
        else if (judged[i] === 1) judgeOnly += 1;
        else if (register[i] === 1) registerOnly += 1;
    }
    const again = Object.entries(recorded.again ?? {});
    const changed = again.filter(
        ([i, verdict]) => verdict.fit !== (judged[Number(i)] === 1)
    ).length;

    return {
        segment: segmentId,
        briefLanguage: recorded.briefLanguage,
        judge: recorded.judge,
        companies: pool.size,
        agreement: {
            judgedYes: both + judgeOnly,
            registerGood: both + registerOnly,
            both,
            judgeOnly,
            registerOnly,
            agree: round((pool.size - judgeOnly - registerOnly) / pool.size, 3),
        },
        stability: again.length > 0 ? { asked: again.length, changed } : null,
        judged: await replay(
            { ...prepared, labels: judged, reveals: judged },
            seeds,
            both + judgeOnly,
            options.zeroScoreRule
        ),
        register: await replay(
            { ...prepared, reveals: judged },
            seeds,
            both + registerOnly,
            options.zeroScoreRule
        ),
        laterRun: await runLaterRunReplay({ ...prepared, labels: judged, reveals: judged }, seeds),
    };
}

const signed = (value: number): string => (value > 0 ? `+${value}` : String(value));

/** The table a run prints. */
export function verdictTable(model: string, summary: VerdictSummary): string {
    const a = summary.agreement;
    const lines = [
        `${model}, ${summary.segment}: every check answered by the recorded fit check (${summary.judged.seeds} seeds)`,
        `fit check said yes to ${a.judgedYes} of ${summary.companies}; the register calls ${a.registerGood} good; both ${a.both}, fit check only ${a.judgeOnly}, register only ${a.registerOnly}; they agree on ${Math.round(a.agree * 1000) / 10}%`,
    ];
    if (summary.stability)
        lines.push(
            `asked twice about ${summary.stability.asked} companies: ${summary.stability.changed} verdicts changed`
        );
    for (const [name, s] of [
        ["good = the fit check said yes", summary.judged],
        ["good = the register's code", summary.register],
    ] as const) {
        const o = s.overall;
        const d = s.vsToday.learner;
        lines.push(
            `${name}: found in 25 / 50 / 100 checks: today ${o.today.found25.mean} / ${o.today.found50.mean} / ${o.today.found100.mean}, learner ${o.learner.found25.mean} / ${o.learner.found50.mean} / ${o.learner.found100.mean} (at 100: ${signed(d.found100.mean)}, ${signed(d.found100.lo)} to ${signed(d.found100.hi)} over seeds)`
        );
        lines.push(
            `    checks a run spends to fill 25 places: today ${o.today.spent.mean}, today in rounds ${o["today-in-rounds"].spent.mean}, learner ${o.learner.spent.mean}`
        );
    }
    const later = summary.laterRun;
    const gap = later.seededMinusFresh;
    lines.push(
        `a second run on the other half of the pool (${later.half} companies it has never seen), after a first run kept ${later.kept} verdicts:`
    );
    for (const arm of ["today", "fresh", "seeded"] as const) {
        const a = later.arms[arm];
        lines.push(
            `    ${arm.padEnd(7)} yes in its first 10 / 25 / 50 checks: ${a.found10} / ${a.found25} / ${a.found50}; checks to fill 25 places: ${a.spent}`
        );
    }
    lines.push(
        `    seeded minus fresh: first 10 checks ${signed(gap.found10.mean)} (${signed(gap.found10.lo)} to ${signed(gap.found10.hi)}), first 25 ${signed(gap.found25.mean)} (${signed(gap.found25.lo)} to ${signed(gap.found25.hi)}), checks to fill 25 ${signed(gap.spent.mean)} (${signed(gap.spent.lo)} to ${signed(gap.spent.hi)})`
    );
    return lines.join("\n");
}
