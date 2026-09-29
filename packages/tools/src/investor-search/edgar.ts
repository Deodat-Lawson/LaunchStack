/**
 * SEC EDGAR, keyless: full-text search over Form D filings, then each fund's
 * own Form D for the people and the numbers.
 *
 * The search index answers "which venture funds filed in this window, in this
 * state, with these words" but only carries names and places; the filing's
 * primary document carries the managers, phone, target size and amount
 * closed. SEC asks for a declared User-Agent and at most ten requests a
 * second, so every request here goes through one shared pacer.
 */
import type { FundManager, FundProfile, InvestorSearchQuery, InvestorSearchResult } from "./types";

export const EDGAR_SEARCH_URL = "https://efts.sec.gov/LATEST/search-index";
const ARCHIVES = "https://www.sec.gov/Archives/edgar/data";

/** Form D's own words for the fund type; they appear only in fund filings. */
const VENTURE_PHRASE = '"Venture Capital Fund"';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 40;
/** Nine a second: under SEC's ten, with room for a neighbour's request. */
const MIN_GAP_MS = 110;
const DETAIL_CONCURRENCY = 4;
/** EFTS answers a hundred hits a page and has no sort, so read a few pages. */
const PAGE_SIZE = 100;
const MAX_PAGES = 3;
/** EFTS returns the odd 500 that succeeds on a second try. */
const RETRIES = 2;
const RETRY_DELAY_MS = 400;

/** One search hit: a filing, before its document is read. */
export interface FilingHit {
    cik: string;
    name: string;
    location?: string;
    state?: string;
    filedAt: string;
    form: string;
    /** Accession number, "0002129288-26-000002". */
    accession: string;
}

// ── Query ───────────────────────────────────────────────────────────

/** The words someone typed, as search terms: commas separate, quotes keep phrases. */
export function keywordTerms(keywords: readonly string[] = []): string[] {
    const terms = keywords
        .flatMap(k => k.split(","))
        .map(k =>
            k
                .replace(/["()\\:]/g, " ")
                .replace(/\s+/g, " ")
                .trim()
        )
        .filter(k => k.length >= 2)
        // "OR" and "AND" typed as words would become operators.
        .filter(k => !/^(or|and|not)$/i.test(k));
    return [...new Set(terms.map(t => t.toLowerCase()))].map(t => (t.includes(" ") ? `"${t}"` : t));
}

function isoDay(date: Date): string {
    return date.toISOString().slice(0, 10);
}

export function buildSearchUrl(query: InvestorSearchQuery, now = new Date(), from = 0): string {
    const terms = keywordTerms(query.keywords);
    const q = terms.length > 0 ? `${VENTURE_PHRASE} (${terms.join(" OR ")})` : VENTURE_PHRASE;
    const yearAgo = new Date(now);
    yearAgo.setUTCFullYear(now.getUTCFullYear() - 1);
    const params = new URLSearchParams({
        q,
        forms: "D",
        dateRange: "custom",
        startdt: query.since?.slice(0, 10) ?? isoDay(yearAgo),
        enddt: query.until?.slice(0, 10) ?? isoDay(now),
    });
    const state = query.state?.trim().toUpperCase();
    if (state && /^[A-Z0-9]{2}$/.test(state)) params.set("locationCodes", state);
    if (from > 0) params.set("from", String(from));
    return `${EDGAR_SEARCH_URL}?${params.toString()}`;
}

// ── Search response ─────────────────────────────────────────────────

interface SearchSource {
    ciks?: string[];
    display_names?: string[];
    biz_locations?: string[];
    biz_states?: string[];
    file_date?: string;
    form?: string;
    adsh?: string;
}

/** "DCVC Energy & Climate II, L.P.  (CIK 0002129288)" → the name alone. */
export function displayName(raw: string): string {
    return raw.replace(/\s*\(CIK\s*\d+\)\s*$/i, "").trim();
}

export function parseSearchResponse(json: unknown): { total: number; hits: FilingHit[] } {
    const body = json as {
        hits?: {
            total?: { value?: number };
            hits?: Array<{ _id?: string; _source?: SearchSource }>;
        };
    };
    const hits: FilingHit[] = [];
    for (const raw of body.hits?.hits ?? []) {
        const s = raw._source ?? {};
        const cik = s.ciks?.[0];
        const accession = s.adsh ?? raw._id?.split(":")[0];
        const name = s.display_names?.[0];
        if (!cik || !accession || !name || !s.file_date) continue;
        hits.push({
            cik,
            name: displayName(name),
            location: s.biz_locations?.find(Boolean),
            state: s.biz_states?.find(Boolean),
            filedAt: s.file_date,
            form: s.form ?? "D",
            accession,
        });
    }
    return { total: body.hits?.total?.value ?? hits.length, hits };
}

/**
 * A vehicle for one deal rather than a fund, by the names syndicates file
 * under: "GVP Climate Series SPV LP - Zanskar", "Fund 12, a series of Acme
 * LLC", "IV Angels LLC - Series 6952", "922 Capital Fund LLC Series Z39",
 * "Garage Syndicate Venture LLC", "Beillion Capital LLC Project Grid",
 * "Acme Co-Invest LP". "Series Seed Partners" is a fund and is kept: a
 * series is only a vehicle when it is numbered or set off by a dash.
 */
const VEHICLE_PATTERNS = [
    /\bSPV\b/i,
    /\ba series of\b/i,
    /\bseries\s+[a-z]*\d[\w-]*/i,
    /\s[-–]\s.*\bseries\b|\bseries\b.*\s[-–]\s/i,
    /\bco-?invest/i,
    /\bsyndicate\b/i,
    /\bLLC\s+project\b/i,
];

export function isSingleDealVehicle(name: string): boolean {
    return VEHICLE_PATTERNS.some(re => re.test(name));
}

/** One row per fund — its latest filing — newest first. */
export function latestPerFund(hits: readonly FilingHit[]): FilingHit[] {
    const byFund = new Map<string, FilingHit>();
    for (const hit of hits) {
        const seen = byFund.get(hit.cik);
        if (!seen || hit.filedAt > seen.filedAt) byFund.set(hit.cik, hit);
    }
    return [...byFund.values()].sort(
        (a, b) => b.filedAt.localeCompare(a.filedAt) || a.name.localeCompare(b.name)
    );
}

function filingFolder(hit: Pick<FilingHit, "cik" | "accession">): string {
    return `${ARCHIVES}/${Number(hit.cik)}/${hit.accession.replace(/-/g, "")}`;
}

export function documentUrl(hit: Pick<FilingHit, "cik" | "accession">): string {
    return `${filingFolder(hit)}/primary_doc.xml`;
}

/** SEC's own rendering of the form — what a person should open. */
export function filingUrl(hit: Pick<FilingHit, "cik" | "accession">): string {
    return `${filingFolder(hit)}/xslFormDX01/primary_doc.xml`;
}

// ── Form D ──────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
};

function decode(text: string): string {
    return text
        .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENTITIES[e] ?? "")
        .trim();
}

function blocks(xml: string, tag: string): string[] {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
    return [...xml.matchAll(re)].map(m => m[1] ?? "");
}

function tag(xml: string, name: string): string | undefined {
    const value = blocks(xml, name)[0];
    return value === undefined ? undefined : decode(value) || undefined;
}

function amount(xml: string, name: string): number | undefined {
    const raw = tag(xml, name);
    if (raw === undefined) return undefined;
    const n = Number(raw.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : undefined;
}

/** What a Form D says about the fund and the people who run it. */
export type FormDDetails = Pick<
    FundProfile,
    | "phone"
    | "fundType"
    | "offeringAmount"
    | "amountSold"
    | "minimumInvestment"
    | "investorCount"
    | "firstSale"
    | "managers"
>;

const ORGANISATION_SUFFIX =
    /(\bL\.?P\.?|\bL\.?L\.?C\.?|\bLtd\.?|\bLimited|\bInc\.?|\bCorp(oration)?\.?|\bGP|\bGmbH|\bS\.?[aà]\.?r\.?l\.?|\bB\.?V\.?)\s*$/i;
const PLACEHOLDER = /^(n\/?a|none|not applicable|-+|\.)$/i;

/** One related person, told apart from a general partner filed in the same fields. */
export function relatedPerson(
    first?: string,
    middle?: string,
    last?: string
): Omit<FundManager, "roles" | "title"> {
    const given = first && !PLACEHOLDER.test(first) ? first : undefined;
    if (last && (ORGANISATION_SUFFIX.test(last) || !given)) return { name: last, kind: "entity" };
    return { name: [given, middle, last].filter(Boolean).join(" "), kind: "person" };
}

export function parseFormD(xml: string): FormDDetails {
    const managers: FundManager[] = blocks(xml, "relatedPersonInfo").map(person => ({
        ...relatedPerson(
            tag(person, "firstName"),
            tag(person, "middleName"),
            tag(person, "lastName")
        ),
        roles: blocks(person, "relationship").map(decode).filter(Boolean),
        title: tag(person, "relationshipClarification"),
    }));

    const offering = tag(xml, "totalOfferingAmount");
    const firstSaleBlock = blocks(xml, "dateOfFirstSale")[0] ?? "";
    const firstSale = /<yetToOccur>\s*true/i.test(firstSaleBlock)
        ? null
        : tag(firstSaleBlock, "value");

    return {
        phone: tag(xml, "issuerPhoneNumber"),
        fundType: tag(xml, "investmentFundType"),
        offeringAmount:
            offering === undefined
                ? undefined
                : /indefinite/i.test(offering)
                  ? null
                  : amount(xml, "totalOfferingAmount"),
        amountSold: amount(xml, "totalAmountSold"),
        minimumInvestment: amount(xml, "minimumInvestmentAccepted"),
        investorCount: amount(xml, "totalNumberAlreadyInvested"),
        firstSale,
        // People before organisations; otherwise as filed.
        managers: managers
            .filter(m => m.name)
            .sort((a, b) => Number(a.kind === "entity") - Number(b.kind === "entity")),
    };
}

// ── Fetching ────────────────────────────────────────────────────────

export interface EdgarOptions {
    fetchImpl?: typeof fetch;
    userAgent: string;
    signal?: AbortSignal;
    /** Minimum gap between request starts; tests pass 0. */
    minGapMs?: number;
    /** Base back-off before retrying a 5xx; tests pass 0. */
    retryDelayMs?: number;
}

let nextSlot = 0;

/** One queue for the process: SEC's limit is per caller, not per search. */
async function pace(gapMs: number): Promise<void> {
    if (gapMs <= 0) return;
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + gapMs;
    if (at > now) await new Promise(resolve => setTimeout(resolve, at - now));
}

async function edgarGet(url: string, accept: string, options: EdgarOptions): Promise<Response> {
    const retryDelay = options.retryDelayMs ?? RETRY_DELAY_MS;
    for (let attempt = 0; ; attempt++) {
        await pace(options.minGapMs ?? MIN_GAP_MS);
        const response = await (options.fetchImpl ?? fetch)(url, {
            headers: { "User-Agent": options.userAgent, Accept: accept },
            signal: options.signal,
        });
        if (response.ok) return response;
        const transient = response.status >= 500 || response.status === 429;
        if (!transient || attempt >= RETRIES) {
            throw new Error(`SEC EDGAR ${response.status} for ${new URL(url).pathname}`);
        }
        if (retryDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
        }
    }
}

/** A filing never changes once made, so a read is kept for the process. */
const detailCache = new Map<string, FormDDetails>();
const DETAIL_CACHE_MAX = 1000;

export function resetInvestorSearchCache(): void {
    detailCache.clear();
}

async function readFormD(hit: FilingHit, options: EdgarOptions): Promise<FormDDetails> {
    const cached = detailCache.get(hit.accession);
    if (cached) return cached;
    const xml = await (await edgarGet(documentUrl(hit), "application/xml", options)).text();
    const details = parseFormD(xml);
    if (detailCache.size >= DETAIL_CACHE_MAX) {
        const oldest = detailCache.keys().next().value;
        if (oldest !== undefined) detailCache.delete(oldest);
    }
    detailCache.set(hit.accession, details);
    return details;
}

async function mapLimited<T, R>(
    items: readonly T[],
    concurrency: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const out = new Array<R>(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i]!);
        }
    });
    await Promise.all(workers);
    return out;
}

/**
 * Venture funds that filed a Form D in the window, newest first, each with
 * the people and numbers from its latest filing. A filing whose document
 * cannot be read is still returned, marked `detailed: false` — the search
 * hit alone is a real fund in a real place.
 */
export async function searchVentureFunds(
    query: InvestorSearchQuery,
    options: EdgarOptions
): Promise<InvestorSearchResult> {
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const keepVehicles = query.includeSingleDealVehicles === true;
    const now = new Date();

    const hits: FilingHit[] = [];
    let total = 0;
    let fundsSoFar: FilingHit[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
        const from = page * PAGE_SIZE;
        const url = buildSearchUrl(query, now, from);
        const parsed = parseSearchResponse(
            await (await edgarGet(url, "application/json", options)).json()
        );
        total = parsed.total;
        hits.push(...parsed.hits);
        fundsSoFar = latestPerFund(hits).filter(h => keepVehicles || !isSingleDealVehicle(h.name));
        if (fundsSoFar.length >= limit || from + PAGE_SIZE >= total) break;
    }
    const vehicles = keepVehicles
        ? 0
        : latestPerFund(hits).filter(h => isSingleDealVehicle(h.name)).length;
    const latest = fundsSoFar.slice(0, limit);

    const funds = await mapLimited(latest, DETAIL_CONCURRENCY, async hit => {
        const base: FundProfile = {
            cik: hit.cik,
            name: hit.name,
            location: hit.location,
            state: hit.state,
            filedAt: hit.filedAt,
            amendment: hit.form !== "D",
            filingUrl: filingUrl(hit),
            managers: [],
            detailed: false,
        };
        try {
            return { ...base, ...(await readFormD(hit, options)), detailed: true };
        } catch (err) {
            if (options.signal?.aborted) throw err;
            return base;
        }
    });

    return {
        funds,
        totalFilings: total,
        singleDealVehiclesHidden: vehicles,
        source: "sec-edgar-form-d",
    };
}
