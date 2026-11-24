/**
 * Offline replay for e3-what-to-read. Never touches the network.
 *
 *   pnpm exec tsx experiments/company-search/e3-what-to-read/run.ts
 *
 * Rebuilds the sample from the recording, replays every policy at budgets of
 * 2, 4, 6, 8 and 14 requests, prints a compact table and writes
 * ../results/e3-what-to-read.json. Two runs give byte-identical JSON.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NotRecordedError } from "../lib/recorder";
import { createRng, hashSeed } from "../lib/rng";
import { bootstrapMean, mean, pairedDifference, quantile, round } from "../lib/stats";
import { buildDataset, HOSTS_IN_PARALLEL, type Dataset } from "./dataset";
import {
    bestPossibleScore,
    BUDGETS,
    ceilingMask,
    chooseEpsilonGreedy,
    chooseThompson,
    chooseUcb1,
    EPSILON,
    freshBeliefs,
    MAX_BUDGET,
    posteriorMean,
    PRODUCTION_MAX_PAGES,
    requestsToReach,
    summarize,
    visitLearned,
    visitLinkKeyword,
    visitLinkKeywordFallback,
    visitOracle,
    visitRandomLink,
    visitSitemapFirst,
    visitToday,
    type ClassChooser,
    type Step,
    type VisitSummary,
} from "./policies";
import { LINK_CLASSES, priorWeights, type LinkClass } from "./prior";
import {
    FACT,
    FACT_TYPES,
    factCount,
    GIVE_UP_AFTER_FAILURES,
    MAX_FETCHES_PER_SITE,
    MAX_HOMEPAGE_LINKS,
    MAX_SITEMAP_PICKS,
    MIN_READABLE_CHARS,
    PRODUCTION_EXTRA_PATHS,
    SITEMAP_URL_CAP,
    type SiteRecord,
} from "./site";
import { BRREG_CODES, BRREG_MIN_STAFF, GROUPS, PHOTON_CITIES, type GroupId } from "./sources";
import { checkTodayAgainstProduction } from "./verify";

const SEEDS = 40;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_FILE = path.resolve(HERE, "..", "results", "e3-what-to-read.json");

const POLICIES = [
    "today",
    "link-keyword",
    "link-keyword+fallback",
    "link-keyword@today-spend",
    "learned-links-thompson",
    "learned-links-ucb1",
    "learned-links-egreedy",
    "sitemap-first",
    "random-link",
    "oracle",
] as const;
type PolicyId = (typeof POLICIES)[number];

const POLICY_NOTES: Record<PolicyId, string> = {
    today: "Production's order: the homepage, then its 13 guessed paths in order, stopping once 4 pages were readable.",
    "link-keyword":
        "The homepage's own links, best first by a fixed multilingual keyword prior on anchor text and path; no guessed paths.",
    "link-keyword+fallback":
        "link-keyword, then production's guessed paths the homepage did not link, once the links run out.",
    "link-keyword@today-spend":
        "link-keyword, never allowed more requests on a site than today made there (it makes fewer where the homepage has fewer links): no extra spend, only the choice of pages differs.",
    "learned-links-thompson":
        "Links grouped into 10 classes; a Beta posterior per class for 'a page of this class reveals a new fact type', learned online from site to site; Thompson sampling picks the class, the prior picks the link within it.",
    "learned-links-ucb1": "The same classes and reward, with UCB1 choosing the class.",
    "learned-links-egreedy":
        "The same classes and reward, with epsilon-greedy (0.1) choosing the class.",
    "sitemap-first":
        "Pays for the sitemap first (/sitemap.xml, else robots.txt and the sitemap it names, plus one child of an index), reads its 6 best URLs by the keyword prior, then goes on with the homepage's links.",
    "random-link":
        "The same recorded homepage links in random order: a lower bound for choosing among them.",
    oracle: "Knows the facts on every recorded page and takes the page that adds most each time (greedy set cover): an upper bound.",
};

const LEARNED: Array<{ id: PolicyId; choose: ClassChooser }> = [
    { id: "learned-links-thompson", choose: chooseThompson },
    { id: "learned-links-ucb1", choose: chooseUcb1 },
    { id: "learned-links-egreedy", choose: chooseEpsilonGreedy },
];

type Budget = (typeof BUDGETS)[number];
/**
 * "allLinksRecorded": the sites where every same-site link of the homepage was
 * recorded, so no policy's choices were narrowed by the recording cap.
 */
type Scope = "all" | GroupId | "allLinksRecorded";
const SCOPES: Scope[] = ["all", ...GROUPS.map(group => group.id), "allLinksRecorded"];
/** Production's whole-candidate time budget in keyless mode. */
const PRODUCTION_TIME_BUDGET_MS = 40_000;

/** What one policy did on one site at one budget, averaged over its seeds. */
interface Cell {
    score: number;
    found: Record<(typeof FACT_TYPES)[number], number>;
    ownEmail: number;
    requests: number;
    wasted: number;
    overhead: number;
    sameText: number;
    /** Share of seeds in which the score is at least `today`'s final score on this site. */
    matchesToday: number;
    /** Share of seeds in which the score is above, and equal to, `today`'s at the same budget. */
    beatsToday: number;
    tiesToday: number;
}

function emptyCell(): Cell {
    return {
        score: 0,
        found: { email: 0, description: 0, staff: 0, certification: 0, role: 0 },
        ownEmail: 0,
        requests: 0,
        wasted: 0,
        overhead: 0,
        sameText: 0,
        matchesToday: 0,
        beatsToday: 0,
        tiesToday: 0,
    };
}

function addTo(
    cell: Cell,
    summary: VisitSummary,
    weight: number,
    todayFinal: number,
    todayNow: number
): void {
    if (summary.score >= todayFinal) cell.matchesToday += weight;
    if (summary.score > todayNow) cell.beatsToday += weight;
    if (summary.score === todayNow) cell.tiesToday += weight;
    cell.score += summary.score * weight;
    for (const type of FACT_TYPES) if (summary.mask & FACT[type]) cell.found[type] += weight;
    if (summary.ownEmail) cell.ownEmail += weight;
    cell.requests += summary.requests * weight;
    cell.wasted += summary.wasted * weight;
    cell.overhead += summary.overhead * weight;
    cell.sameText += summary.sameText * weight;
}

/** Requests a policy needed to reach `today`'s final score on a site, over its seeds. */
interface Reach {
    /** Share of seeds in which it got there within the largest budget. */
    reached: number;
    /** Mean requests over all seeds, counting a miss as one more than the largest budget. */
    requests: number;
}

interface Simulation {
    cells: Record<PolicyId, Record<Budget, Cell[]>>;
    reach: Record<PolicyId, Reach[]>;
    learning: Record<string, Record<Budget, LearningCurve>>;
    beliefs: Record<string, Record<Budget, Record<LinkClass, { mean: number; pulls: number }>>>;
}

interface LearningCurve {
    /** Per seed: mean score on the first and on the last third of the sites visited. */
    first: number[];
    last: number[];
    /** Per seed: the same thirds, minus `link-keyword` on the same sites. */
    firstVsKeyword: number[];
    lastVsKeyword: number[];
    /** Per seed: the same thirds, minus `today` on the same sites. */
    firstVsToday: number[];
    lastVsToday: number[];
}

function simulate(sites: readonly SiteRecord[]): Simulation {
    const blank = (): Record<Budget, Cell[]> =>
        Object.fromEntries(BUDGETS.map(b => [b, sites.map(() => emptyCell())])) as Record<
            Budget,
            Cell[]
        >;
    const cells = Object.fromEntries(POLICIES.map(p => [p, blank()])) as Simulation["cells"];
    const reach = Object.fromEntries(
        POLICIES.map(p => [p, sites.map(() => ({ reached: 0, requests: 0 }))])
    ) as Simulation["reach"];

    const todaySteps = sites.map(site => visitToday(site, MAX_BUDGET).steps);
    const todayFinal = todaySteps.map(steps => factCount(steps[steps.length - 1]!.mask));
    const todayAt = (index: number, budget: Budget): number =>
        summarize(todaySteps[index]!, budget).score;
    const record = (
        policy: PolicyId,
        index: number,
        steps: readonly Step[],
        weight: number
    ): void => {
        for (const budget of BUDGETS)
            addTo(
                cells[policy][budget][index]!,
                summarize(steps, budget),
                weight,
                todayFinal[index]!,
                todayAt(index, budget)
            );
        recordReach(policy, index, steps, weight);
    };
    const recordReach = (
        policy: PolicyId,
        index: number,
        steps: readonly Step[],
        weight: number
    ): void => {
        const needed = requestsToReach(steps, todayFinal[index]!);
        const slot = reach[policy][index]!;
        slot.reached += needed === null ? 0 : weight;
        slot.requests += (needed ?? MAX_BUDGET + 1) * weight;
    };

    // Policies with no randomness and no memory: one visit, read at every budget.
    for (const [index, site] of sites.entries()) {
        const keywordSteps = visitLinkKeyword(site, MAX_BUDGET).steps;
        record("today", index, todaySteps[index]!, 1);
        record("link-keyword", index, keywordSteps, 1);
        // The same number of requests as today made on this site, never more.
        record(
            "link-keyword@today-spend",
            index,
            keywordSteps.slice(0, todaySteps[index]!.length),
            1
        );
        record("link-keyword+fallback", index, visitLinkKeywordFallback(site, MAX_BUDGET).steps, 1);
        record("sitemap-first", index, visitSitemapFirst(site, MAX_BUDGET).steps, 1);
        record("oracle", index, visitOracle(site, MAX_BUDGET).steps, 1);
    }

    // Random links: a fresh shuffle per seed and site.
    for (let seed = 0; seed < SEEDS; seed++) {
        for (const [index, site] of sites.entries()) {
            const rng = createRng(hashSeed(`e3:random-link:${seed}:${site.id}`));
            record("random-link", index, visitRandomLink(site, MAX_BUDGET, rng).steps, 1 / SEEDS);
        }
    }

    // Learned policies: one pass over the sites per seed and budget, in a seeded
    // order, carrying what was learned from one site to the next.
    const learning: Simulation["learning"] = {};
    const beliefs: Simulation["beliefs"] = {};
    const third = Math.floor(sites.length / 3);
    const indexOf = new Map(sites.map((site, index) => [site, index]));
    for (const { id, choose } of LEARNED) {
        const curves = {} as Record<Budget, LearningCurve>;
        const learned = {} as Simulation["beliefs"][string];
        learning[id] = curves;
        beliefs[id] = learned;
        for (const budget of BUDGETS) {
            const curve: LearningCurve = {
                first: [],
                last: [],
                firstVsKeyword: [],
                lastVsKeyword: [],
                firstVsToday: [],
                lastVsToday: [],
            };
            const classSums = Object.fromEntries(
                LINK_CLASSES.map(cls => [cls, { mean: 0, pulls: 0 }])
            ) as Record<LinkClass, { mean: number; pulls: number }>;
            for (let seed = 0; seed < SEEDS; seed++) {
                const order = createRng(hashSeed(`e3:order:${seed}`)).shuffle(sites);
                const rng = createRng(hashSeed(`e3:${id}:${budget}:${seed}`));
                const state = freshBeliefs();
                const scores: number[] = [];
                const versusKeyword: number[] = [];
                const versusToday: number[] = [];
                for (const site of order) {
                    const index = indexOf.get(site)!;
                    const visit = visitLearned(site, budget, state, choose, rng);
                    const summary = summarize(visit.steps, budget);
                    addTo(
                        cells[id][budget][index]!,
                        summary,
                        1 / SEEDS,
                        todayFinal[index]!,
                        todayAt(index, budget)
                    );
                    if (budget === MAX_BUDGET) recordReach(id, index, visit.steps, 1 / SEEDS);
                    scores.push(summary.score);
                    versusKeyword.push(summary.score - cells["link-keyword"][budget][index]!.score);
                    versusToday.push(summary.score - cells.today[budget][index]!.score);
                }
                curve.first.push(mean(scores.slice(0, third)));
                curve.last.push(mean(scores.slice(-third)));
                curve.firstVsKeyword.push(mean(versusKeyword.slice(0, third)));
                curve.lastVsKeyword.push(mean(versusKeyword.slice(-third)));
                curve.firstVsToday.push(mean(versusToday.slice(0, third)));
                curve.lastVsToday.push(mean(versusToday.slice(-third)));
                for (const cls of LINK_CLASSES) {
                    classSums[cls].mean += posteriorMean(state, cls) / SEEDS;
                    classSums[cls].pulls += (state.wins[cls] + state.losses[cls]) / SEEDS;
                }
            }
            curves[budget] = curve;
            learned[budget] = classSums;
        }
    }
    return { cells, reach, learning, beliefs };
}

// ─── aggregation ─────────────────────────────────────────────────────────────

type Estimate = { mean: number; lo: number; hi: number };

function interval(values: readonly number[], label: string): Estimate {
    const result = bootstrapMean(values, { seed: hashSeed(`e3:ci:${label}`) });
    return { mean: round(result.mean), lo: round(result.lo), hi: round(result.hi) };
}

/** Mean paired difference a − b over sites, with a bootstrap 95% interval. */
function paired(a: readonly number[], b: readonly number[], label: string): Estimate {
    const result = pairedDifference(a, b, { seed: hashSeed(`e3:paired:${label}`) });
    return { mean: round(result.mean), lo: round(result.lo), hi: round(result.hi) };
}

function share(part: number, whole: number): number {
    return whole === 0 ? 0 : round(part / whole);
}

function sum(values: readonly number[]): number {
    let total = 0;
    for (const value of values) total += value;
    return total;
}

interface CellReport {
    sites: number;
    meanScore: { mean: number; lo: number; hi: number };
    /** Fact types found, as a share of everything on the site's recorded pages. */
    shareOfCeiling: number;
    found: {
        email: number;
        emailOnOwnDomain: number;
        description: number;
        staff: number;
        certification: number;
        role: number;
    };
    requests: {
        mean: number;
        /** Unreadable or repeated pages and failed sitemap lookups. */
        wastedShare: number;
        /** robots.txt and sitemap files fetched successfully. */
        overheadShare: number;
        /** Readable pages that repeated an earlier page's text. */
        sameTextShare: number;
    };
    /** Share of sites where this already equals or beats `today`'s final score. */
    matchesTodayFinal: number;
    /** Paired by site; a stochastic policy is averaged over its seeds first. Null for `today` itself. */
    versusToday: {
        score: Estimate;
        /** Share of sites (and seeds) with a higher, and with the same, score as `today`. */
        betterOn: number;
        equalOn: number;
        email: Estimate;
        emailOnOwnDomain: Estimate;
        description: Estimate;
    } | null;
    /** The same paired difference in score against `link-keyword`. Null for `link-keyword` itself. */
    versusLinkKeyword: Estimate | null;
    /**
     * Paired difference in score against where `today` ends when it may spend
     * all 14 requests: this policy at this budget against `today` at its fullest.
     */
    versusTodayAt14: Estimate | null;
}

function report(
    policy: PolicyId,
    budget: Budget,
    scope: Scope,
    indices: readonly number[],
    simulation: Simulation,
    ceilings: readonly number[]
): CellReport {
    const cells = indices.map(i => simulation.cells[policy][budget][i]!);
    const today = indices.map(i => simulation.cells.today[budget][i]!);
    const label = `${policy}:${budget}:${scope}`;
    const scores = cells.map(cell => cell.score);
    const requests = sum(cells.map(cell => cell.requests));
    return {
        sites: indices.length,
        meanScore: interval(scores, label),
        shareOfCeiling: share(sum(scores), sum(indices.map(i => ceilings[i]!))),
        found: {
            email: round(mean(cells.map(cell => cell.found.email))),
            emailOnOwnDomain: round(mean(cells.map(cell => cell.ownEmail))),
            description: round(mean(cells.map(cell => cell.found.description))),
            staff: round(mean(cells.map(cell => cell.found.staff))),
            certification: round(mean(cells.map(cell => cell.found.certification))),
            role: round(mean(cells.map(cell => cell.found.role))),
        },
        requests: {
            mean: round(requests / Math.max(1, indices.length)),
            wastedShare: share(sum(cells.map(cell => cell.wasted)), requests),
            overheadShare: share(sum(cells.map(cell => cell.overhead)), requests),
            sameTextShare: share(sum(cells.map(cell => cell.sameText)), requests),
        },
        matchesTodayFinal: round(mean(cells.map(cell => cell.matchesToday))),
        versusToday:
            policy === "today"
                ? null
                : {
                      score: paired(
                          scores,
                          today.map(cell => cell.score),
                          `${label}:score`
                      ),
                      betterOn: round(mean(cells.map(cell => cell.beatsToday))),
                      equalOn: round(mean(cells.map(cell => cell.tiesToday))),
                      email: paired(
                          cells.map(cell => cell.found.email),
                          today.map(cell => cell.found.email),
                          `${label}:email`
                      ),
                      emailOnOwnDomain: paired(
                          cells.map(cell => cell.ownEmail),
                          today.map(cell => cell.ownEmail),
                          `${label}:own`
                      ),
                      description: paired(
                          cells.map(cell => cell.found.description),
                          today.map(cell => cell.found.description),
                          `${label}:description`
                      ),
                  },
        versusLinkKeyword:
            policy === "link-keyword"
                ? null
                : paired(
                      scores,
                      indices.map(i => simulation.cells["link-keyword"][budget][i]!.score),
                      `${label}:keyword`
                  ),
        versusTodayAt14:
            policy === "today"
                ? null
                : paired(
                      scores,
                      indices.map(i => simulation.cells.today[MAX_BUDGET][i]!.score),
                      `${label}:today14`
                  ),
    };
}

/** A learned policy's first third of sites against its last third, over the seeded site orders. */
interface LearningReport {
    sitesPerThird: number;
    meanScoreFirstThird: number;
    meanScoreLastThird: number;
    versusLinkKeyword: { firstThird: Estimate; lastThird: Estimate; lastMinusFirst: Estimate };
    versusToday: { firstThird: Estimate; lastThird: Estimate; lastMinusFirst: Estimate };
    /** Mean over the site orders of the Beta posterior mean after the last site, and fetches made. */
    posteriorMeanByClass: Record<LinkClass, { mean: number; fetches: number }>;
}

/** Requests needed to reach the score `today` ends with; a miss counts as one more than the largest budget. */
interface ReachReport {
    reachedWithin14: number;
    meanRequests: number;
    medianRequests: number;
}

// ─── output ──────────────────────────────────────────────────────────────────

function pad(text: string, width: number): string {
    return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function left(text: string, width: number): string {
    return text.length >= width ? text : " ".repeat(width - text.length) + text;
}

function signed(value: number, digits = 2): string {
    return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}`;
}

function delta(d: { mean: number; lo: number; hi: number }): string {
    return `${signed(d.mean)} [${signed(d.lo)}, ${signed(d.hi)}]`;
}

function percent(value: number): string {
    return `${(100 * value).toFixed(0)}%`;
}

async function main(): Promise<void> {
    let dataset: Dataset;
    try {
        // Replay is forced: this entry point never goes to the network.
        dataset = await buildDataset({ mode: "replay" });
    } catch (error) {
        if (error instanceof NotRecordedError) {
            console.error(
                `${error.message}\nThe recording is missing or incomplete. Record first:\n  COMPANY_SEARCH_BENCH_MODE=record pnpm exec tsx experiments/company-search/e3-what-to-read/record.ts`
            );
            process.exit(1);
        }
        throw error;
    }
    const sites = dataset.sites;
    if (sites.length === 0) throw new Error("No sites in the recording.");
    const check = await checkTodayAgainstProduction(dataset.ctx, sites);
    const simulation = simulate(sites);

    const ceilings = sites.map(site => factCount(ceilingMask(site)));
    const todayVisits = sites.map(site => visitToday(site, MAX_BUDGET));
    const inScope = (site: SiteRecord, scope: Scope): boolean =>
        scope === "all" ||
        site.group === scope ||
        (scope === "allLinksRecorded" && site.linkStats.notRecorded === 0 && !site.abandoned);
    const indicesOf = (scope: Scope): number[] =>
        sites.flatMap((site, index) => (inScope(site, scope) ? [index] : []));

    const policies: Record<string, unknown> = {};
    const table = {} as Record<PolicyId, Record<Budget, Record<Scope, CellReport>>>;
    const reachTable = {} as Record<PolicyId, Record<Scope, ReachReport>>;
    for (const policy of POLICIES) {
        table[policy] = {} as Record<Budget, Record<Scope, CellReport>>;
        const budgets: Record<string, unknown> = {};
        for (const budget of BUDGETS) {
            table[policy][budget] = {} as Record<Scope, CellReport>;
            const scopes: Record<string, CellReport> = {};
            for (const scope of SCOPES) {
                const cell = report(policy, budget, scope, indicesOf(scope), simulation, ceilings);
                table[policy][budget][scope] = cell;
                scopes[scope] = cell;
            }
            budgets[String(budget)] = scopes;
        }
        const reach = simulation.reach[policy];
        const reachByScope = {} as Record<Scope, ReachReport>;
        for (const scope of SCOPES) {
            const slots = indicesOf(scope).map(i => reach[i]!);
            reachByScope[scope] = {
                reachedWithin14: round(mean(slots.map(slot => slot.reached))),
                meanRequests: round(mean(slots.map(slot => slot.requests))),
                medianRequests: round(
                    quantile(
                        slots.map(slot => slot.requests),
                        0.5
                    )
                ),
            };
        }
        reachTable[policy] = reachByScope;
        policies[policy] = {
            what: POLICY_NOTES[policy],
            budgets,
            requestsToMatchTodayFinal: reachByScope,
        };
    }

    // How `today` actually spends its requests when nothing cuts it short.
    const todaySpend = (scope: Scope): Record<string, number> => {
        const visits = indicesOf(scope).map(i => todayVisits[i]!);
        const summaries = visits.map(visit => summarize(visit.steps, MAX_BUDGET));
        const requests = summaries.map(summary => summary.requests);
        const total = sum(requests);
        const guesses = total - visits.length;
        // Production also stops asking once 40 s have passed. The replay has no
        // clock; the recorded response times say where that would have cut in.
        const withinTime = visits.map(visit => {
            let elapsed = 0;
            for (let i = 0; i < visit.steps.length; i++) {
                if (elapsed > PRODUCTION_TIME_BUDGET_MS) return i;
                elapsed += visit.steps[i]!.ms;
            }
            return visit.steps.length;
        });
        return {
            sites: visits.length,
            meanRequests: round(mean(requests)),
            medianRequests: round(quantile(requests, 0.5)),
            maxRequests: Math.max(...requests),
            sitesUsingAll14: visits.filter(visit => visit.steps.length === MAX_BUDGET).length,
            sitesReachingFourPages: visits.filter(visit => visit.pages >= PRODUCTION_MAX_PAGES)
                .length,
            wastedShare: share(sum(summaries.map(summary => summary.wasted)), total),
            wastedShareOfGuessedPaths: share(
                sum(summaries.map(summary => summary.wasted)),
                guesses
            ),
            wastedOrRepeatedTextShare: share(
                sum(summaries.map(summary => summary.wasted + summary.sameText)),
                total
            ),
            readableGuessedPages: sum(visits.map(visit => visit.pages - 1)),
            readableGuessedPagesRepeatingEarlierText: sum(
                summaries.map(summary => summary.sameText)
            ),
            sitesWhereGuessedPathsAddedAFactType: visits.filter(
                visit => factCount(visit.mask) > factCount(visit.site.home.facts)
            ).length,
            meanFinalScore: round(mean(summaries.map(summary => summary.score))),
            meanPagesRead: round(mean(visits.map(visit => visit.pages))),
            sitesWhereThe40sTimeBudgetWouldCutIn: visits.filter(
                (visit, i) => withinTime[i]! < visit.steps.length
            ).length,
            meanRequestsUnderThe40sTimeBudget: round(mean(withinTime)),
        };
    };
    const today = Object.fromEntries(SCOPES.map(scope => [scope, todaySpend(scope)]));

    // Which guessed path is worth its request: how often each is asked for and readable.
    const guessedPaths = PRODUCTION_EXTRA_PATHS.map(pathname => {
        let asked = 0;
        let pages = 0;
        let gained = 0;
        for (const visit of todayVisits) {
            const guess = visit.site.guessed.find(g => g.path === pathname);
            if (!guess) continue;
            const at = visit.asked.indexOf(guess.url);
            if (at < 0) continue;
            asked += 1;
            const step = visit.steps[at]!;
            if (step.kind === "page") pages += 1;
            if (factCount(step.mask) > factCount(visit.steps[at - 1]!.mask)) gained += 1;
        }
        return { path: pathname, asked, readable: pages, revealedANewFactType: gained };
    });

    // Sample description: counts only.
    const groupReports: Record<string, unknown> = {};
    for (const group of GROUPS) {
        const members = sites.filter(site => site.group === group.id);
        const byCountry: Record<string, number> = {};
        const byStratum: Record<string, number> = {};
        for (const site of members) {
            byCountry[site.country] = (byCountry[site.country] ?? 0) + 1;
            byStratum[site.stratum] = (byStratum[site.stratum] ?? 0) + 1;
        }
        groupReports[group.id] = {
            label: group.label,
            ...dataset.sample[group.id],
            sites: members.length,
            byCountry: Object.fromEntries(
                Object.entries(byCountry).sort(([a], [b]) => a.localeCompare(b))
            ),
            bySubList: Object.fromEntries(
                Object.entries(byStratum).sort(([a], [b]) => a.localeCompare(b))
            ),
            requestsRecorded: sum(members.map(site => site.fetches)),
            httpExchangesRecorded: sum(members.map(site => site.exchanges)),
            meanHomepageScore: round(mean(members.map(site => factCount(site.home.facts)))),
            meanCeiling: round(mean(members.map(site => factCount(ceilingMask(site))))),
            sitesWithUsableSitemap: members.filter(site => site.sitemap.usable).length,
        };
    }
    const linksFound = sites.map(site => site.linkStats.found);
    const classCounts = Object.fromEntries(LINK_CLASSES.map(cls => [cls, 0])) as Record<
        LinkClass,
        number
    >;
    const classSites = Object.fromEntries(LINK_CLASSES.map(cls => [cls, 0])) as Record<
        LinkClass,
        number
    >;
    const classValue = Object.fromEntries(
        LINK_CLASSES.map(cls => [cls, { pages: 0, readable: 0, addsToHomepage: 0 }])
    ) as Record<LinkClass, { pages: number; readable: number; addsToHomepage: number }>;
    for (const site of sites) {
        const present = new Set<LinkClass>();
        for (const link of site.links) {
            classCounts[link.cls] += 1;
            present.add(link.cls);
            const outcome = site.pages.get(link.url);
            const value = classValue[link.cls];
            value.pages += 1;
            if (outcome?.readable) value.readable += 1;
            if (outcome?.readable && (outcome.facts & ~site.home.facts) !== 0)
                value.addsToHomepage += 1;
        }
        for (const cls of present) classSites[cls] += 1;
    }
    const overheadSteps = sites.map(site => site.sitemap.overhead.length);
    const oracleIsOptimal = sites.filter(site =>
        BUDGETS.every(
            budget =>
                factCount(summarize(visitOracle(site, MAX_BUDGET).steps, budget).mask) ===
                bestPossibleScore(site, budget - 1)
        )
    ).length;

    const sample = {
        sites: sites.length,
        groups: groupReports,
        directoryRequests: dataset.sources.statuses,
        directoryRequestsFailedAfterBackOff: dataset.sources.failed,
        requestsRecorded: sum(sites.map(site => site.fetches)),
        httpExchangesRecorded: sum(sites.map(site => site.exchanges)),
        requestsOnCandidatesLeftOut: sum(
            GROUPS.map(group => dataset.sample[group.id].rejectedFetches)
        ),
        requestsPerSite: {
            mean: round(mean(sites.map(site => site.fetches))),
            max: Math.max(...sites.map(site => site.fetches)),
        },
        sitesGivenUpOnWhileRecording: sites.filter(site => site.abandoned).length,
        homepageLinks: {
            meanFound: round(mean(linksFound)),
            medianFound: round(quantile(linksFound, 0.5)),
            sitesWithNone: sites.filter(site => site.linkStats.found === 0).length,
            sitesWithMoreThanRecorded: sites.filter(site => site.linkStats.notRecorded > 0).length,
            meanRecorded: round(mean(sites.map(site => site.links.length))),
            leftOutByRobots: sum(sites.map(site => site.linkStats.disallowed)),
        },
        guessedPathsLeftOutByRobots: { paths: check.disallowedPaths, sites: check.disallowedSites },
        sitemap: {
            sitesWithUsableSitemap: sites.filter(site => site.sitemap.usable).length,
            sitesWhereSitemapXmlGuessWorked: sites.filter(
                site =>
                    site.sitemap.overhead[0]?.kind === "sitemap-guess" &&
                    site.sitemap.overhead[0].useful
            ).length,
            meanRequestsBeforeFirstPage: round(mean(overheadSteps)),
            meanUrlsRead: round(
                mean(sites.filter(site => site.sitemap.usable).map(site => site.sitemap.urls))
            ),
        },
        linkClasses: Object.fromEntries(
            LINK_CLASSES.map(cls => [
                cls,
                {
                    links: classCounts[cls],
                    sitesWithOne: classSites[cls],
                    readableShare: share(classValue[cls].readable, classValue[cls].pages),
                    addsAFactTypeTheHomepageLacksShare: share(
                        classValue[cls].addsToHomepage,
                        classValue[cls].pages
                    ),
                },
            ])
        ),
        ceiling: {
            meanHomepageScore: round(mean(sites.map(site => factCount(site.home.facts)))),
            meanCeiling: round(mean(ceilings)),
            sitesWhereHomepageIsAlreadyTheCeiling: sites.filter(
                (site, index) => factCount(site.home.facts) === ceilings[index]
            ).length,
        },
        oracleEqualsExactOptimumOnSites: oracleIsOptimal,
    };

    // Learning curves and learned beliefs.
    const learning: Record<string, Record<string, LearningReport>> = {};
    for (const { id } of LEARNED) {
        const byBudget: Record<string, LearningReport> = {};
        for (const budget of BUDGETS) {
            const curve = simulation.learning[id]![budget];
            const gain = (a: readonly number[], b: readonly number[]): number[] =>
                a.map((v, i) => v - b[i]!);
            byBudget[String(budget)] = {
                sitesPerThird: Math.floor(sites.length / 3),
                meanScoreFirstThird: round(mean(curve.first)),
                meanScoreLastThird: round(mean(curve.last)),
                versusLinkKeyword: {
                    firstThird: interval(curve.firstVsKeyword, `${id}:${budget}:fk`),
                    lastThird: interval(curve.lastVsKeyword, `${id}:${budget}:lk`),
                    lastMinusFirst: interval(
                        gain(curve.lastVsKeyword, curve.firstVsKeyword),
                        `${id}:${budget}:gk`
                    ),
                },
                versusToday: {
                    firstThird: interval(curve.firstVsToday, `${id}:${budget}:ft`),
                    lastThird: interval(curve.lastVsToday, `${id}:${budget}:lt`),
                    lastMinusFirst: interval(
                        gain(curve.lastVsToday, curve.firstVsToday),
                        `${id}:${budget}:gt`
                    ),
                },
                posteriorMeanByClass: Object.fromEntries(
                    LINK_CLASSES.map(cls => [
                        cls,
                        {
                            mean: round(simulation.beliefs[id]![budget][cls].mean),
                            fetches: round(simulation.beliefs[id]![budget][cls].pulls, 1),
                        },
                    ])
                ) as LearningReport["posteriorMeanByClass"],
            };
        }
        learning[id] = byBudget;
    }

    // ── findings, as plain sentences built from the numbers above ──
    const at = (policy: PolicyId, budget: Budget, scope: Scope = "all"): CellReport =>
        table[policy][budget][scope];
    const challengers = POLICIES.filter(
        p =>
            p !== "today" &&
            p !== "oracle" &&
            p !== "random-link" &&
            p !== "link-keyword@today-spend"
    );
    const bestAt = (budget: Budget): PolicyId =>
        challengers.reduce((best, p) =>
            at(p, budget).meanScore.mean > at(best, budget).meanScore.mean ? p : best
        );
    const findings: string[] = [];
    const all = today.all!;
    const groupSizes = GROUPS.map(g => `${g.id} ${indicesOf(g.id).length}`).join(", ");
    findings.push(
        `Sample: ${sites.length} sites with a readable homepage (${groupSizes}); ${sample.requestsRecorded} requests recorded on them ` +
            `(${sample.httpExchangesRecorded} HTTP exchanges with redirect hops), ${sample.requestsPerSite.mean.toFixed(1)} per site on average and at most ${sample.requestsPerSite.max}.`
    );
    findings.push(
        `The replayed today policy asks for the same URLs in the same order as the real profileFromPages on ${check.sameRequests} of ${check.sites} sites, ` +
            `and the dossier it returns holds the same fact types on ${check.sameFacts} of the ${check.dossiers} sites where production's gate let a dossier through.`
    );
    findings.push(
        `today spends ${all.meanRequests!.toFixed(1)} requests per site on average (median ${all.medianRequests}, max ${all.maxRequests}); ` +
            `${percent(all.wastedShare!)} of them return nothing readable (${percent(all.wastedShareOfGuessedPaths!)} of the guessed paths), ` +
            `${all.sitesUsingAll14} of ${all.sites} sites use all 14 requests and ${all.sites! - all.sitesReachingFourPages!} never reach 4 readable pages.`
    );
    findings.push(
        `The guessed paths add a fact type to what the homepage already gave on ${all.sitesWhereGuessedPathsAddedAFactType} of ${all.sites} sites; ` +
            `of the ${all.readableGuessedPages} guessed pages today counts as readable, ${all.readableGuessedPagesRepeatingEarlierText} repeat the text of a page it already had.`
    );
    findings.push(
        `Guessed paths, readable when asked: ` +
            guessedPaths.map(g => `${g.path} ${g.readable}/${g.asked}`).join(", ") +
            "."
    );
    for (const budget of [4, 8] as const) {
        const base = at("today", budget);
        const keyword = at("link-keyword", budget);
        const versus = keyword.versusToday!;
        findings.push(
            `At ${budget} requests per site, today finds ${base.meanScore.mean.toFixed(2)} of 5 fact types on average and link-keyword ${keyword.meanScore.mean.toFixed(2)} ` +
                `(${signed(versus.score.mean)}, 95% interval ${signed(versus.score.lo)} to ${signed(versus.score.hi)}, paired over ${keyword.sites} sites; ` +
                `better on ${percent(versus.betterOn)} of sites, equal on ${percent(versus.equalOn)}, worse on ${percent(Math.max(0, 1 - versus.betterOn - versus.equalOn))}); ` +
                `random links find ${at("random-link", budget).meanScore.mean.toFixed(2)} and the oracle ${at("oracle", budget).meanScore.mean.toFixed(2)}.`
        );
        const best = bestAt(budget);
        if (best !== "link-keyword") {
            const cell = at(best, budget);
            findings.push(
                `The highest mean at ${budget} requests is ${best} with ${cell.meanScore.mean.toFixed(2)} (${delta(cell.versusToday!.score)} against today); ` +
                    `against link-keyword that is ${delta(cell.versusLinkKeyword!)}.`
            );
        }
        findings.push(
            `At ${budget} requests, a contact email is found on ${percent(base.found.email)} of sites by today and ${percent(keyword.found.email)} by link-keyword ` +
                `(${signed(versus.email.mean)}, interval ${signed(versus.email.lo)} to ${signed(versus.email.hi)}); ` +
                `an email on the site's own domain on ${percent(base.found.emailOnOwnDomain)} against ${percent(keyword.found.emailOnOwnDomain)} ` +
                `(${signed(versus.emailOnOwnDomain.mean)}, interval ${signed(versus.emailOnOwnDomain.lo)} to ${signed(versus.emailOnOwnDomain.hi)}); ` +
                `a self-description on ${percent(base.found.description)} against ${percent(keyword.found.description)}.`
        );
        findings.push(
            `At ${budget} requests, requests that return nothing readable: today ${percent(base.requests.wastedShare)}, link-keyword ${percent(keyword.requests.wastedShare)}, ` +
                `sitemap-first ${percent(at("sitemap-first", budget).requests.wastedShare)} plus ${percent(at("sitemap-first", budget).requests.overheadShare)} spent on robots.txt and sitemap files.`
        );
        findings.push(
            `By group at ${budget} requests, link-keyword against today: ` +
                GROUPS.map(
                    g => `${g.id} ${delta(at("link-keyword", budget, g.id).versusToday!.score)}`
                ).join("; ") +
                "."
        );
    }
    {
        const same = at("link-keyword@today-spend", MAX_BUDGET);
        const complete4 = at("link-keyword", 4, "allLinksRecorded");
        const complete8 = at("link-keyword", 8, "allLinksRecorded");
        findings.push(
            `Never allowed more requests on a site than today makes there (today ${all.meanRequests!.toFixed(1)} per site on average; link-keyword runs out of links sooner on some sites and uses ${same.requests.mean.toFixed(1)}), ` +
                `link-keyword finds ${same.meanScore.mean.toFixed(2)} fact types against today's ${at("today", MAX_BUDGET).meanScore.mean.toFixed(2)} (${delta(same.versusToday!.score)}).`
        );
        findings.push(
            `On the ${complete4.sites} sites where every homepage link was recorded, link-keyword against today is ${delta(complete4.versusToday!.score)} at 4 requests and ${delta(complete8.versusToday!.score)} at 8.`
        );
    }
    findings.push(
        `Against everything today finds with up to 14 requests (${at("today", MAX_BUDGET).meanScore.mean.toFixed(2)} fact types), link-keyword is ` +
            `${delta(at("link-keyword", 2).versusTodayAt14!)} with 2 requests and ${delta(at("link-keyword", 4).versusTodayAt14!)} with 4.`
    );
    const keywordReach = reachTable["link-keyword"].all;
    const todayReach = reachTable.today.all;
    findings.push(
        `To reach the score today ends with, today itself needs ${todayReach.meanRequests.toFixed(1)} requests on average and link-keyword ${keywordReach.meanRequests.toFixed(1)} ` +
            `(a miss within 14 requests counts as 15; link-keyword gets there on ${percent(keywordReach.reachedWithin14)} of sites). ` +
            `At 4 requests link-keyword already equals or beats today's final score on ${percent(at("link-keyword", 4).matchesTodayFinal)} of sites.`
    );
    for (const budget of [2, 4, 8] as const) {
        const curve = learning["learned-links-thompson"]![String(budget)]!;
        const cell = at("learned-links-thompson", budget);
        findings.push(
            `Learning across sites (Thompson sampling, ${SEEDS} site orders) at ${budget} requests: ${cell.meanScore.mean.toFixed(2)} on average, ${delta(cell.versusLinkKeyword!)} against link-keyword over all sites; ` +
                `${signed(curve.versusLinkKeyword.firstThird.mean)} on the first third of sites visited and ${signed(curve.versusLinkKeyword.lastThird.mean)} on the last third ` +
                `(change ${delta(curve.versusLinkKeyword.lastMinusFirst)}, interval over site orders).`
        );
    }
    {
        const learned = learning["learned-links-thompson"]!["4"]!.posteriorMeanByClass;
        const ranked = [...LINK_CLASSES].sort((a, b) => learned[b].mean - learned[a].mean);
        findings.push(
            `Thompson's posterior mean per link class after a pass at 4 requests (chance that a page of the class reveals a new fact type): ` +
                ranked.map(cls => `${cls} ${learned[cls].mean.toFixed(2)}`).join(", ") +
                "."
        );
        const value = sample.linkClasses;
        const byValue = [...LINK_CLASSES].sort(
            (a, b) =>
                value[b]!.addsAFactTypeTheHomepageLacksShare -
                value[a]!.addsAFactTypeTheHomepageLacksShare
        );
        findings.push(
            `Share of recorded links whose page holds a fact type the homepage lacks, by class: ` +
                byValue
                    .map(
                        cls =>
                            `${cls} ${percent(value[cls]!.addsAFactTypeTheHomepageLacksShare)} (${value[cls]!.links} links)`
                    )
                    .join(", ") +
                "."
        );
    }
    findings.push(
        `A usable sitemap was found on ${sample.sitemap.sitesWithUsableSitemap} of ${sites.length} sites (/sitemap.xml itself answered with a sitemap on ${sample.sitemap.sitesWhereSitemapXmlGuessWorked}); ` +
            `sitemap-first pays ${sample.sitemap.meanRequestsBeforeFirstPage.toFixed(1)} requests on average before its first page, ` +
            `finds ${at("sitemap-first", 4).meanScore.mean.toFixed(2)} at 4 requests and ${at("sitemap-first", MAX_BUDGET).meanScore.mean.toFixed(2)} at 14.`
    );
    findings.push(
        `The homepage alone gives ${sample.ceiling.meanHomepageScore.toFixed(2)} of 5 fact types on average and all recorded pages together ${sample.ceiling.meanCeiling.toFixed(2)}; ` +
            `on ${sample.ceiling.sitesWhereHomepageIsAlreadyTheCeiling} of ${sites.length} sites no recorded page adds anything to the homepage.`
    );
    findings.push(
        `Limits: ${sample.homepageLinks.sitesWithMoreThanRecorded} of ${sites.length} homepages had more same-site links than were recorded (the ${MAX_HOMEPAGE_LINKS} best by the keyword prior were); ` +
            `${sample.sitesGivenUpOnWhileRecording} site was given up on while recording; ` +
            `robots.txt removed ${check.disallowedPaths} guessed path(s) on ${check.disallowedSites} site(s) and ${sample.homepageLinks.leftOutByRobots} homepage links; ` +
            `production's 40 s time budget would have cut today short on ${all.sitesWhereThe40sTimeBudgetWouldCutIn} site(s) at the recorded response times; ` +
            `candidates whose homepage could not be read are not in the sample (${GROUPS.map(g => `${g.id}: ${dataset.sample[g.id].screened - dataset.sample[g.id].accepted} of ${dataset.sample[g.id].screened} tried`).join(", ")}).`
    );

    const result = {
        experiment: "e3-what-to-read",
        question:
            "Under the same number of HTTP requests per company, do smarter page-selection policies find more facts than production's guessed URL paths?",
        sample,
        costModel: {
            unit: "one HTTP request, whatever comes back: a page, a 404, a timeout, robots.txt or a sitemap file",
            redirects: "a redirect chain counts as one request",
            homepage: "always request number 1",
            readablePage: `status below 400, at least ${MIN_READABLE_CHARS} characters of readable text, and a final URL not read before in the visit (production's rule)`,
            budgets: [...BUDGETS],
            robots: "a path robots.txt disallows for * was never recorded: no policy asks for it and it costs nothing",
            givenUpSites: `requests never sent because the site failed ${GIVE_UP_AFTER_FAILURES} times in a row while recording count as failed requests`,
        },
        factTypes: {
            counted: [...FACT_TYPES],
            score: "how many of the five types production's extractFacts has found so far (0 to 5); a contact email counts on any domain",
            ceiling: "the score over every recorded page of the site",
        },
        recording: {
            hostsInParallel: HOSTS_IN_PARALLEL,
            maxRequestsPerSite: MAX_FETCHES_PER_SITE,
            maxHomepageLinks: MAX_HOMEPAGE_LINKS,
            maxSitemapPicks: MAX_SITEMAP_PICKS,
            sitemapUrlCap: SITEMAP_URL_CAP,
            guessedPaths: PRODUCTION_EXTRA_PATHS,
            brregNaceCodes: BRREG_CODES,
            brregMinStaff: BRREG_MIN_STAFF,
            openStreetMapCities: PHOTON_CITIES,
        },
        seeds: SEEDS,
        epsilon: EPSILON,
        keywordPrior: priorWeights(),
        todayCheckAgainstProduction: check,
        today,
        guessedPaths,
        policies,
        learning,
        findings,
    };
    mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
    writeFileSync(RESULTS_FILE, `${JSON.stringify(result, null, 2)}\n`);

    // ── compact table ──
    const lines: string[] = [];
    lines.push(
        `e3-what-to-read: ${sites.length} sites (${groupSizes}), ${SEEDS} seeds for random and learned policies`
    );
    lines.push(
        `today vs production's profileFromPages: same requests on ${check.sameRequests}/${check.sites} sites, same facts on ${check.sameFacts}/${check.dossiers} dossiers`
    );
    lines.push("");
    lines.push(
        "mean fact score (0-5) by request budget B, and paired difference against today [95% bootstrap interval]"
    );
    lines.push(
        `${pad("policy", 26)}${BUDGETS.map(b => left(`B=${b}`, 7)).join("")}   ${pad("vs today at B=4", 24)}${pad("vs today at B=8", 24)}`
    );
    for (const policy of POLICIES) {
        const d4 = at(policy, 4).versusToday;
        const d8 = at(policy, 8).versusToday;
        lines.push(
            `${pad(policy, 26)}${BUDGETS.map(b => left(at(policy, b).meanScore.mean.toFixed(2), 7)).join("")}   ${pad(d4 ? delta(d4.score) : "-", 24)}${pad(d8 ? delta(d8.score) : "-", 24)}`
        );
    }
    const shares: Array<[string, (cell: CellReport) => number]> = [
        ["share of sites with a contact email", cell => cell.found.email],
        [
            "share of sites with an email on the site's own domain",
            cell => cell.found.emailOnOwnDomain,
        ],
        ["share of sites with a self-description", cell => cell.found.description],
        [
            "share of requests wasted (nothing readable came back)",
            cell => cell.requests.wastedShare,
        ],
    ];
    for (const [title, pick] of shares) {
        lines.push("");
        lines.push(title);
        for (const policy of POLICIES)
            lines.push(
                `${pad(policy, 26)}${BUDGETS.map(b => left(percent(pick(at(policy, b))), 7)).join("")}`
            );
    }
    for (const budget of [4, 8] as const) {
        lines.push("");
        lines.push(`by group at B=${budget}: mean score, and paired difference against today`);
        lines.push(
            `${pad("policy", 26)}${GROUPS.map(g => pad(`${g.id} (${indicesOf(g.id).length} sites)`, 30)).join("")}`
        );
        for (const policy of POLICIES) {
            const part = (group: GroupId): string => {
                const cell = at(policy, budget, group);
                return pad(
                    `${cell.meanScore.mean.toFixed(2)} ${cell.versusToday ? delta(cell.versusToday.score) : ""}`,
                    30
                );
            };
            lines.push(`${pad(policy, 26)}${GROUPS.map(g => part(g.id)).join("")}`);
        }
    }
    lines.push("");
    lines.push(
        `today's own spend: mean ${all.meanRequests!.toFixed(1)}, median ${all.medianRequests}, max ${all.maxRequests} requests per site; ` +
            `${percent(all.wastedShare!)} wasted; ${all.sitesUsingAll14}/${all.sites} sites use all 14`
    );
    lines.push(
        `requests to reach today's final score (a miss counts as 15): ` +
            POLICIES.map(p => `${p} ${reachTable[p].all.meanRequests.toFixed(1)}`).join(", ")
    );
    lines.push(
        `link-keyword against today's final score (today with up to 14 requests): ` +
            `B=2 ${delta(at("link-keyword", 2).versusTodayAt14!)}, B=4 ${delta(at("link-keyword", 4).versusTodayAt14!)}`
    );
    const complete = at("link-keyword", 4, "allLinksRecorded");
    lines.push(
        `on the ${complete.sites} sites where every homepage link was recorded, link-keyword vs today: ` +
            `B=4 ${delta(complete.versusToday!.score)}, B=8 ${delta(at("link-keyword", 8, "allLinksRecorded").versusToday!.score)}`
    );
    lines.push("");
    lines.push(
        "learned policies against link-keyword: paired difference in mean score over all sites"
    );
    lines.push(`${pad("policy", 26)}${([2, 4, 8] as const).map(b => pad(`B=${b}`, 24)).join("")}`);
    for (const { id } of LEARNED)
        lines.push(
            `${pad(id, 26)}${([2, 4, 8] as const).map(b => pad(delta(at(id, b).versusLinkKeyword!), 24)).join("")}`
        );
    lines.push("");
    lines.push(
        "learning curve: learned minus link-keyword on the first and on the last third of sites visited"
    );
    for (const { id } of LEARNED) {
        const parts = ([2, 4, 8] as const).map(budget => {
            const curve = simulation.learning[id]![budget];
            return `B=${budget}: first ${signed(mean(curve.firstVsKeyword))}, last ${signed(mean(curve.lastVsKeyword))}`;
        });
        lines.push(`${pad(id, 26)}${parts.join("   ")}`);
    }
    lines.push("");
    lines.push("Thompson posterior mean per link class at B=4 (fetches per pass over the sites):");
    lines.push(
        LINK_CLASSES.map(cls => {
            const b = simulation.beliefs["learned-links-thompson"]![4][cls];
            return `${cls} ${b.mean.toFixed(2)} (${b.pulls.toFixed(0)})`;
        }).join(", ")
    );
    lines.push("");
    lines.push(`wrote ${path.relative(process.cwd(), RESULTS_FILE)}`);
    console.log(lines.join("\n"));
}

await main();
