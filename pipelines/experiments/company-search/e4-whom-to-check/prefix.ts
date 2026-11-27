/**
 * With or without nomic-embed-text's task prefixes? Decided on the
 * development segments only, by which makes TODAY's ranking better (mean
 * average precision over the whole pool). Every policy then uses the same
 * vectors.
 */
import { round } from "../lib/stats";
import { segmentText } from "./briefs";
import { loadPool, type PrefixMode, type VectorSource } from "./data";
import { averagePrecision, loadPoolVectors, scoreToday } from "./maths";
import { DEV_SEGMENTS } from "./segments";

export interface PrefixDecision {
    decidedOn: string[];
    rule: string;
    /** Today's average precision on each development segment, per mode. */
    averagePrecision: Record<string, { plain: number; prefixed: number }>;
    mean: { plain: number; prefixed: number };
    used: PrefixMode;
}

export async function decidePrefixMode(
    recorder: Parameters<typeof loadPool>[0],
    vectors: VectorSource
): Promise<PrefixDecision> {
    const perSegment: Record<string, { plain: number; prefixed: number }> = {};
    const pools = [...new Set(DEV_SEGMENTS.map(s => s.pool))];
    for (const poolId of pools) {
        const pool = await loadPool(recorder, poolId);
        for (const mode of ["plain", "prefixed"] as const) {
            const pv = await loadPoolVectors(vectors, pool, mode);
            for (const segment of DEV_SEGMENTS.filter(s => s.pool === poolId)) {
                const { today } = await scoreToday(vectors, pv, segmentText(segment, "en"));
                const labels = pool.labels(segment.label);
                const order = Array.from({ length: pool.size }, (_, i) => i).sort(
                    (a, b) => today[b]! - today[a]! || a - b
                );
                perSegment[segment.id] = {
                    ...(perSegment[segment.id] ?? { plain: 0, prefixed: 0 }),
                    [mode]: round(averagePrecision(order, labels), 4),
                };
            }
        }
    }
    const ids = Object.keys(perSegment);
    const meanOf = (mode: PrefixMode): number =>
        round(ids.reduce((sum, id) => sum + perSegment[id]![mode], 0) / Math.max(1, ids.length), 4);
    const mean = { plain: meanOf("plain"), prefixed: meanOf("prefixed") };
    return {
        decidedOn: ids,
        rule: "the mode with the higher mean average precision of today's ranking on the development segments; plain wins a tie",
        averagePrecision: perSegment,
        mean,
        used: mean.prefixed > mean.plain ? "prefixed" : "plain",
    };
}
