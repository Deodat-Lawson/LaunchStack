/**
 * One job: everything the experiment computes on one pool. The pool's
 * similarity matrix is built once and shared by its segments. Jobs are
 * independent, so run.ts may hand each to its own process; the numbers do not
 * depend on how many run at once.
 */
import { type BriefLanguage, segmentText } from "./briefs";
import { type Hyper, SIMULATION } from "./config";
import {
    createRecorder,
    createVectorSource,
    type LoadedPool,
    loadPool,
    type PrefixMode,
    type VectorSource,
} from "./data";
import {
    averagePrecision,
    buildPoolMath,
    buildSegmentMath,
    loadPoolVectors,
    scoreToday,
} from "./maths";
import { allPolicies, type Policy, type SegmentMath } from "./policies";
import { type PoolId, type Segment, segmentById } from "./segments";
import { contextFor, simulate, subsampleOf } from "./simulate";

export interface TaskSpec {
    language: BriefLanguage;
    batchSize: number;
    /** Policy names to run; all eleven when absent. */
    policies?: string[];
}

export interface JobSpec {
    poolId: PoolId;
    /** Which vectors every policy uses. */
    mode: PrefixMode;
    segments: Array<{ segmentId: string; tasks: TaskSpec[] }>;
    seeds: number[];
    hyper: Hyper;
}

export interface PolicyRuns {
    /** [seed][budget]: good companies among the first b checks. */
    found: number[][];
    /** [seed]: checks until the shortlist was full, capped (the cap when never full). */
    checksToShortlist: number[];
    /** [seed]: 1 when the shortlist filled before the cap. */
    reached: number[];
    /** Fixed rankings only, [seed]: the uncapped figure (-1 when the pool ran out first). */
    uncapped?: number[];
}

export interface TaskResult {
    language: BriefLanguage;
    batchSize: number;
    brief: string;
    /** Per policy name. */
    policies: Record<string, PolicyRuns>;
    /** [seed]: average precision of the two fixed rankings on the seed's subsample. */
    averagePrecision: { "today-semantic": number[]; "today-lexical": number[] };
    /** [seed]: good companies in the seed's subsample. */
    goodInSubsample: number[];
    /** Whole pool: share of companies, and of good companies, production's relevance > 0 gate keeps. */
    gate: { kept: number; goodKept: number };
}

export interface Quality {
    averagePrecision: number;
    precisionAt25: number;
}

export interface PrefixCheck {
    language: BriefLanguage;
    /** Whole pool, today's semantic ranking, with and without the model's task prefixes. */
    plain: Quality;
    prefixed: Quality;
}

export interface SegmentResult {
    segmentId: string;
    good: number;
    tasks: TaskResult[];
    prefixChecks: PrefixCheck[];
}

export interface JobResult {
    pool: {
        id: string;
        description: string;
        size: number;
        fingerprint: string;
        leftOut: Record<string, number>;
        subsample: number;
    };
    segments: SegmentResult[];
    /** Processor seconds by phase and by policy: printed by run.ts, never written to the results. */
    cpu: Record<string, number>;
}

const cpuSeconds = (): number => {
    const usage = process.cpuUsage();
    return (usage.user + usage.system) / 1e6;
};

function wholePoolQuality(today: Float64Array, labels: Uint8Array): Quality {
    const order = Array.from({ length: today.length }, (_, i) => i).sort(
        (a, b) => today[b]! - today[a]! || a - b
    );
    let top = 0;
    for (let i = 0; i < Math.min(25, order.length); i++) top += labels[order[i]!]!;
    return { averagePrecision: averagePrecision(order, labels), precisionAt25: top / 25 };
}

function runTask(
    task: TaskSpec,
    policies: Policy[],
    poolId: string,
    math: ReturnType<typeof buildPoolMath>,
    segment: SegmentMath & { brief: string },
    streamKey: string,
    seeds: number[],
    cpu: Record<string, number>
): TaskResult {
    const out: TaskResult = {
        language: task.language,
        batchSize: task.batchSize,
        brief: segment.brief,
        policies: {},
        averagePrecision: { "today-semantic": [], "today-lexical": [] },
        goodInSubsample: [],
        gate: { kept: 0, goodKept: 0 },
    };
    const chosen = policies.filter(p => !task.policies || task.policies.includes(p.name));
    for (const policy of chosen) {
        out.policies[policy.name] = { found: [], checksToShortlist: [], reached: [] };
        if (policy.fixed) out.policies[policy.name]!.uncapped = [];
    }
    let kept = 0;
    let good = 0;
    let goodKept = 0;
    for (let i = 0; i < math.n; i++) {
        const positive = segment.today[i]! > 0;
        if (positive) kept += 1;
        if (segment.labels[i] === 1) {
            good += 1;
            if (positive) goodKept += 1;
        }
    }
    out.gate = { kept: kept / Math.max(1, math.n), goodKept: goodKept / Math.max(1, good) };

    const options = {
        batchSize: task.batchSize,
        budgets: SIMULATION.budgets,
        shortlist: SIMULATION.shortlist,
        checksCap: SIMULATION.checksCap,
    };
    for (const seed of seeds) {
        const active = subsampleOf(poolId, math.n, seed);
        const ctx = contextFor(math, segment, active, `${streamKey}|${seed}`);
        let goodHere = 0;
        for (const j of active) goodHere += segment.labels[j]!;
        out.goodInSubsample.push(goodHere);
        for (const [name, scores] of [
            ["today-semantic", segment.today],
            ["today-lexical", segment.lexical],
        ] as const) {
            const order = Array.from({ length: active.length }, (_, a) => a)
                .sort((a, b) => scores[active[b]!]! - scores[active[a]!]! || a - b)
                .map(a => active[a]!);
            out.averagePrecision[name].push(averagePrecision(order, segment.labels));
        }
        for (const policy of chosen) {
            const before = cpuSeconds();
            const outcome = simulate(policy, ctx, options);
            const key = `policy ${policy.name} (batch ${task.batchSize})`;
            cpu[key] = (cpu[key] ?? 0) + cpuSeconds() - before;
            const runs = out.policies[policy.name]!;
            runs.found.push(outcome.found);
            const reached =
                outcome.checksToShortlist !== null &&
                outcome.checksToShortlist <= SIMULATION.checksCap;
            runs.checksToShortlist.push(
                reached ? outcome.checksToShortlist! : SIMULATION.checksCap
            );
            runs.reached.push(reached ? 1 : 0);
            runs.uncapped?.push(outcome.checksToShortlist ?? -1);
        }
    }
    return out;
}

/** Today's ranking on the whole pool with the other kind of vectors, for the prefix comparison. */
async function qualityIn(
    vectors: VectorSource,
    pool: LoadedPool,
    mode: PrefixMode,
    segment: Segment,
    languages: BriefLanguage[]
): Promise<Map<BriefLanguage, Quality>> {
    const pv = await loadPoolVectors(vectors, pool, mode);
    const labels = pool.labels(segment.label);
    const out = new Map<BriefLanguage, Quality>();
    for (const language of languages) {
        const { today } = await scoreToday(vectors, pv, segmentText(segment, language));
        out.set(language, wholePoolQuality(today, labels));
    }
    return out;
}

export async function runJob(job: JobSpec): Promise<JobResult> {
    const cpu: Record<string, number> = {};
    let mark = cpuSeconds();
    const lap = (phase: string): void => {
        const now = cpuSeconds();
        cpu[phase] = (cpu[phase] ?? 0) + now - mark;
        mark = now;
    };
    const recorder = createRecorder("replay");
    const vectors = createVectorSource({ offline: true });
    const pool = await loadPool(recorder, job.poolId);
    const other: PrefixMode = job.mode === "plain" ? "prefixed" : "plain";

    // The other kind of vectors first, so they are gone before the big matrix is built.
    const otherQuality = new Map<string, Map<BriefLanguage, Quality>>();
    for (const entry of job.segments) {
        const languages = [...new Set(entry.tasks.map(t => t.language))];
        otherQuality.set(
            entry.segmentId,
            await qualityIn(vectors, pool, other, segmentById(entry.segmentId), languages)
        );
    }
    lap("load and prefix check");

    const chosen = await loadPoolVectors(vectors, pool, job.mode);
    const math = buildPoolMath(chosen, job.hyper.bayes.dims);
    lap("similarity matrix and projection");

    const policies = allPolicies(job.hyper);
    const segments: SegmentResult[] = [];
    for (const entry of job.segments) {
        const segment = segmentById(entry.segmentId);
        const labels = pool.labels(segment.label);
        const languages = [...new Set(entry.tasks.map(t => t.language))];
        const maths = new Map<BriefLanguage, SegmentMath & { brief: string }>();
        const prefixChecks: PrefixCheck[] = [];
        for (const language of languages) {
            const segmentMath = await buildSegmentMath(
                vectors,
                chosen,
                math,
                segment,
                segmentText(segment, language)
            );
            maths.set(language, segmentMath);
            const mine = wholePoolQuality(segmentMath.today, labels);
            const theirs = otherQuality.get(entry.segmentId)!.get(language)!;
            prefixChecks.push({
                language,
                plain: job.mode === "plain" ? mine : theirs,
                prefixed: job.mode === "prefixed" ? mine : theirs,
            });
        }
        lap("today's scores");
        const tasks = entry.tasks.map(task =>
            runTask(
                task,
                policies,
                pool.spec.id,
                math,
                maths.get(task.language)!,
                `${segment.id}|${task.language}`,
                job.seeds,
                cpu
            )
        );
        mark = cpuSeconds();
        segments.push({
            segmentId: segment.id,
            good: labels.reduce((sum, v) => sum + v, 0),
            tasks,
            prefixChecks,
        });
    }
    return {
        pool: {
            id: pool.spec.id,
            description: pool.spec.description,
            size: pool.size,
            fingerprint: pool.fingerprint,
            leftOut: pool.leftOut,
            subsample: Math.round(pool.size * SIMULATION.subsample),
        },
        segments,
        cpu,
    };
}
