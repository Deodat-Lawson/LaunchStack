/**
 * The fit check of a run's candidates, round by round: who is asked "would
 * this business buy this?", in which order, until the shortlist is full.
 *
 * With the fixed ranking a round checks the next companies down the list,
 * twice as many as there are open places. With a learner (./learn) a round is
 * small and the learner picks it: after each round it re-ranks everyone not
 * checked yet from the verdicts so far, and the highest ranked go next.
 *
 * The model call is the `judge` port, so a run, a test and the experiment's
 * replay all go through this same loop.
 */
import { createHash } from "node:crypto";

import type { ShortlistLearner } from "./learn";
import { placeLabel } from "./locate";
import type { FitVerdict } from "./semantic";
import type { PartnerKind, ProgramRecord, Territory } from "./types";

export interface ShortlistCandidate {
    id: string;
    name: string;
    /** The company's own words, as the fit check reads them. */
    text: string;
}

/** Companies the fixed ranking checks per open shortlist place, each round down the list. */
export const JUDGE_POOL_FACTOR = 2;

/**
 * Companies checked per round when the ranking learns. One model call, and
 * small enough that a round's verdicts steer the next one. The experiment (E4,
 * batch-size runs) found 79.5 good companies in 100 checks with 5 per round
 * and 78.7 with 10, so the larger one is used and a run makes half the calls.
 */
export const LEARNING_ROUND = 10;

/** A list as the set it stands for: no repeats, in one order. */
const asSet = (items: readonly string[]): string[] => [...new Set(items)].sort();

/**
 * The question a run puts to the fit check about a segment: what the segment
 * sells, who buys it and as what, what rules a company out, and where. The
 * fit check's verdicts are kept under this key, so a rewritten segment, a
 * moved area or a run over one part of the segment starts afresh instead of
 * learning from answers to a different question. Lists count as sets:
 * reordering or repeating an entry asks the same thing. The seller's own profile is left out;
 * it is the same seller whatever its documents say this month.
 */
export function segmentKey(
    program: Pick<
        ProgramRecord,
        "offering" | "categories" | "constraints" | "partnerKinds" | "targetTerritories"
    >,
    /** The run's own narrowing of the segment (its options), when it has one. */
    run?: {
        partnerKinds?: readonly PartnerKind[];
        territories?: readonly Territory[];
    } | null
): string {
    const kinds = run?.partnerKinds?.length ? run.partnerKinds : program.partnerKinds;
    const territories = run?.territories?.length ? run.territories : program.targetTerritories;
    return createHash("sha256")
        .update(
            JSON.stringify([
                program.offering.trim(),
                asSet(program.categories),
                program.constraints?.trim() ?? "",
                asSet(kinds),
                asSet(territories.map(placeLabel)),
            ])
        )
        .digest("hex")
        .slice(0, 32);
}

export interface FillShortlistArgs {
    /** Candidates in the fixed ranking's order, best first. */
    queue: readonly ShortlistCandidate[];
    /** Places on the shortlist. */
    wanted: number;
    /** One round of fit checks. An id it leaves out was not judged, and stays in. */
    judge: (batch: ShortlistCandidate[]) => Promise<Map<string, FitVerdict>>;
    /**
     * Re-ranks who is left from the verdicts so far, over the queue's indexes.
     * Null or absent: the fixed order.
     */
    learner?: Pick<ShortlistLearner, "next" | "observe" | "skip"> | null;
    /**
     * How well a candidate sits in the segment's area, by queue index; a higher
     * tier is worked through before a lower one is touched, as in the fixed
     * order. Only read with a learner: the queue is already in that order.
     */
    tierOf?: (index: number) => number;
    /** Companies per round with a learner. */
    roundSize?: number;
    /** Stop after this many checks; absent, until the list is full or nobody is left. */
    maxChecks?: number;
}

export interface FillShortlistResult {
    /** Every company the fit check was asked about, in the order it was asked. */
    checked: string[];
    /** The verdicts that came back, by id. */
    verdicts: Map<string, FitVerdict>;
    /** Companies with no "no": judged a fit, or asked about and not answered for. */
    kept: number;
    rounds: number;
    /** Set when a round failed: everything seen before it stands. */
    error?: unknown;
    /**
     * Set when the learner had nobody to offer while companies were still
     * waiting (numbers it could not rank): the fixed order took over from there.
     */
    learnerQuit?: boolean;
}

export async function fillShortlist(args: FillShortlistArgs): Promise<FillShortlistResult> {
    const { queue, wanted } = args;
    const learner = args.learner ?? null;
    const roundSize = Math.max(1, args.roundSize ?? LEARNING_ROUND);
    const maxChecks = args.maxChecks ?? Number.POSITIVE_INFINITY;
    const result: FillShortlistResult = { checked: [], verdicts: new Map(), kept: 0, rounds: 0 };

    const tierOf = args.tierOf;
    const tiers =
        learner && tierOf
            ? [...new Set(queue.map((_, index) => tierOf(index)))].sort((a, b) => b - a)
            : [];
    let at = 0;
    /** Queue indexes already asked about: the fixed order steps over them. */
    const asked = new Uint8Array(queue.length);
    const downTheQueue = (count: number): number[] => {
        const out: number[] = [];
        for (; out.length < count && at < queue.length; at++) if (asked[at] === 0) out.push(at);
        return out;
    };
    /** The next companies to ask about, as queue indexes. */
    const pick = (count: number): number[] => {
        if (!learner || result.learnerQuit) return downTheQueue(count);
        const out: number[] = [];
        if (!tierOf) out.push(...learner.next(count));
        else
            for (const tier of tiers) {
                if (out.length >= count) break;
                out.push(...learner.next(count - out.length, index => tierOf(index) === tier));
            }
        if (out.length > 0 || result.checked.length >= queue.length) return out;
        // Companies are waiting and the learner offers none: it has numbers it
        // cannot rank. The fit check must not stop for that.
        result.learnerQuit = true;
        return downTheQueue(count);
    };

    try {
        // Until the shortlist is full or no one is left: a round of no's must
        // not end the run with an empty list.
        while (result.kept < wanted && result.checked.length < maxChecks) {
            const room = wanted - result.kept;
            const size = Math.min(
                learner ? Math.min(roundSize, room * JUDGE_POOL_FACTOR) : room * JUDGE_POOL_FACTOR,
                maxChecks - result.checked.length
            );
            const indexes = pick(size);
            if (indexes.length === 0) break;
            for (const index of indexes) asked[index] = 1;
            const batch = indexes.map(index => queue[index]!);
            const answers = await args.judge(batch);
            result.rounds += 1;
            for (const [position, index] of indexes.entries()) {
                const candidate = batch[position]!;
                result.checked.push(candidate.id);
                const verdict = answers.get(candidate.id);
                if (verdict) result.verdicts.set(candidate.id, verdict);
                if (verdict && !verdict.fit) {
                    learner?.observe(index, false);
                    continue;
                }
                result.kept += 1;
                if (verdict) learner?.observe(index, true);
                else learner?.skip(index);
            }
        }
    } catch (error) {
        result.error = error;
    }
    return result;
}
