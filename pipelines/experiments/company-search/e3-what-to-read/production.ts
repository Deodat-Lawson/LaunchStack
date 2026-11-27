/**
 * Production's site reader as it is now, replayed on the recording.
 *
 * The experiment's result was built into production: `readSite` in
 * `pipelines/src/distribution/keyless/profile.ts` follows the homepage's own
 * links, chosen by their words, and guesses paths only when there is no link
 * to follow. This runs that code, with its default limits, on every recorded
 * site (a `fetchPage` built on the recorder, production's `dossierFromPages`
 * for the dossier) and reports:
 *  - what it found, beside what the guessed-path reader (`today`) found;
 *  - whether it asked for the URLs the replayed rule (`visitShipped`) asks
 *    for. The rule ranks links with the experiment's own word list and link
 *    parser; production has its own copies of both, so this is a check of
 *    one implementation against the other on real pages. Production is
 *    stricter about which links are login, account, cart or search links;
 *    those it leaves out are counted, and the order of the rest is compared.
 *
 * Two things the recording cannot answer. Production does not read
 * robots.txt, the recorder did: a link robots.txt disallows was never
 * fetched. And at most 25 links per homepage were recorded. A request for
 * either counts as a failed request here, which can only understate what
 * production finds.
 */
import type { ReadablePage } from "@launchstack/tools/web-research";

import {
    DEFAULT_KEYLESS_LIMITS,
    dossierFromPages,
    GUESSED_PATHS,
    KEYLESS_PROFILE_VERSION,
    readSite,
} from "../../../src/distribution/keyless/profile";
import { rankSiteLinks } from "../../../src/distribution/keyless/site-links";
import { hashSeed } from "../lib/rng";
import { bootstrapMean, mean, pairedDifference, round } from "../lib/stats";
import { MAX_BUDGET, summarize, visitLinkKeyword, visitShipped, visitToday } from "./policies";
import {
    FACT,
    FACT_TYPES,
    factCount,
    fetchThrough,
    type FactType,
    type FetchContext,
    type SiteRecord,
} from "./site";
import { GROUPS, type GroupId } from "./sources";
import { countingEvidence, factsInDossier, inputFor } from "./verify";

type Estimate = { mean: number; lo: number; hi: number };

export interface ProductionScope {
    sites: number;
    production: {
        meanScore: Estimate;
        /** Share of sites where the dossier holds the fact type. */
        found: Record<FactType, number>;
        requests: {
            mean: number;
            max: number;
            /** Requests that returned nothing readable. */
            wastedShare: number;
        };
    };
    /** The guessed-path reader, run to its end (up to 14 requests). */
    today: { meanScore: number; email: number; meanRequests: number };
    /** The experiment's `link-keyword` policy at production's request budget. */
    linkKeywordAtSameBudget: { meanScore: number; email: number };
    /** Paired by site: production now minus the guessed-path reader. */
    versusToday: { score: Estimate; email: Estimate };
    versusLinkKeywordAtSameBudget: { score: Estimate };
}

export interface ProductionReport {
    reader: string;
    version: string;
    /** Production's default budget: HTTP requests per site, the homepage included. */
    requestsPerSite: number;
    guessedPaths: string[];
    check: {
        sites: number;
        /** Sites where production asked for exactly the replayed rule's URLs, in its order. */
        sameRequests: number;
        /** Sites where it read as many pages as the replay. */
        samePageCount: number;
        /**
         * Sites where production's link parser and word list put the recorded
         * links it follows in the experiment's order.
         */
        sameRanking: number;
        /**
         * Recorded links the experiment's list would follow and production
         * does not (it is stricter about login, account, cart and search
         * links), and the sites they are on.
         */
        linksLeftOut: number;
        sitesWithLinksLeftOut: number;
        /** Of those links, the ones among the first three the experiment's list would follow. */
        linksLeftOutOfFirstThree: number;
        /** Sites where production's grounding gate let a dossier through. */
        dossiers: number;
        /** Of the sites with the same requests and a dossier, those holding the replay's fact types. */
        sameFacts: number;
        /** Requests for a URL the recording does not hold; they count as failed requests. */
        requestsNotRecorded: number;
        sitesWithRequestsNotRecorded: number;
        /** Sites whose homepage had no link to follow, so paths were guessed. */
        sitesGuessingPaths: number;
        /** Ids of sites that differ from the replayed rule, for debugging. */
        differing: string[];
    };
    byScope: Record<"all" | GroupId, ProductionScope>;
}

interface SiteReading {
    site: SiteRecord;
    requests: number;
    pages: number;
    mask: number;
}

function estimate(interval: { mean: number; lo: number; hi: number }): Estimate {
    return { mean: round(interval.mean), lo: round(interval.lo), hi: round(interval.hi) };
}

function share(values: readonly boolean[]): number {
    return round(mean(values.map(value => (value ? 1 : 0))));
}

/** Run production's reader, as shipped, on every recorded site. */
export async function measureProductionReader(
    ctx: FetchContext,
    sites: readonly SiteRecord[]
): Promise<ProductionReport> {
    const budget = DEFAULT_KEYLESS_LIMITS.maxRequests;
    const check: ProductionReport["check"] = {
        sites: sites.length,
        sameRequests: 0,
        samePageCount: 0,
        sameRanking: 0,
        linksLeftOut: 0,
        sitesWithLinksLeftOut: 0,
        linksLeftOutOfFirstThree: 0,
        dossiers: 0,
        sameFacts: 0,
        requestsNotRecorded: 0,
        sitesWithRequestsNotRecorded: 0,
        sitesGuessingPaths: 0,
        differing: [],
    };
    const readings: SiteReading[] = [];
    for (const site of sites) {
        const asked: string[] = [];
        let notRecorded = 0;
        const fetchPage = async (url: string): Promise<ReadablePage> => {
            asked.push(url);
            const outcome = url === site.homeUrl ? site.home : site.pages.get(url);
            if (!outcome) {
                notRecorded += 1;
                throw new Error("not in the recording");
            }
            if (outcome.failure === "abandoned")
                throw new Error("never sent: the site was given up on while recording");
            const fetched = await fetchThrough(ctx, url);
            if (!fetched.ok) throw new Error(fetched.code);
            return fetched.page;
        };
        const input = inputFor(site);
        const read = await readSite({ fetchPage }, input);
        const result = await dossierFromPages(
            { recordEvidence: countingEvidence() },
            input,
            read.pages
        );
        const mask = factsInDossier(result);

        // Which links production follows is its own rule; their order is checked
        // against the experiment's, over every recorded link and not only the first few.
        const production = read.pages[0] ? rankSiteLinks(read.pages[0]) : [];
        const followed = new Set(production.map(link => link.url));
        const recorded = new Set(site.links.map(link => link.url));
        const usable = site.links.filter(link => link.score >= 0);
        const expected = usable.filter(link => followed.has(link.url));
        const ranked = production.filter(link => recorded.has(link.url));
        const sameRanking =
            ranked.length === expected.length &&
            ranked.every((link, i) => link.url === expected[i]!.url);
        if (sameRanking) check.sameRanking += 1;
        check.linksLeftOut += usable.length - expected.length;
        if (usable.length > expected.length) check.sitesWithLinksLeftOut += 1;
        check.linksLeftOutOfFirstThree += usable
            .slice(0, 3)
            .filter(link => !followed.has(link.url)).length;

        const replay = visitShipped(site, budget, GUESSED_PATHS, url => followed.has(url));
        const sameRequests =
            asked.length === replay.asked.length &&
            asked.every((url, i) => url === replay.asked[i]);
        const samePageCount = read.pages.length === replay.pages;
        if (sameRequests) check.sameRequests += 1;
        if (samePageCount) check.samePageCount += 1;
        if (mask !== null) check.dossiers += 1;
        const sameFacts = !sameRequests || mask === null || mask === replay.mask;
        if (sameRequests && mask !== null && sameFacts) check.sameFacts += 1;
        check.requestsNotRecorded += notRecorded;
        if (notRecorded > 0) check.sitesWithRequestsNotRecorded += 1;
        if (read.guessed) check.sitesGuessingPaths += 1;
        if (!sameRequests || !samePageCount || !sameFacts || !sameRanking)
            check.differing.push(site.id);

        readings.push({
            site,
            requests: asked.length,
            pages: read.pages.length,
            mask: mask ?? 0,
        });
    }

    const scope = (id: "all" | GroupId): ProductionScope => {
        const members = readings.filter(r => id === "all" || r.site.group === id);
        const scores = members.map(r => factCount(r.mask));
        const emails = members.map(r => (r.mask & FACT.email ? 1 : 0));
        const requests = members.reduce((sum, r) => sum + r.requests, 0);
        const wasted = members.reduce((sum, r) => sum + (r.requests - r.pages), 0);
        const today = members.map(r => summarize(visitToday(r.site, MAX_BUDGET).steps, MAX_BUDGET));
        const keyword = members.map(r =>
            summarize(visitLinkKeyword(r.site, MAX_BUDGET).steps, budget)
        );
        const seed = (label: string): { seed: number } => ({
            seed: hashSeed(`e3:production:${id}:${label}`),
        });
        return {
            sites: members.length,
            production: {
                meanScore: estimate(bootstrapMean(scores, seed("score"))),
                found: Object.fromEntries(
                    FACT_TYPES.map(type => [
                        type,
                        share(members.map(r => (r.mask & FACT[type]) !== 0)),
                    ])
                ) as Record<FactType, number>,
                requests: {
                    mean: round(requests / Math.max(1, members.length)),
                    max: Math.max(0, ...members.map(r => r.requests)),
                    wastedShare: requests === 0 ? 0 : round(wasted / requests),
                },
            },
            today: {
                meanScore: round(mean(today.map(t => t.score))),
                email: share(today.map(t => (t.mask & FACT.email) !== 0)),
                meanRequests: round(mean(today.map(t => t.requests))),
            },
            linkKeywordAtSameBudget: {
                meanScore: round(mean(keyword.map(k => k.score))),
                email: share(keyword.map(k => (k.mask & FACT.email) !== 0)),
            },
            versusToday: {
                score: estimate(
                    pairedDifference(
                        scores,
                        today.map(t => t.score),
                        seed("vs-today")
                    )
                ),
                email: estimate(
                    pairedDifference(
                        emails,
                        today.map(t => (t.mask & FACT.email ? 1 : 0)),
                        seed("vs-today-email")
                    )
                ),
            },
            versusLinkKeywordAtSameBudget: {
                score: estimate(
                    pairedDifference(
                        scores,
                        keyword.map(k => k.score),
                        seed("vs-keyword")
                    )
                ),
            },
        };
    };

    return {
        reader: "readSite and dossierFromPages (the two halves of profileFromPages) in pipelines/src/distribution/keyless/profile.ts, with their default limits",
        version: KEYLESS_PROFILE_VERSION,
        requestsPerSite: budget,
        guessedPaths: [...GUESSED_PATHS],
        check,
        byScope: {
            all: scope("all"),
            ...(Object.fromEntries(GROUPS.map(group => [group.id, scope(group.id)])) as Record<
                GroupId,
                ProductionScope
            >),
        },
    };
}

function pad(text: string, width: number): string {
    return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function signed(value: number): string {
    return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`;
}

function percent(value: number): string {
    return `${(100 * value).toFixed(0)}%`;
}

/** The short table: production now, beside the guessed-path reader. */
export function productionTable(report: ProductionReport): string[] {
    const lines: string[] = [];
    lines.push(
        `production's reader now (${report.version}): the homepage's links by their words, ${report.requestsPerSite} requests a site, replayed on the recording`
    );
    lines.push(
        `${pad("", 8)}${pad("sites", 7)}${pad("now: requests", 15)}${pad("wasted", 8)}${pad("fact types", 12)}${pad("email", 8)}` +
            `${pad("before: requests", 18)}${pad("fact types", 12)}${pad("email", 8)}fact types, now − before [95% interval]`
    );
    for (const [id, scope] of Object.entries(report.byScope)) {
        const now = scope.production;
        const d = scope.versusToday.score;
        lines.push(
            `${pad(id, 8)}${pad(String(scope.sites), 7)}${pad(now.requests.mean.toFixed(1), 15)}${pad(percent(now.requests.wastedShare), 8)}` +
                `${pad(now.meanScore.mean.toFixed(2), 12)}${pad(percent(now.found.email), 8)}` +
                `${pad(scope.today.meanRequests.toFixed(1), 18)}${pad(scope.today.meanScore.toFixed(2), 12)}${pad(percent(scope.today.email), 8)}` +
                `${signed(d.mean)} [${signed(d.lo)}, ${signed(d.hi)}]`
        );
    }
    const check = report.check;
    lines.push(
        `the recorded links production follows are in the experiment's order on ${check.sameRanking}/${check.sites} homepages ` +
            `(${check.linksLeftOut} link(s) on ${check.sitesWithLinksLeftOut} site(s) left out as login, account, cart or search links); ` +
            `same requests as the replayed rule on ${check.sameRequests}/${check.sites} sites, and the same fact types in the dossier on ${check.sameFacts} of those; ` +
            `${check.requestsNotRecorded} request(s) on ${check.sitesWithRequestsNotRecorded} site(s) went to a link the recording does not hold and count as failed; ` +
            `paths were guessed on ${check.sitesGuessingPaths} site(s); at most ${report.byScope.all.production.requests.max} requests on any site`
    );
    return lines;
}
