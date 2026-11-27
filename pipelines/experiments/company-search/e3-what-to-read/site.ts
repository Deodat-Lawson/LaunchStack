/**
 * One site, as the experiment records it: robots.txt, the homepage, a
 * sitemap, the 13 paths production guessed at the time and the best of the
 * homepage's own links. Every fetch goes through production's `fetchReadable` on top of the
 * recorder, so redirects and the readable-text conversion are production's,
 * and the same code replays offline from the cache.
 *
 * Nothing here keeps page text, email addresses or names: a page is reduced
 * to which fact types production's `extractFacts` found on it.
 */
import { createHash } from "node:crypto";

import { fetchReadable, type ReadablePage } from "@launchstack/tools/web-research";

import { extractFacts } from "../../../src/distribution/keyless/profile";
import { NotRecordedError, type Recorder } from "../lib/recorder";
import {
    ALLOW_ALL,
    bareHost,
    extractLinks,
    parseRobots,
    parseSitemap,
    sameSite,
    urlKey,
    type ParsedSitemap,
    type Robots,
} from "./html";
import { pathSegments, scoreLink, type LinkClass } from "./prior";
import { isHubHost, type Candidate, type GroupId } from "./sources";

/**
 * The paths production guessed when the experiment ran, in the order it tried
 * them (`pipelines/src/distribution/keyless/profile.ts` at commit 968724695).
 * Production guesses only as a fallback now, and in another order; this is
 * the list the recording was made with and the `today` policy replays.
 */
export const PRODUCTION_EXTRA_PATHS = [
    "/about",
    "/about-us",
    "/over-ons",
    "/ueber-uns",
    "/unternehmen",
    "/contact",
    "/contact-us",
    "/kontakt",
    "/impressum",
    "/careers",
    "/jobs",
    "/vacatures",
    "/karriere",
];

/** Production's "readable": status below 400 and at least this much text. */
export const MIN_READABLE_CHARS = 120;
/** Production's per-page timeout in keyless mode (also the recorder's per-request timeout). */
export const PAGE_TIMEOUT_MS = 10_000;

export const MAX_FETCHES_PER_SITE = 45;
export const MAX_HOMEPAGE_LINKS = 25;
export const MAX_SITEMAP_PICKS = 6;
export const SITEMAP_URL_CAP = 200;
export const GIVE_UP_AFTER_FAILURES = 3;

/** The five fact types, as bits. */
export const FACT = { email: 1, description: 2, staff: 4, certification: 8, role: 16 } as const;
export const FACT_TYPES = ["email", "description", "staff", "certification", "role"] as const;
export type FactType = (typeof FACT_TYPES)[number];

export function factCount(mask: number): number {
    let count = 0;
    for (const type of FACT_TYPES) if (mask & FACT[type]) count += 1;
    return count;
}

export interface PageOutcome {
    /** The URL as requested. */
    url: string;
    requestKey: string;
    /** Production's key of the URL that answered; null when nothing answered. */
    finalKey: string | null;
    /** HTTP status of the final response; 0 when the request failed. */
    status: number;
    /** "error": the request threw. "abandoned": never sent, the site was given up on. */
    failure: "none" | "error" | "abandoned";
    /** Production's test: status below 400 and at least 120 characters of text. */
    readable: boolean;
    /** Fact types production's extractFacts finds on the page (bits of FACT). */
    facts: number;
    /** An email address on the site's own domain is among them. */
    ownEmail: boolean;
    /** Hash of the page text, to spot the same text served under two URLs. */
    textHash: string | null;
    /** How long the request took when it was recorded, redirect hops included (0 if unknown). */
    ms: number;
}

export interface PoolLink {
    url: string;
    key: string;
    cls: LinkClass;
    score: number;
    /** Position among the homepage's same-site links. */
    order: number;
}

export type OverheadKind = "sitemap-guess" | "robots" | "sitemap-declared" | "sitemap-child";

export interface SiteRecord {
    id: string;
    group: GroupId;
    country: string;
    stratum: string;
    homeUrl: string;
    /** The homepage; always readable (that is what puts a site in the sample). */
    home: PageOutcome;
    /** Production's guessed URLs in production's order; `allowed` is robots.txt's verdict. */
    guessed: Array<{ path: string; url: string; allowed: boolean }>;
    /** The homepage's links the policies choose from, best prior score first. */
    links: PoolLink[];
    linkStats: {
        /** Distinct same-site links on the homepage. */
        found: number;
        /** Left out because robots.txt disallows them. */
        disallowed: number;
        /** Left out because more than the cap were found, or the request cap was reached. */
        notRecorded: number;
    };
    sitemap: {
        /** What a sitemap-first policy pays before its first page, in order. */
        overhead: Array<{ kind: OverheadKind; useful: boolean }>;
        usable: boolean;
        /** URLs in the sitemap file (capped). */
        urls: number;
        /** Its best URLs by the keyword prior (path only), best first. */
        picks: string[];
    };
    /** Outcome of every page request a policy can make, by requested URL. */
    pages: Map<string, PageOutcome>;
    /** True when recording stopped early after consecutive failures. */
    abandoned: boolean;
    /** Requests recorded for this site (a redirect chain counts once). */
    fetches: number;
    /** HTTP exchanges behind them, redirect hops included. */
    exchanges: number;
    robotsRules: number;
}

export type RejectReason =
    | "unreachable"
    | "robots-error"
    | "robots-disallow"
    | "home-error"
    | "home-blocked"
    | "home-http-error"
    | "home-thin"
    | "home-offsite";

export type CollectResult =
    | {
          accepted: true;
          finalHost: string;
          site: SiteRecord | null;
          fetches: number;
          exchanges: number;
      }
    | { accepted: false; reason: RejectReason; fetches: number; exchanges: number };

export interface FetchContext {
    recorder: Recorder;
    /**
     * Requests that threw while recording, by URL. A DNS failure never reaches
     * the recorder, so it is kept here and replays as the same failure.
     */
    errors: Record<string, string>;
}

type Fetched = { ok: true; page: ReadablePage } | { ok: false; code: string };

/** Replay never asks DNS; any public address passes production's SSRF check. */
const REPLAY_LOOKUP = (): Promise<string[]> => Promise.resolve(["93.184.216.34"]);

function errorCode(error: unknown): string {
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === "string" && /^[a-z_]+$/.test(code)) return code;
    const message = error instanceof Error ? error.message : String(error);
    return /abort|timed? ?out/i.test(message) ? "timeout" : "network";
}

/** One request, the way production's keyless mode makes it. */
export async function fetchThrough(ctx: FetchContext, url: string): Promise<Fetched> {
    const known = ctx.errors[url];
    if (known !== undefined) return { ok: false, code: known };
    try {
        const page = await fetchReadable(url, {
            timeoutMs: PAGE_TIMEOUT_MS,
            fetchImpl: ctx.recorder.fetchImpl,
            // Recording keeps production's real lookup: it is the SSRF guard.
            ...(ctx.recorder.mode === "replay" ? { lookup: REPLAY_LOOKUP } : {}),
        });
        return { ok: true, page };
    } catch (error) {
        // Replaying something that was never recorded is a bug, not a failed page.
        if (error instanceof NotRecordedError) throw error;
        const code = errorCode(error);
        if (ctx.recorder.mode === "record") ctx.errors[url] = code;
        return { ok: false, code };
    }
}

/** The HTTP exchanges behind one request (the redirect hops production followed) and their time. */
function exchangesBehind(recorder: Recorder, url: string): { count: number; ms: number } {
    let current = url;
    let count = 0;
    let ms = 0;
    for (let hop = 0; hop < 5; hop++) {
        const exchange = recorder.lookup(current);
        if (!exchange) break;
        count += 1;
        ms += exchange.ms;
        const location = exchange.headers.location;
        if (exchange.status < 300 || exchange.status >= 400 || !location) break;
        try {
            current = new URL(location, current).toString();
        } catch {
            break;
        }
    }
    return { count, ms };
}

function rawBody(recorder: Recorder, page: ReadablePage): string {
    return recorder.lookup(page.finalUrl)?.body ?? "";
}

function isReadable(page: ReadablePage): boolean {
    return page.status < 400 && page.text.trim().length >= MIN_READABLE_CHARS;
}

function ownDomain(email: string, hosts: readonly string[]): boolean {
    const domain = email.split("@")[1]?.toLowerCase() ?? "";
    if (!domain.includes(".")) return false;
    return hosts.some(host => {
        const bare = bareHost(host);
        return domain === bare || domain.endsWith(`.${bare}`) || bare.endsWith(`.${domain}`);
    });
}

function outcomeOf(
    url: string,
    fetched: Fetched,
    ms: number,
    orgName: string,
    hosts: readonly string[]
): PageOutcome {
    const requestKey = urlKey(url);
    if (!fetched.ok) {
        return {
            url,
            requestKey,
            finalKey: null,
            status: 0,
            failure: "error",
            readable: false,
            facts: 0,
            ownEmail: false,
            textHash: null,
            ms,
        };
    }
    const page = fetched.page;
    const readable = isReadable(page);
    let facts = 0;
    let ownEmail = false;
    let textHash: string | null = null;
    if (readable) {
        const found = extractFacts(page, orgName);
        if (found.emails.length > 0) facts |= FACT.email;
        if (found.description !== null) facts |= FACT.description;
        if (found.staff !== null) facts |= FACT.staff;
        if (found.certifications.length > 0) facts |= FACT.certification;
        if (found.roles.length > 0) facts |= FACT.role;
        ownEmail = found.emails.some(email => ownDomain(email, hosts));
        textHash = createHash("sha1")
            .update(page.text.replace(/\s+/g, " ").trim())
            .digest("hex")
            .slice(0, 16);
    }
    return {
        url,
        requestKey,
        finalKey: urlKey(page.finalUrl),
        status: page.status,
        failure: "none",
        readable,
        facts,
        ownEmail,
        textHash,
        ms,
    };
}

function abandonedOutcome(url: string): PageOutcome {
    return {
        url,
        requestKey: urlKey(url),
        finalKey: null,
        status: 0,
        failure: "abandoned",
        readable: false,
        facts: 0,
        ownEmail: false,
        textHash: null,
        ms: 0,
    };
}

/** A response that says the site is refusing or failing, not just missing a page. */
function isFailure(fetched: Fetched): boolean {
    if (!fetched.ok) return true;
    const status = fetched.page.status;
    return status === 401 || status === 403 || status === 429 || status >= 500;
}

const FILE_LIKE = /\.(pdf|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|pptx?|xml|json|css|js|txt)$/i;

/** The sitemap's best URLs by the keyword prior on the path, best first. */
function sitemapPicks(locs: readonly string[], home: URL, robots: Robots): string[] {
    const homeKey = urlKey(home.href);
    const seen = new Set<string>();
    const scored: Array<{ url: string; score: number; depth: number; index: number }> = [];
    for (const [index, loc] of locs.entries()) {
        let target: URL;
        try {
            target = new URL(loc);
        } catch {
            continue;
        }
        if (!sameSite(target.hostname, home.hostname)) continue;
        target.protocol = home.protocol;
        target.hostname = home.hostname;
        target.port = home.port;
        target.hash = "";
        if (FILE_LIKE.test(target.pathname)) continue;
        const key = urlKey(target.href);
        if (key === homeKey || seen.has(key)) continue;
        seen.add(key);
        if (!robots.allows(target.href)) continue;
        const { score } = scoreLink("", target.href);
        if (score <= 0) continue;
        scored.push({ url: target.href, score, depth: pathSegments(target.href).length, index });
    }
    scored.sort(
        (a, b) =>
            b.score - a.score ||
            a.depth - b.depth ||
            a.url.length - b.url.length ||
            a.index - b.index
    );
    return scored.slice(0, MAX_SITEMAP_PICKS).map(item => item.url);
}

/** a1, b1, a2, b2, … then whatever is left of the longer list. */
function interleave<T>(a: readonly T[], b: readonly T[]): T[] {
    const out: T[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i];
        const y = b[i];
        if (x !== undefined) out.push(x);
        if (y !== undefined) out.push(y);
    }
    return out;
}

/**
 * Record (or replay) one candidate. "screen" stops after the homepage and
 * says whether the site belongs in the sample; "full" records everything.
 */
export async function collectSite(
    ctx: FetchContext,
    candidate: Candidate,
    id: string,
    mode: "screen" | "full"
): Promise<CollectResult> {
    let fetches = 0;
    let exchanges = 0;
    const took = new Map<string, number>();
    const get = async (url: string): Promise<Fetched> => {
        const fetched = await fetchThrough(ctx, url);
        const behind = exchangesBehind(ctx.recorder, url);
        fetches += 1;
        exchanges += behind.count;
        took.set(url, behind.ms);
        return fetched;
    };
    const reject = (reason: RejectReason): CollectResult => ({
        accepted: false,
        reason,
        fetches,
        exchanges,
    });

    // 1. robots.txt of the listed host.
    const listedOrigin = `https://${candidate.host}`;
    const robotsFetch = await get(`${listedOrigin}/robots.txt`);
    if (!robotsFetch.ok) return reject("unreachable");
    if (robotsFetch.page.status >= 500) return reject("robots-error");
    let robots: Robots =
        robotsFetch.page.status < 300
            ? parseRobots(rawBody(ctx.recorder, robotsFetch.page))
            : ALLOW_ALL;
    let robotsOrigin = new URL(robotsFetch.page.finalUrl).origin;

    // 2. The homepage, as production asks for it: https://<domain>/.
    const homeUrl = `${listedOrigin}/`;
    if (!robots.allows(homeUrl)) return reject("robots-disallow");
    const homeFetch = await get(homeUrl);
    if (!homeFetch.ok) return reject("home-error");
    const homePage = homeFetch.page;
    if (homePage.status === 401 || homePage.status === 403 || homePage.status === 429)
        return reject("home-blocked");
    if (homePage.status >= 400) return reject("home-http-error");
    if (!isReadable(homePage)) return reject("home-thin");
    const homeFinal = new URL(homePage.finalUrl);
    if (isHubHost(homeFinal.hostname)) return reject("home-offsite");

    // The rules that count are those of the origin that answered.
    if (homeFinal.origin !== robotsOrigin) {
        const second = await get(`${homeFinal.origin}/robots.txt`);
        if (!second.ok || second.page.status >= 500) return reject("robots-error");
        robots =
            second.page.status < 300 ? parseRobots(rawBody(ctx.recorder, second.page)) : ALLOW_ALL;
        robotsOrigin = homeFinal.origin;
        if (!robots.allows(homePage.finalUrl)) return reject("robots-disallow");
    }
    const finalHost = bareHost(homeFinal.hostname);
    if (mode === "screen") return { accepted: true, finalHost, site: null, fetches, exchanges };

    const hosts = [candidate.host, homeFinal.hostname];
    const home = outcomeOf(homeUrl, homeFetch, took.get(homeUrl) ?? 0, candidate.name, hosts);

    // 3. The sitemap, the way a sitemap-first policy would find it: guess
    //    /sitemap.xml, and only when that fails pay for robots.txt and follow
    //    its first Sitemap line. An index costs one more request for one child.
    const overhead: SiteRecord["sitemap"]["overhead"] = [];
    const readSitemap = async (url: string): Promise<ParsedSitemap | null> => {
        let target: URL;
        try {
            target = new URL(url);
        } catch {
            return null;
        }
        if (!sameSite(target.hostname, homeFinal.hostname) || !robots.allows(url)) return null;
        const fetched = await get(url);
        if (!fetched.ok || fetched.page.status >= 400) return { kind: "none", locs: [], total: 0 };
        return parseSitemap(rawBody(ctx.recorder, fetched.page), SITEMAP_URL_CAP);
    };
    const guessUrl = `${homeFinal.origin}/sitemap.xml`;
    let sitemap = await readSitemap(guessUrl);
    if (sitemap) overhead.push({ kind: "sitemap-guess", useful: sitemap.kind !== "none" });
    if (!sitemap || sitemap.kind === "none") {
        const declared = robots.sitemaps.find(url => urlKey(url) !== urlKey(guessUrl));
        overhead.push({ kind: "robots", useful: declared !== undefined });
        if (declared !== undefined) {
            const second = await readSitemap(declared);
            if (second) {
                overhead.push({ kind: "sitemap-declared", useful: second.kind !== "none" });
                sitemap = second;
            }
        }
    }
    if (sitemap?.kind === "index") {
        // A WordPress-style index lists a "page" sitemap next to posts and products.
        const child =
            sitemap.locs.find(loc => /page/i.test(loc.replace(/^https?:\/\/[^/]+/i, ""))) ??
            sitemap.locs[0];
        const childMap = child !== undefined ? await readSitemap(child) : null;
        if (childMap) {
            overhead.push({ kind: "sitemap-child", useful: childMap.kind === "urlset" });
            sitemap = childMap;
        } else {
            sitemap = null;
        }
    }
    const sitemapUsable = sitemap?.kind === "urlset" && sitemap.locs.length > 0;
    const picks = sitemapUsable && sitemap ? sitemapPicks(sitemap.locs, homeFinal, robots) : [];

    // 4. Production's guessed paths, resolved against the homepage that answered.
    const guessed = PRODUCTION_EXTRA_PATHS.map(path => {
        const url = new URL(path, homePage.finalUrl).href;
        return { path, url, allowed: robots.allows(url) };
    });

    // 5. The homepage's own links, best prior score first.
    const found = extractLinks(rawBody(ctx.recorder, homePage), homePage.finalUrl);
    const homeKeys = new Set([home.requestKey, home.finalKey ?? home.requestKey]);
    const ranked: PoolLink[] = [];
    let disallowed = 0;
    let distinct = 0;
    for (const link of found) {
        if (homeKeys.has(link.key)) continue;
        distinct += 1;
        if (!robots.allows(link.url)) {
            disallowed += 1;
            continue;
        }
        let best = scoreLink("", link.url);
        for (const anchor of link.anchors) {
            const scored = scoreLink(anchor, link.url);
            if (scored.score > best.score) best = scored;
        }
        ranked.push({
            url: link.url,
            key: link.key,
            cls: best.cls,
            score: best.score,
            order: link.order,
        });
    }
    ranked.sort((a, b) => b.score - a.score || a.order - b.order);

    // 6. What fits under the per-site cap: guessed paths first, then the
    //    sitemap's picks, then as many links as are left (at most 25).
    const planned = new Set<string>();
    const guessedQueue: string[] = [];
    for (const guess of guessed) {
        if (!guess.allowed || planned.has(guess.url)) continue;
        planned.add(guess.url);
        guessedQueue.push(guess.url);
    }
    const pickQueue: string[] = [];
    for (const url of picks) {
        if (planned.has(url)) continue;
        planned.add(url);
        pickQueue.push(url);
    }
    const links: PoolLink[] = [];
    const linkQueue: string[] = [];
    for (const link of ranked) {
        if (links.length >= MAX_HOMEPAGE_LINKS) break;
        if (!planned.has(link.url)) {
            if (fetches + planned.size >= MAX_FETCHES_PER_SITE) break;
            planned.add(link.url);
            linkQueue.push(link.url);
        }
        links.push(link);
    }

    // 7. Fetch, guessed paths and links in turn, so three failures in a row
    //    mean the site is failing and not just that guessed paths do not exist.
    const order = interleave(guessedQueue, [
        ...linkQueue.slice(0, 8),
        ...pickQueue,
        ...linkQueue.slice(8),
    ]);
    const pages = new Map<string, PageOutcome>();
    let consecutive = 0;
    let abandoned = false;
    for (const url of order) {
        if (abandoned) {
            pages.set(url, abandonedOutcome(url));
            continue;
        }
        const fetched = await get(url);
        pages.set(url, outcomeOf(url, fetched, took.get(url) ?? 0, candidate.name, hosts));
        consecutive = isFailure(fetched) ? consecutive + 1 : 0;
        if (consecutive >= GIVE_UP_AFTER_FAILURES) abandoned = true;
    }

    const site: SiteRecord = {
        id,
        group: candidate.group,
        country: candidate.country,
        stratum: candidate.stratum,
        homeUrl,
        home,
        guessed,
        links,
        linkStats: { found: distinct, disallowed, notRecorded: ranked.length - links.length },
        sitemap: {
            overhead,
            usable: sitemapUsable,
            urls: sitemapUsable && sitemap ? sitemap.locs.length : 0,
            picks,
        },
        pages,
        abandoned,
        fetches,
        exchanges,
        robotsRules: robots.rules,
    };
    return { accepted: true, finalHost, site, fetches, exchanges };
}
