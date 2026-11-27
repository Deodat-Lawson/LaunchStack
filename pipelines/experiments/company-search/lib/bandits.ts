/**
 * Query-selection policies, shared by the discovery experiments.
 *
 * The setting: a search interface that answers each request with a capped
 * page of results. An ARM is a search word. Pulling an arm sends its next
 * unsent request (the next page, or the next map box) and the reward is the
 * number of target companies in the answer that were not known before. A
 * policy decides which arm to pull next and sees only what earlier pulls
 * returned.
 *
 * Three kinds of policy:
 *  - static: a fixed order decided up front (what production does today);
 *  - bandits over a fixed set of arms (epsilon-greedy, UCB1, Thompson
 *    sampling): learn which of the planned words pays;
 *  - bandits whose arms grow from feedback ("mined" words taken from the
 *    names of what has been found), with a prior from how often the word
 *    has been seen: adaptive query selection as in hidden-web crawling.
 */
import type { Rng } from "./rng";

export type ArmGroup = "plan" | "letter" | "mined";

export interface Arm {
    term: string;
    group: ArmGroup;
    /** Requests this arm could still send. */
    pending: number;
    pulls: number;
    /** New target companies over all pulls. */
    reward: number;
    /** Discounted reward and pull count: recent pulls weigh more (returns decay). */
    discReward: number;
    discPulls: number;
    /** Expected reward of the first pull, before any pull. */
    prior: number;
    /** Order in which the arm became available. */
    order: number;
}

export interface ChooseContext {
    /** Arms that still have a request to send. Never empty. */
    arms: readonly Arm[];
    /** Requests sent so far. */
    step: number;
    rng: Rng;
}

export interface Policy {
    id: string;
    label: string;
    family: "static" | "bandit" | "feedback bandit" | "bound";
    /** May the policy ask single letters (a prefix sweep)? */
    letters: boolean;
    /** May the policy ask words it found in result names? */
    mined: boolean;
    /** Does the outcome depend on the seed? */
    stochastic: boolean;
    /**
     * A feedback policy that keeps the plan's own prior for a planned word it
     * has read nothing about, instead of treating it like any unknown word.
     */
    trustPlan?: boolean;
    /** Added after the frozen design was scored: read its numbers as exploratory. */
    postHoc?: boolean;
    choose(context: ChooseContext): Arm;
}

/** Recent pulls weigh more: a search word's yield falls as it is used up. */
export const DISCOUNT = 0.6;
/** Largest possible reward of one request (the page cap), for scaling UCB1. */
export const DEFAULT_CAP = 50;

export function newArm(term: string, group: ArmGroup, order: number, prior: number): Arm {
    return {
        term,
        group,
        pending: 1,
        pulls: 0,
        reward: 0,
        discReward: 0,
        discPulls: 0,
        prior,
        order,
    };
}

export function recordPull(arm: Arm, reward: number): void {
    arm.pulls += 1;
    arm.reward += reward;
    arm.discReward = arm.discReward * DISCOUNT + reward;
    arm.discPulls = arm.discPulls * DISCOUNT + 1;
}

/** What an arm is expected to return next: its prior, then its recent average. */
export function estimate(arm: Arm): number {
    return arm.pulls === 0 ? arm.prior : arm.discReward / arm.discPulls;
}

function argmax<T>(items: readonly T[], score: (item: T) => number, rng: Rng): T {
    let best: T[] = [];
    let bestScore = -Infinity;
    for (const item of items) {
        const s = score(item);
        if (s > bestScore + 1e-12) {
            best = [item];
            bestScore = s;
        } else if (Math.abs(s - bestScore) <= 1e-12) best.push(item);
    }
    return best.length === 1 ? best[0]! : rng.pick(best);
}

function first(arms: readonly Arm[]): Arm {
    return arms.reduce((a, b) => (b.order < a.order ? b : a));
}

/**
 * Static breadth-first: every arm's first request in the order the arms were
 * planned, then the follow-up requests (deeper pages or boxes) in the order
 * they became available. Nothing is learned.
 */
function staticOrder(
    id: string,
    label: string,
    options: { letters: boolean; shuffle: boolean }
): Policy {
    return {
        id,
        label,
        family: "static",
        letters: options.letters,
        mined: false,
        stochastic: options.shuffle,
        choose: ({ arms, rng }) => {
            const unpulled = arms.filter(a => a.pulls === 0);
            if (unpulled.length > 0) return options.shuffle ? rng.pick(unpulled) : first(unpulled);
            // Follow-ups: the arm asked least so far, i.e. level by level.
            const fewest = Math.min(...arms.map(a => a.pulls));
            const level = arms.filter(a => a.pulls === fewest);
            return options.shuffle ? rng.pick(level) : first(level);
        },
    };
}

function epsilonGreedy(id: string, options: { letters: boolean; mined: boolean }): Policy {
    const epsilon = 0.1;
    return {
        id,
        label: `Epsilon-greedy (${epsilon})`,
        family: options.mined ? "feedback bandit" : "bandit",
        letters: options.letters,
        mined: options.mined,
        stochastic: true,
        choose: ({ arms, rng }) =>
            rng.next() < epsilon ? rng.pick(arms) : argmax(arms, estimate, rng),
    };
}

/**
 * UCB1 (Auer, Cesa-Bianchi & Fischer 2002), rewards scaled to [0, 1] by the
 * page cap. Textbook form: every arm is tried once before any is repeated.
 */
function ucb1(id: string, options: { letters: boolean; cap: number }): Policy {
    return {
        id,
        label: "UCB1",
        family: "bandit",
        letters: options.letters,
        mined: false,
        stochastic: true,
        choose: ({ arms, step, rng }) => {
            const unpulled = arms.filter(a => a.pulls === 0);
            if (unpulled.length > 0) return rng.pick(unpulled);
            return argmax(
                arms,
                a =>
                    a.reward / a.pulls / options.cap +
                    Math.sqrt((2 * Math.log(Math.max(2, step))) / a.pulls),
                rng
            );
        },
    };
}

/**
 * Thompson sampling with a Gamma-Poisson model of new results per request:
 * the prior is worth one imaginary request at the arm's prior mean, the
 * evidence is the discounted reward. Each step samples a rate per arm and
 * pulls the largest.
 */
function thompson(id: string, options: { letters: boolean; mined: boolean }): Policy {
    return {
        id,
        label: "Thompson sampling",
        family: options.mined ? "feedback bandit" : "bandit",
        letters: options.letters,
        mined: options.mined,
        stochastic: true,
        choose: ({ arms, rng }) =>
            argmax(
                arms,
                a => {
                    const shape = Math.max(0.05, a.prior + a.discReward);
                    const rate = 1 + a.discPulls;
                    return rng.gamma(shape) / rate;
                },
                rng
            ),
    };
}

/** Greedy on the current estimate: exploit only; ties broken at random. */
function greedy(id: string, options: { letters: boolean; mined: boolean }): Policy {
    return {
        id,
        label: "Greedy on estimated yield",
        family: options.mined ? "feedback bandit" : "bandit",
        letters: options.letters,
        mined: options.mined,
        stochastic: true,
        choose: ({ arms, rng }) => argmax(arms, estimate, rng),
    };
}

export interface PolicySetOptions {
    /** The page cap of the interface (largest reward of one request). */
    cap?: number;
    /** Whether single-letter arms make sense for the interface (prefix search). */
    letters?: boolean;
}

/** The policies every discovery experiment compares, in report order. */
export function policySet(options: PolicySetOptions = {}): Policy[] {
    const cap = options.cap ?? DEFAULT_CAP;
    const letters = options.letters ?? true;
    const policies: Policy[] = [
        {
            ...staticOrder("plan-static", "Planned words, fixed order", {
                letters: false,
                shuffle: false,
            }),
        },
    ];
    if (letters) {
        policies.push(
            staticOrder("letters-static", "Planned words, then a to z, fixed order", {
                letters: true,
                shuffle: false,
            }),
            staticOrder("letters-random", "Planned words and a to z, random order", {
                letters: true,
                shuffle: true,
            })
        );
    }
    policies.push(
        { ...epsilonGreedy("egreedy", { letters, mined: false }) },
        ucb1("ucb1", { letters, cap }),
        { ...thompson("thompson", { letters, mined: false }) },
        {
            ...greedy("mined-greedy", { letters, mined: true }),
            label: "Mined words, greedy",
        },
        {
            ...epsilonGreedy("mined-egreedy", { letters, mined: true }),
            label: "Mined words, epsilon-greedy (0.1)",
        },
        {
            ...thompson("mined-thompson", { letters, mined: true }),
            label: "Mined words, Thompson sampling",
        },
        {
            ...greedy("mined-greedy-plan", { letters, mined: true }),
            label: "Mined words, greedy, planned words trusted first",
            trustPlan: true,
            postHoc: true,
        }
    );
    return policies;
}
