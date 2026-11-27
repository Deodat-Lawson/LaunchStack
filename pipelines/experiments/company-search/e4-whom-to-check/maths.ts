/**
 * From recorded data to what a simulation needs: per pool, the similarity
 * matrix and the projection every policy shares; per segment, today's two
 * rankings (by the production functions themselves) and the hidden labels.
 */
import {
    BASELINE_TEXT,
    type EmbedTexts,
    lexicalRelevance,
    semanticRelevance,
} from "../../../src/distribution/semantic";
import { hashSeed } from "../lib/rng";
import { briefOf } from "./briefs";
import {
    EMBED_DIM,
    type LoadedPool,
    type PrefixMode,
    type VectorSource,
    type Vectors,
} from "./data";
import {
    dotAt,
    gramMatrix,
    meanRow,
    principalDirections,
    timesVector,
    unitRows,
    unitVector,
} from "./linalg";
import type { PoolMath, SegmentMath } from "./policies";
import type { Segment, SegmentText } from "./segments";

const D = EMBED_DIM;

export interface PoolVectors {
    pool: LoadedPool;
    mode: PrefixMode;
    /** The company vectors as the model returned them. */
    raw: Vectors;
    /** The same, unit length. */
    unit: Float64Array;
}

export async function loadPoolVectors(
    vectors: VectorSource,
    pool: LoadedPool,
    mode: PrefixMode
): Promise<PoolVectors> {
    const raw = await vectors.documents(pool.texts, mode);
    return { pool, mode, raw, unit: unitRows(raw.data, pool.size, D) };
}

/** The similarity matrix, the pool mean and the principal-direction projection. */
export function buildPoolMath(pv: PoolVectors, dims: number): PoolMath & { mean: Float64Array } {
    const n = pv.pool.size;
    const mean = meanRow(pv.unit, n, D);
    const meanDot = timesVector(pv.unit, n, D, mean);
    const meanSq = dotAt(mean, 0, mean, 0, D);
    const gram = gramMatrix(pv.unit, n, D);
    const directions = principalDirections(
        pv.unit,
        n,
        D,
        mean,
        dims,
        hashSeed(`${pv.pool.spec.id}|principal-directions`)
    );
    const proj = new Float64Array(n * dims);
    let sumSq = 0;
    for (let c = 0; c < dims; c++) {
        const meanAlong = dotAt(mean, 0, directions, c * D, D);
        for (let i = 0; i < n; i++) {
            const v = dotAt(pv.unit, i * D, directions, c * D, D) - meanAlong;
            proj[i * dims + c] = v;
            sumSq += v * v;
        }
    }
    const scale = sumSq > 0 ? Math.sqrt(n / sumSq) : 1;
    for (let i = 0; i < proj.length; i++) proj[i]! *= scale;
    return { n, gram, meanDot, meanSq, proj, dims, mean };
}

export interface FixedScores {
    brief: string;
    /** Production's semanticRelevance per company. */
    today: Float64Array;
    cosBrief: Float64Array;
    cosBaseline: Float64Array;
    briefUnit: Float64Array;
}

/**
 * Today's semantic score of every company, from production's own function fed
 * with the recorded vectors, plus the cosines the learners build on.
 */
export async function scoreToday(
    vectors: VectorSource,
    pv: PoolVectors,
    text: SegmentText
): Promise<FixedScores> {
    const brief = briefOf(text);
    const queries = await vectors.queries([brief, BASELINE_TEXT], pv.mode);
    const briefRaw = queries.data.subarray(0, D);
    const baselineRaw = queries.data.subarray(D, 2 * D);
    const rowOf = new Map<string, number>();
    for (const [i, t] of pv.pool.texts.entries()) if (!rowOf.has(t)) rowOf.set(t, i);
    const embed: EmbedTexts = async texts =>
        texts.map(t => {
            if (t === brief) return Array.from(briefRaw);
            if (t === BASELINE_TEXT) return Array.from(baselineRaw);
            const row = rowOf.get(t);
            if (row === undefined) throw new Error("A text has no recorded vector");
            return Array.from(pv.raw.data.subarray(row * D, (row + 1) * D));
        });
    const today = Float64Array.from(await semanticRelevance(embed, brief, pv.pool.texts));

    const n = pv.pool.size;
    const briefUnit = unitVector(briefRaw);
    const baselineUnit = unitVector(baselineRaw);
    const cosBrief = timesVector(pv.unit, n, D, briefUnit);
    const cosBaseline = timesVector(pv.unit, n, D, baselineUnit);
    // The learners' cosines must be the ones production scored with.
    const span = 1 - dotAt(briefUnit, 0, baselineUnit, 0, D);
    for (let i = 0; i < n; i++) {
        const mine = (cosBrief[i]! - cosBaseline[i]!) / span;
        if (Math.abs(mine - today[i]!) > 1e-6)
            throw new Error(`Relevance mismatch at row ${i}: ${mine} vs ${today[i]}`);
    }
    return { brief, today, cosBrief, cosBaseline, briefUnit };
}

/** Production's word-overlap relevance of every company to the segment. */
export function scoreLexical(pool: LoadedPool, text: SegmentText): Float64Array {
    const program = { categories: text.categories, offering: text.offering };
    return Float64Array.from(pool.parts.map(parts => lexicalRelevance(program, parts)));
}

export async function buildSegmentMath(
    vectors: VectorSource,
    pv: PoolVectors,
    math: { mean: Float64Array },
    segment: Segment,
    text: SegmentText
): Promise<SegmentMath & { brief: string }> {
    const fixed = await scoreToday(vectors, pv, text);
    return {
        brief: fixed.brief,
        labels: pv.pool.labels(segment.label),
        today: fixed.today,
        lexical: scoreLexical(pv.pool, text),
        cosBrief: fixed.cosBrief,
        cosBaseline: fixed.cosBaseline,
        briefMeanDot: dotAt(fixed.briefUnit, 0, math.mean, 0, D),
    };
}

/** Average precision of a ranking: the mean, over good companies, of precision at each one's rank. */
export function averagePrecision(order: readonly number[], labels: Uint8Array): number {
    let good = 0;
    let sum = 0;
    for (let rank = 0; rank < order.length; rank++) {
        if (labels[order[rank]!] !== 1) continue;
        good += 1;
        sum += good / (rank + 1);
    }
    return good > 0 ? sum / good : 0;
}
