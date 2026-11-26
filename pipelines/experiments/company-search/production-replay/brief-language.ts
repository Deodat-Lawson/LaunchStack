/**
 * "Write the segment brief in the buyers' language", replayed on production's
 * embedding models.
 *
 * E4 found that on Norwegian company texts a Norwegian brief ranks far better
 * than an English one (25.0 against 58.5 good companies in 100 checks), and
 * that the relevance-above-zero rule then drops most good companies. That was
 * measured with the small local model. Here the same three pools are ranked by
 * production's own relevance (semanticRelevance) and checked from the top
 * down, as production does, once per brief, on every embedding model whose
 * vectors are on this machine.
 *
 * Three briefs per pool: English, Norwegian (E4's, as a Norwegian seller would
 * type it), and the higher of the two scores per company.
 */
import { semanticRelevance, type EmbedTexts } from "../../../src/distribution/semantic";
import { briefOf, segmentText } from "../e4-whom-to-check/briefs";
import { SIMULATION } from "../e4-whom-to-check/config";
import { createRecorder, loadPool, type LoadedPool } from "../e4-whom-to-check/data";
import { REPORTED_SEGMENTS, type PoolId } from "../e4-whom-to-check/segments";
import { subsampleOf } from "../e4-whom-to-check/simulate";
import { clustered, difference, mean, round, type Spread } from "../e4-whom-to-check/stats";
import type { ReplayEmbedder } from "./vectors";

export const BRIEFS = ["english", "norwegian", "higher"] as const;
export type Brief = (typeof BRIEFS)[number];

/** Checks after which the good companies found so far are counted. */
export const BRIEF_BUDGETS = [25, 50, 100, 200] as const;
const BUDGETS = BRIEF_BUDGETS;
type Budget = `found${(typeof BUDGETS)[number]}`;

export interface BriefSegment {
    segment: string;
    pool: string;
    /** Companies in a seed's draw. */
    candidates: number;
    /** Good companies in the whole pool. */
    good: number;
    /** Per brief: mean over seeds of good companies in the first b checks. */
    found: Record<Brief, Record<Budget, number>>;
    /** Per brief, whole pool: what production's relevance-above-zero rule keeps. */
    zeroScoreRule: Record<Brief, { poolKept: number; goodKept: number }>;
}

export interface BriefSummary {
    seeds: number;
    perSegment: BriefSegment[];
    /** Mean of the three pools, 95% interval over pools and seeds. */
    overall: Record<Brief, Record<Budget, Spread>>;
    /** Norwegian brief minus English brief, paired by seed. */
    norwegianMinusEnglish: Record<Budget, Spread>;
}

export async function runBriefLanguageReplay(options: {
    embedder: ReplayEmbedder;
    seeds?: readonly number[];
}): Promise<BriefSummary> {
    const seeds = options.seeds ?? SIMULATION.seeds;
    const embed: EmbedTexts = texts => options.embedder.embed(texts);
    const recorder = createRecorder("replay");
    const pools = new Map<PoolId, LoadedPool>();
    const perSegment: BriefSegment[] = [];
    /** [brief][budget] → per segment → per seed. */
    const runs = Object.fromEntries(
        BRIEFS.map(brief => [brief, BUDGETS.map(() => [] as number[][])])
    ) as Record<Brief, number[][][]>;

    for (const segment of REPORTED_SEGMENTS.filter(s => s.norwegian)) {
        let pool = pools.get(segment.pool);
        if (!pool) {
            pool = await loadPool(recorder, segment.pool);
            pools.set(segment.pool, pool);
        }
        const labels = pool.labels(segment.label);
        // Production's relevance of every company to each brief.
        const english = await semanticRelevance(
            embed,
            briefOf(segmentText(segment, "en")),
            pool.texts
        );
        const norwegian = await semanticRelevance(
            embed,
            briefOf(segmentText(segment, "no")),
            pool.texts
        );
        const relevance: Record<Brief, number[]> = {
            english,
            norwegian,
            higher: english.map((score, i) => Math.max(score, norwegian[i]!)),
        };
        const good = labels.reduce((sum, v) => sum + v, 0);
        const found = {} as BriefSegment["found"];
        const zeroScoreRule = {} as BriefSegment["zeroScoreRule"];
        for (const brief of BRIEFS) {
            const scores = relevance[brief];
            const bySeed: number[][] = [];
            for (const seed of seeds) {
                // The seed's draw of the pool, checked in today's order: relevance,
                // ties in the draw's order.
                const active = subsampleOf(pool.spec.id, pool.size, seed);
                const order = Array.from({ length: active.length }, (_, a) => a)
                    .sort((a, b) => scores[active[b]!]! - scores[active[a]!]! || a - b)
                    .map(a => active[a]!);
                const counts = BUDGETS.map(() => 0);
                for (const [rank, index] of order.slice(0, BUDGETS.at(-1)).entries()) {
                    if (labels[index] !== 1) continue;
                    for (const [b, budget] of BUDGETS.entries()) if (rank < budget) counts[b]! += 1;
                }
                bySeed.push(counts);
            }
            found[brief] = Object.fromEntries(
                BUDGETS.map((budget, b) => [
                    `found${budget}`,
                    round(mean(bySeed.map(row => row[b]!)), 2),
                ])
            ) as Record<Budget, number>;
            for (const [b] of BUDGETS.entries()) runs[brief][b]!.push(bySeed.map(row => row[b]!));
            let kept = 0;
            let goodKept = 0;
            for (const [i, score] of scores.entries()) {
                if (!(score > 0)) continue;
                kept += 1;
                if (labels[i] === 1) goodKept += 1;
            }
            zeroScoreRule[brief] = {
                poolKept: round(kept / pool.size, 3),
                goodKept: round(goodKept / Math.max(1, good), 3),
            };
        }
        perSegment.push({
            segment: segment.id,
            pool: segment.pool,
            candidates: Math.round(pool.size * SIMULATION.subsample),
            good,
            found,
            zeroScoreRule,
        });
    }

    const overall = Object.fromEntries(
        BRIEFS.map(brief => [
            brief,
            Object.fromEntries(
                BUDGETS.map((budget, b) => [`found${budget}`, clustered(runs[brief][b]!)])
            ),
        ])
    ) as BriefSummary["overall"];
    const norwegianMinusEnglish = Object.fromEntries(
        BUDGETS.map((budget, b) => [
            `found${budget}`,
            clustered(
                runs.norwegian[b]!.map((values, s) => difference(values, runs.english[b]![s]!))
            ),
        ])
    ) as BriefSummary["norwegianMinusEnglish"];
    return { seeds: seeds.length, perSegment, overall, norwegianMinusEnglish };
}

const signed = (value: number): string => (value > 0 ? `+${value}` : String(value));
const percent = (share: number): string => `${Math.round(share * 100)}%`;

/** The table a run prints for one embedding model. */
export function briefTable(model: string, summary: BriefSummary): string {
    const lines = [
        `${model}: good companies found in 100 checks by today's ranking, per brief (${summary.seeds} seeds)`,
        `${"segment".padEnd(22)}${"English".padStart(9)}${"Norwegian".padStart(11)}${"higher".padStart(8)}   | zero-score rule keeps, English brief: pool / good`,
    ];
    for (const s of summary.perSegment) {
        lines.push(
            `${s.segment.padEnd(22)}${String(s.found.english.found100).padStart(9)}${String(s.found.norwegian.found100).padStart(11)}${String(s.found.higher.found100).padStart(8)}   | ${percent(s.zeroScoreRule.english.poolKept)} / ${percent(s.zeroScoreRule.english.goodKept)}`
        );
    }
    const o = summary.overall;
    const d = summary.norwegianMinusEnglish.found100;
    lines.push(
        `${"three pools".padEnd(22)}${String(o.english.found100.mean).padStart(9)}${String(o.norwegian.found100.mean).padStart(11)}${String(o.higher.found100.mean).padStart(8)}`
    );
    lines.push(
        `Norwegian minus English, found in 100 checks: ${signed(d.mean)} (95% interval ${signed(d.lo)} to ${signed(d.hi)})`
    );
    return lines.join("\n");
}
