/**
 * The page-selection policies, replayed offline on recorded sites.
 *
 * A visit starts with the homepage (request 1) and then makes one request at
 * a time until the budget is spent or the policy has nothing left to ask.
 * Every request costs 1, whatever comes back. What counts as a page is
 * production's rule: status below 400, at least 120 characters of text, and
 * a final URL not read before in this visit.
 */
import type { Rng } from "../lib/rng";
import { urlKey } from "./html";
import { LINK_CLASSES, type LinkClass } from "./prior";
import { factCount, type PageOutcome, type PoolLink, type SiteRecord } from "./site";

export const BUDGETS = [2, 4, 6, 8, 14] as const;
export const MAX_BUDGET = 14;
/** Production stops once it has this many readable pages, the homepage included. */
export const PRODUCTION_MAX_PAGES = 4;

export type StepKind = "page" | "unreadable" | "duplicate" | "overhead" | "overhead-failed";

export interface Step {
    /** Fact types found so far, after this request (bits of FACT). */
    mask: number;
    ownEmail: boolean;
    kind: StepKind;
    /** A page whose text an earlier page of this visit already had (a soft 404, a mirror). */
    sameText: boolean;
    /** How long the request took when it was recorded. */
    ms: number;
}

/** One policy's visit to one site. */
export class Visit {
    /** One entry per request; the first is the homepage. */
    readonly steps: Step[] = [];
    /** The page URLs asked for, in order (the homepage first; sitemap and robots requests are not pages). */
    readonly asked: string[] = [];
    /** Readable pages so far, the homepage included. */
    pages = 1;
    private found: number;
    private own: boolean;
    private readonly fetchedKeys = new Set<string>();
    private readonly requested = new Set<string>();
    private readonly texts = new Set<string>();

    constructor(
        readonly site: SiteRecord,
        readonly budget: number
    ) {
        const home = site.home;
        this.found = home.facts;
        this.own = home.ownEmail;
        if (home.finalKey) this.fetchedKeys.add(home.finalKey);
        this.fetchedKeys.add(home.requestKey);
        if (home.textHash) this.texts.add(home.textHash);
        this.asked.push(site.homeUrl);
        this.steps.push({
            mask: this.found,
            ownEmail: this.own,
            kind: "page",
            sameText: false,
            ms: home.ms,
        });
    }

    get full(): boolean {
        return this.steps.length >= this.budget;
    }

    get mask(): number {
        return this.found;
    }

    /** Already asked for, or the URL of a page already read: asking again cannot help. */
    known(url: string): boolean {
        return this.requested.has(url) || this.fetchedKeys.has(urlKey(url));
    }

    /** Would this recorded page still count as a new page? */
    fresh(outcome: PageOutcome): boolean {
        return (
            outcome.readable &&
            outcome.finalKey !== null &&
            !this.fetchedKeys.has(outcome.finalKey) &&
            !this.requested.has(outcome.url)
        );
    }

    /** One page request. Returns how many new fact types it revealed. */
    fetch(url: string): { counted: boolean; gained: number } {
        if (this.full) throw new Error(`${this.site.id}: request beyond the budget`);
        const outcome = this.site.pages.get(url);
        if (!outcome) throw new Error(`${this.site.id}: no recorded outcome for a requested URL`);
        this.requested.add(url);
        this.asked.push(url);
        let kind: StepKind;
        let gained = 0;
        let sameText = false;
        if (!outcome.readable || outcome.finalKey === null) {
            kind = "unreadable";
        } else if (this.fetchedKeys.has(outcome.finalKey)) {
            kind = "duplicate";
        } else {
            kind = "page";
            this.fetchedKeys.add(outcome.finalKey);
            this.fetchedKeys.add(outcome.requestKey);
            const before = factCount(this.found);
            this.found |= outcome.facts;
            this.own = this.own || outcome.ownEmail;
            gained = factCount(this.found) - before;
            if (outcome.textHash) {
                sameText = this.texts.has(outcome.textHash);
                this.texts.add(outcome.textHash);
            }
            this.pages += 1;
        }
        this.steps.push({ mask: this.found, ownEmail: this.own, kind, sameText, ms: outcome.ms });
        return { counted: kind === "page", gained };
    }

    /** A request that is not for a page: robots.txt or a sitemap file. */
    overhead(useful: boolean): void {
        if (this.full) throw new Error(`${this.site.id}: request beyond the budget`);
        this.steps.push({
            mask: this.found,
            ownEmail: this.own,
            kind: useful ? "overhead" : "overhead-failed",
            sameText: false,
            ms: 0,
        });
    }
}

// ─── today ───────────────────────────────────────────────────────────────────

/**
 * Production's order: the homepage, then the guessed paths in order until 4
 * pages were readable. A path robots.txt disallows was never recorded, so no
 * policy asks for it and it costs nothing.
 */
export function visitToday(site: SiteRecord, budget: number): Visit {
    const visit = new Visit(site, budget);
    for (const guess of site.guessed) {
        if (visit.full || visit.pages >= PRODUCTION_MAX_PAGES) break;
        if (!guess.allowed) continue;
        visit.fetch(guess.url);
    }
    return visit;
}

// ─── links by the fixed keyword prior ────────────────────────────────────────

function followLinks(visit: Visit, links: readonly PoolLink[]): void {
    for (const link of links) {
        if (visit.full) return;
        if (visit.known(link.url)) continue;
        visit.fetch(link.url);
    }
}

function followGuesses(visit: Visit): void {
    for (const guess of visit.site.guessed) {
        if (visit.full) return;
        if (!guess.allowed || visit.known(guess.url)) continue;
        visit.fetch(guess.url);
    }
}

/** The homepage's links, best prior score first; no guessed paths. */
export function visitLinkKeyword(site: SiteRecord, budget: number): Visit {
    const visit = new Visit(site, budget);
    followLinks(visit, site.links);
    return visit;
}

/** As above; when the links run out, production's guessed paths the homepage did not link. */
export function visitLinkKeywordFallback(site: SiteRecord, budget: number): Visit {
    const visit = new Visit(site, budget);
    followLinks(visit, site.links);
    followGuesses(visit);
    return visit;
}

/** The same links in random order: what choosing among them without any idea is worth. */
export function visitRandomLink(site: SiteRecord, budget: number, rng: Rng): Visit {
    const visit = new Visit(site, budget);
    followLinks(visit, rng.shuffle(site.links));
    return visit;
}

/**
 * Pay for the sitemap first (guess /sitemap.xml; if that fails, robots.txt
 * and the sitemap it names; one more request for a child of an index), read
 * its best URLs by the keyword prior, then go on with the homepage's links.
 */
export function visitSitemapFirst(site: SiteRecord, budget: number): Visit {
    const visit = new Visit(site, budget);
    for (const step of site.sitemap.overhead) {
        if (visit.full) return visit;
        visit.overhead(step.useful);
    }
    if (site.sitemap.usable) {
        for (const url of site.sitemap.picks) {
            if (visit.full) return visit;
            if (visit.known(url)) continue;
            visit.fetch(url);
        }
    }
    followLinks(visit, site.links);
    return visit;
}

// ─── oracle ──────────────────────────────────────────────────────────────────

/**
 * Knows what every recorded page holds and takes, each time, the page that
 * adds the most fact types (greedy set cover). Stops when nothing adds any.
 */
export function visitOracle(site: SiteRecord, budget: number): Visit {
    const visit = new Visit(site, budget);
    const candidates = [...site.pages.values()].filter(outcome => outcome.readable);
    while (!visit.full) {
        let best: PageOutcome | null = null;
        let bestGain = 0;
        for (const outcome of candidates) {
            if (!visit.fresh(outcome)) continue;
            const gain = factCount(visit.mask | outcome.facts) - factCount(visit.mask);
            if (gain > bestGain) {
                best = outcome;
                bestGain = gain;
            }
        }
        if (!best) break;
        visit.fetch(best.url);
    }
    return visit;
}

/**
 * The most fact types any `pages` recorded pages can add to the homepage,
 * exactly (the fact set is 5 bits, so every reachable set is enumerated).
 * Used to check that the greedy oracle really is an upper bound.
 */
export function bestPossibleScore(site: SiteRecord, pages: number): number {
    const masks = new Set<number>();
    for (const outcome of site.pages.values()) if (outcome.readable) masks.add(outcome.facts);
    let reachable = new Set<number>([site.home.facts]);
    for (let step = 0; step < pages; step++) {
        const next = new Set(reachable);
        for (const have of reachable) for (const mask of masks) next.add(have | mask);
        if (next.size === reachable.size) break;
        reachable = next;
    }
    let best = 0;
    for (const mask of reachable) best = Math.max(best, factCount(mask));
    return best;
}

/** The score over every recorded page of the site. */
export function ceilingMask(site: SiteRecord): number {
    let mask = site.home.facts;
    for (const outcome of site.pages.values()) if (outcome.readable) mask |= outcome.facts;
    return mask;
}

// ─── learned link classes ────────────────────────────────────────────────────

/**
 * What a learned policy carries from site to site: per link class, how often
 * fetching a page of that class revealed a fact type the site did not have yet.
 */
export interface ClassBeliefs {
    wins: Record<LinkClass, number>;
    losses: Record<LinkClass, number>;
    pulls: number;
}

export function freshBeliefs(): ClassBeliefs {
    const zero = (): Record<LinkClass, number> =>
        Object.fromEntries(LINK_CLASSES.map(cls => [cls, 0])) as Record<LinkClass, number>;
    return { wins: zero(), losses: zero(), pulls: 0 };
}

/** Mean of the Beta(1 + wins, 1 + losses) posterior. */
export function posteriorMean(beliefs: ClassBeliefs, cls: LinkClass): number {
    return (1 + beliefs.wins[cls]) / (2 + beliefs.wins[cls] + beliefs.losses[cls]);
}

export type ClassChooser = (
    beliefs: ClassBeliefs,
    available: readonly LinkClass[],
    rng: Rng
) => LinkClass;

function argmax(
    available: readonly LinkClass[],
    value: (cls: LinkClass) => number,
    rng: Rng
): LinkClass {
    let best: LinkClass[] = [];
    let bestValue = -Infinity;
    for (const cls of available) {
        const v = value(cls);
        if (v > bestValue) {
            best = [cls];
            bestValue = v;
        } else if (v === bestValue) {
            best.push(cls);
        }
    }
    return best.length === 1 ? best[0]! : rng.pick(best);
}

/** Thompson sampling: draw each class's rate from its posterior, take the best draw. */
export const chooseThompson: ClassChooser = (beliefs, available, rng) =>
    argmax(available, cls => rng.beta(1 + beliefs.wins[cls], 1 + beliefs.losses[cls]), rng);

/** UCB1: every class once, then the best mean plus sqrt(2 ln N / n). */
export const chooseUcb1: ClassChooser = (beliefs, available, rng) =>
    argmax(
        available,
        cls => {
            const n = beliefs.wins[cls] + beliefs.losses[cls];
            if (n === 0) return Infinity;
            return (
                beliefs.wins[cls] / n + Math.sqrt((2 * Math.log(Math.max(1, beliefs.pulls))) / n)
            );
        },
        rng
    );

export const EPSILON = 0.1;

/** Epsilon-greedy: a random class one time in ten, otherwise the best posterior mean. */
export const chooseEpsilonGreedy: ClassChooser = (beliefs, available, rng) =>
    rng.next() < EPSILON
        ? rng.pick(available)
        : argmax(available, cls => posteriorMean(beliefs, cls), rng);

/**
 * One site for a learned policy: pick a class, fetch that class's best
 * remaining link (prior score, then page order), learn from what it revealed.
 * `beliefs` is updated in place and carried to the next site.
 */
export function visitLearned(
    site: SiteRecord,
    budget: number,
    beliefs: ClassBeliefs,
    choose: ClassChooser,
    rng: Rng
): Visit {
    const visit = new Visit(site, budget);
    const queues = new Map<LinkClass, PoolLink[]>();
    for (const link of site.links) {
        const queue = queues.get(link.cls);
        if (queue) queue.push(link);
        else queues.set(link.cls, [link]);
    }
    while (!visit.full) {
        const available: LinkClass[] = [];
        for (const cls of LINK_CLASSES) {
            const queue = queues.get(cls);
            if (!queue) continue;
            while (queue.length > 0 && visit.known(queue[0]!.url)) queue.shift();
            if (queue.length > 0) available.push(cls);
        }
        if (available.length === 0) break;
        const cls = choose(beliefs, available, rng);
        const link = queues.get(cls)!.shift()!;
        const { gained } = visit.fetch(link.url);
        if (gained > 0) beliefs.wins[cls] += 1;
        else beliefs.losses[cls] += 1;
        beliefs.pulls += 1;
    }
    return visit;
}

// ─── reading a visit ─────────────────────────────────────────────────────────

export interface VisitSummary {
    mask: number;
    score: number;
    ownEmail: boolean;
    requests: number;
    /** Requests that returned nothing usable: unreadable, a repeat, a missing sitemap. */
    wasted: number;
    /** Requests that fetched robots.txt or a sitemap successfully (no facts on them). */
    overhead: number;
    /** Readable pages that repeated the text of an earlier page. */
    sameText: number;
}

/** The state of a visit after its first `budget` requests. */
export function summarize(steps: readonly Step[], budget: number): VisitSummary {
    const used = Math.min(budget, steps.length);
    const last = steps[used - 1]!;
    let wasted = 0;
    let overhead = 0;
    let sameText = 0;
    for (let i = 0; i < used; i++) {
        const step = steps[i]!;
        if (
            step.kind === "unreadable" ||
            step.kind === "duplicate" ||
            step.kind === "overhead-failed"
        )
            wasted += 1;
        if (step.kind === "overhead") overhead += 1;
        if (step.sameText) sameText += 1;
    }
    return {
        mask: last.mask,
        score: factCount(last.mask),
        ownEmail: last.ownEmail,
        requests: used,
        wasted,
        overhead,
        sameText,
    };
}

/** The first request after which the visit holds at least `score` fact types; null if never. */
export function requestsToReach(steps: readonly Step[], score: number): number | null {
    for (let i = 0; i < steps.length; i++) if (factCount(steps[i]!.mask) >= score) return i + 1;
    return null;
}
