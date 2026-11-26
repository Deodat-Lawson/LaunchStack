/**
 * Runs the shortlist replay over E4's seven reported segments, each with a
 * brief in its companies' own language (E4's headline condition), and returns
 * the summary. Offline: recorded pools and cached vectors only.
 */
import type { LearnerSettings } from "../../../src/distribution/learn";
import type { BriefLanguage } from "../e4-whom-to-check/briefs";
import { SIMULATION } from "../e4-whom-to-check/config";
import { createRecorder, loadPool, type LoadedPool } from "../e4-whom-to-check/data";
import { REPORTED_SEGMENTS, type PoolId } from "../e4-whom-to-check/segments";
import { summarise, type SegmentOutcomes, type ShortlistSummary } from "./shortlist-report";
import { ARMS, prepareSegment, replaySeed, type Arm, type SeedOutcome } from "./shortlist-replay";
import { cachedEmbedder, LOCAL_MODEL, type ReplayEmbedder } from "./vectors";

export interface ShortlistRunOptions {
    embedder?: ReplayEmbedder;
    /** Seeds to replay; E4's twenty by default. */
    seeds?: readonly number[];
    /** Segment ids; all seven reported ones by default. */
    segments?: readonly string[];
    /** `own`: each pool's brief in its companies' language. `en`: every brief in English (E4's first run). */
    briefs?: "own" | "en";
    settings?: Partial<LearnerSettings>;
    roundSize?: number;
    /** Apply a run's relevance-above-zero rule before ranking (shortlist-replay.ts). */
    zeroScoreRule?: boolean;
    onProgress?: (line: string) => void;
}

export async function runShortlistReplay(
    options: ShortlistRunOptions = {}
): Promise<{ summary: ShortlistSummary; segments: SegmentOutcomes[] }> {
    const embedder = options.embedder ?? cachedEmbedder({ model: LOCAL_MODEL });
    const seeds = options.seeds ?? SIMULATION.seeds;
    const recorder = createRecorder("replay");
    const pools = new Map<PoolId, LoadedPool>();
    const segments: SegmentOutcomes[] = [];
    for (const segment of REPORTED_SEGMENTS) {
        if (options.segments && !options.segments.includes(segment.id)) continue;
        let pool = pools.get(segment.pool);
        if (!pool) {
            pool = await loadPool(recorder, segment.pool);
            pools.set(segment.pool, pool);
        }
        const language: BriefLanguage = options.briefs !== "en" && segment.norwegian ? "no" : "en";
        const prepared = await prepareSegment(embedder, pool, segment, language);
        const arms = Object.fromEntries(ARMS.map(arm => [arm, [] as SeedOutcome[]])) as Record<
            Arm,
            SeedOutcome[]
        >;
        for (const seed of seeds) {
            const outcome = await replaySeed(prepared, seed, {
                settings: options.settings,
                roundSize: options.roundSize,
                zeroScoreRule: options.zeroScoreRule,
            });
            for (const arm of ARMS) arms[arm].push(outcome[arm]!);
        }
        segments.push({
            segment: segment.id,
            pool: segment.pool,
            briefLanguage: language,
            candidates: Math.round(pool.size * SIMULATION.subsample),
            good: prepared.labels.reduce((sum, v) => sum + v, 0),
            arms,
        });
        options.onProgress?.(`${segment.id}: ${seeds.length} seeds replayed`);
    }
    return { summary: summarise(segments), segments };
}
