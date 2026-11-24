/**
 * The discovery simulation both search experiments share.
 *
 * An environment is a recorded search interface: it knows which words can be
 * asked and what each request returned. `simulate` plays one policy against
 * it for a budget of requests and returns, after every request, how many
 * target companies are known. Nothing here touches the network.
 */
import { estimate, newArm, recordPull, type Arm, type ArmGroup, type Policy } from "./bandits";
import { createRng, type Rng } from "./rng";

export interface ResultItem {
    id: string;
    name: string;
    /** Is this one of the companies the segment wants? */
    target: boolean;
}

/** One search word's unsent requests, in the order the interface allows. */
export interface TermCursor {
    /** Requests that could be sent now. */
    pending(): number;
    /** The next request's answer, without sending it (the oracle's view). */
    peek(): readonly ResultItem[] | null;
    /** Send the next request. */
    next(): readonly ResultItem[];
    /** True once every match of the word has been returned: nothing was cut off. */
    complete(): boolean;
}

export interface DiscoveryEnv {
    /** Most results one request can return. */
    cap: number;
    /** Words known before any request (the static plan), in plan order. */
    planTerms: readonly string[];
    /** Single letters, when the interface matches word starts. */
    letterTerms: readonly string[];
    /** Every word that was recorded and can therefore be asked. */
    allTerms(): readonly string[];
    hasTerm(term: string): boolean;
    open(term: string): TermCursor;
    /** The words of a name or of a search phrase, as the interface matches them. */
    tokens(text: string): readonly string[];
    /** Does a name word answer to a query word? Starts-with for a prefix interface, equality otherwise. */
    wordMatches(nameWord: string, queryWord: string): boolean;
    /** Every query word a name word answers to: its prefixes, or just itself. */
    keysOf(nameWord: string): readonly string[];
    /** A second count to track alongside targets (e.g. targets with a website). */
    isBonus?(id: string): boolean;
}

export interface Trace {
    /** found[i] = target companies known after i + 1 requests. */
    found: number[];
    /** bonus[i] = of those, the ones `isBonus` marks. */
    bonus: number[];
    /** Chao1 estimate of the population after each request. */
    chao1: number[];
    /** Good-Turing coverage estimate (share of the population already seen). */
    coverage: number[];
    /** Requests actually sent (less than the budget when every arm ran dry). */
    requests: number;
    /** Requests whose answer held no new target. */
    wasted: number;
    /** wastedBy[i] = requests with no new target among the first i + 1. */
    wastedBy: number[];
}

export interface SimulateOptions {
    budget: number;
    seed: number;
    /** A mined word becomes an arm once this many found target names contain it. */
    minedMinCount?: number;
    /** Prior mean (new targets) for a planned word or a letter before anything is known. */
    neutralPrior?: number;
}

/** Recent first requests weigh more when the yield factors are re-estimated. */
const FACTOR_DISCOUNT = 0.8;
/** Imaginary results behind every word, so a word never seen is not ruled out. */
const SMOOTHING = 0.5;

interface OpenArm {
    arm: Arm;
    cursor: TermCursor;
    /** The search phrase split into query words. */
    words: readonly string[];
}

/** Chao1 (bias-corrected) and Good-Turing coverage from capture counts. */
export function populationEstimates(captures: ReadonlyMap<string, number>): {
    chao1: number;
    coverage: number;
} {
    let f1 = 0;
    let f2 = 0;
    let n = 0;
    for (const count of captures.values()) {
        n += count;
        if (count === 1) f1 += 1;
        else if (count === 2) f2 += 1;
    }
    const observed = captures.size;
    return {
        chao1: observed + (f1 * (f1 - 1)) / (2 * (f2 + 1)),
        coverage: n === 0 ? 0 : 1 - f1 / n,
    };
}

/** A discounted ratio of sums, started from one imaginary observation. */
function runningRatio(
    numerator: number,
    denominator: number
): { value(): number; add(n: number, d: number): void } {
    let top = numerator;
    let bottom = denominator;
    return {
        value: () => (bottom > 0 ? top / bottom : 0),
        add: (n, d) => {
            top = top * FACTOR_DISCOUNT + n;
            bottom = bottom * FACTOR_DISCOUNT + d;
        },
    };
}

export function simulate(env: DiscoveryEnv, policy: Policy, options: SimulateOptions): Trace {
    const rng: Rng = createRng(options.seed);
    const minedMinCount = options.minedMinCount ?? 2;
    const neutralPrior = options.neutralPrior ?? 10;
    const learns = policy.family !== "static";
    const open = new Map<string, OpenArm>();
    let order = 0;
    const add = (term: string, group: ArmGroup): void => {
        if (open.has(term) || !env.hasTerm(term)) return;
        const cursor = env.open(term);
        const arm = newArm(term, group, order++, neutralPrior);
        arm.pending = cursor.pending();
        open.set(term, { arm, cursor, words: env.tokens(term) });
    };
    for (const term of env.planTerms) add(term, "plan");
    if (policy.letters) for (const term of env.letterTerms) add(term, "letter");

    const found = new Set<string>();
    const seen = new Set<string>();
    const captures = new Map<string, number>();
    // Side evidence. A result found by asking "c" says little new about "c",
    // but its OTHER name words are a fair sample of what names contain. Per
    // query word: results seen that answer to it through such another word,
    // and how many of those were targets.
    const sideSeen = new Map<string, number>();
    const sideTarget = new Map<string, number>();
    // Per whole name word: targets seen that carry it (a word becomes an arm from this).
    const wordTarget = new Map<string, number>();
    // Single query words whose every match has been returned.
    const completed: string[] = [];
    // First-request rewards per group, for policies that do not read names.
    const firstPulls: Record<ArmGroup, { sum: number; n: number }> = {
        plan: { sum: 0, n: 0 },
        letter: { sum: 0, n: 0 },
        mined: { sum: 0, n: 0 },
    };
    // Learned from first requests: results returned per side-evidence result;
    // targets returned per target predicted (the policy calibrates its own
    // optimism: a word seen in two good names is rarely as good as it looks);
    // and the share of returned targets that were new.
    const scale = runningRatio(2, 1);
    const calibration = runningRatio(1, 1);
    const novelty = runningRatio(1, 1);

    const least = (words: readonly string[], counts: ReadonlyMap<string, number>): number => {
        if (words.length === 0) return 0;
        let value = Infinity;
        for (const word of words) value = Math.min(value, counts.get(word) ?? 0);
        return value;
    };
    /** A word nothing was read about: its group's first requests, shrunk to neutral. */
    const groupPrior = (group: ArmGroup): number => {
        const pulled = firstPulls[group];
        return (neutralPrior * 2 + pulled.sum) / (2 + pulled.n);
    };
    /**
     * Expected new targets from a word's first request, from the names seen so far:
     * (results expected) x (share of them that are targets) x (share of those not known yet).
     */
    /** Share of a word's side-evidence results that were targets (add-one smoothed). */
    const sidePrecision = (words: readonly string[]): number =>
        (least(words, sideTarget) + 1) / (least(words, sideSeen) + 2);
    const informedPrior = (words: readonly string[]): number => {
        const m = least(words, sideSeen);
        const results = Math.min(env.cap, (m + SMOOTHING) * Math.max(1, scale.value()));
        return (
            results *
            sidePrecision(words) *
            Math.min(1, calibration.value()) *
            Math.min(1, novelty.value())
        );
    };
    /** Every result of the phrase is already known: a completed word covers one of its words. */
    const covered = (words: readonly string[]): boolean =>
        words.some(word => completed.some(done => done !== word && env.wordMatches(word, done)));

    const trace: Trace = {
        found: [],
        bonus: [],
        chao1: [],
        coverage: [],
        requests: 0,
        wasted: 0,
        wastedBy: [],
    };
    let bonus = 0;

    for (let step = 0; step < options.budget; step++) {
        // Refresh what is known about arms not asked yet. Only a feedback
        // policy reads the names of what it found; the plain bandits know
        // nothing about a word until they have asked it.
        const available: OpenArm[] = [];
        for (const entry of open.values()) {
            const { arm, cursor, words } = entry;
            arm.pending = cursor.pending();
            if (arm.pending === 0) continue;
            // A learning policy never asks for results it provably has already.
            if (learns && arm.pulls === 0 && covered(words)) continue;
            if (arm.pulls === 0) {
                const unread = arm.group === "plan" && least(words, sideSeen) === 0;
                arm.prior = !policy.mined
                    ? groupPrior(arm.group)
                    : policy.trustPlan && unread
                      ? groupPrior("plan")
                      : informedPrior(words);
            }
            available.push(entry);
        }
        if (available.length === 0) break;
        const chosen = policy.choose({ arms: available.map(o => o.arm), step, rng });
        const { arm, cursor, words } = open.get(chosen.term)!;
        const sideBefore = least(words, sideSeen);
        const precisionBefore = sidePrecision(words);
        const items = cursor.next();

        let reward = 0;
        let targets = 0;
        // Name words whose target count changed with this answer.
        const touched = new Set<string>();
        for (const item of items) {
            if (!seen.has(item.id)) {
                seen.add(item.id);
                const nameWords = new Set(env.tokens(item.name));
                const keys = new Set<string>();
                for (const nameWord of nameWords) {
                    if (item.target && nameWord.length >= 3 && !/^\d+$/.test(nameWord)) {
                        wordTarget.set(nameWord, (wordTarget.get(nameWord) ?? 0) + 1);
                        touched.add(nameWord);
                    }
                    // The word that made this result match the query is not evidence.
                    if (words.some(query => env.wordMatches(nameWord, query))) continue;
                    for (const key of env.keysOf(nameWord)) keys.add(key);
                }
                for (const key of keys) {
                    sideSeen.set(key, (sideSeen.get(key) ?? 0) + 1);
                    if (item.target) sideTarget.set(key, (sideTarget.get(key) ?? 0) + 1);
                }
            }
            if (!item.target) continue;
            targets += 1;
            captures.set(item.id, (captures.get(item.id) ?? 0) + 1);
            if (found.has(item.id)) continue;
            found.add(item.id);
            reward += 1;
            if (env.isBonus?.(item.id)) bonus += 1;
        }
        if (arm.pulls === 0) {
            firstPulls[arm.group].sum += reward;
            firstPulls[arm.group].n += 1;
            scale.add(items.length, sideBefore + SMOOTHING);
            if (items.length > 0) calibration.add(targets, items.length * precisionBefore);
            if (targets > 0) novelty.add(reward, targets);
        }
        recordPull(arm, reward);
        arm.pending = cursor.pending();
        if (arm.pending === 0 && cursor.complete() && words.length === 1) completed.push(words[0]!);

        if (policy.mined) {
            for (const word of touched) {
                if ((wordTarget.get(word) ?? 0) >= minedMinCount && !open.has(word))
                    add(word, "mined");
            }
        }

        trace.requests += 1;
        if (reward === 0) trace.wasted += 1;
        trace.wastedBy.push(trace.wasted);
        trace.found.push(found.size);
        trace.bonus.push(bonus);
        const estimates = populationEstimates(captures);
        trace.chao1.push(estimates.chao1);
        trace.coverage.push(estimates.coverage);
    }
    return trace;
}

/**
 * A reference point, not a strict upper bound: every recorded word is
 * available from the first request and each step sends the request that
 * truly returns the most new targets. It is greedy one step ahead, so a
 * policy can beat it now and then (a request that pays a little less now can
 * open more later), but no policy that learns as it goes should beat it by
 * much.
 */
export function simulateOracle(env: DiscoveryEnv, budget: number): Trace {
    const cursors = env.allTerms().map(term => env.open(term));
    const found = new Set<string>();
    const trace: Trace = {
        found: [],
        bonus: [],
        chao1: [],
        coverage: [],
        requests: 0,
        wasted: 0,
        wastedBy: [],
    };
    let bonus = 0;
    for (let step = 0; step < budget; step++) {
        let best: TermCursor | null = null;
        let bestGain = -1;
        for (const cursor of cursors) {
            if (cursor.pending() === 0) continue;
            const items = cursor.peek();
            if (!items) continue;
            let gain = 0;
            for (const item of items) if (item.target && !found.has(item.id)) gain += 1;
            if (gain > bestGain) {
                best = cursor;
                bestGain = gain;
            }
        }
        if (!best) break;
        for (const item of best.next()) {
            if (!item.target || found.has(item.id)) continue;
            found.add(item.id);
            if (env.isBonus?.(item.id)) bonus += 1;
        }
        trace.requests += 1;
        if (bestGain === 0) trace.wasted += 1;
        trace.wastedBy.push(trace.wasted);
        trace.found.push(found.size);
        trace.bonus.push(bonus);
        trace.chao1.push(0);
        trace.coverage.push(0);
    }
    return trace;
}

/** A trace value at a budget; a run that stopped early keeps its last value. */
export function at(series: readonly number[], budget: number): number {
    if (series.length === 0) return 0;
    return series[Math.min(budget, series.length) - 1]!;
}

/** For debugging and reports: the current estimate of every arm. */
export function describeArms(arms: readonly Arm[]): string {
    return [...arms]
        .sort((a, b) => estimate(b) - estimate(a))
        .slice(0, 8)
        .map(a => `${a.term}:${estimate(a).toFixed(1)}/${a.pulls}`)
        .join(" ");
}
