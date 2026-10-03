/**
 * Grants.gov, keyless: the federal opportunity search, then each hit's own
 * synopsis for the award range, the eligibility text and the description.
 *
 * `search2` answers "which opportunities mention these words, open to this
 * kind of applicant" with titles, agencies and dates only; `fetchOpportunity`
 * carries the synopsis. Both are public JSON endpoints with no key and no
 * documented rate limit; detail reads are still bounded and concurrent.
 */
import type { ApplicantType, GrantOpportunity, GrantSearchQuery } from "./types";

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
const DETAIL_CONCURRENCY = 4;
/** How many hits get a synopsis read; the rest keep what the search returned. */
const DETAIL_LIMIT = 12;
const RETRIES = 1;
const RETRY_DELAY_MS = 300;

export interface GrantsGovOptions {
    apiUrl: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    /** Read synopses for the first hits (default true). */
    detail?: boolean;
    now?: Date;
}

/**
 * Grants.gov eligibility codes, from its own filter list. A nonprofit sees
 * both 501(c)(3) codes and "unrestricted"; a company sees the two business
 * codes and "unrestricted". Unknown or "any" sends no filter.
 */
const ELIGIBILITY_CODES: Record<ApplicantType, string[]> = {
    nonprofit: ["12", "13", "25", "99"],
    small_business: ["23", "99"],
    for_profit: ["22", "23", "99"],
    individual: ["21", "99"],
    any: [],
};

/** The words someone typed as one search phrase: commas become spaces, quotes stay. */
export function keywordPhrase(keywords: readonly string[] = []): string {
    return keywords
        .flatMap(k => k.split(","))
        .map(k =>
            k
                .replace(/[\\"()]/g, " ")
                .replace(/\s+/g, " ")
                .trim()
        )
        .filter(k => k.length >= 2)
        .join(" ")
        .slice(0, 200);
}

export function buildSearchBody(query: GrantSearchQuery): Record<string, unknown> {
    const status = query.status ?? "both";
    const oppStatuses =
        status === "posted"
            ? "posted"
            : status === "forecasted"
              ? "forecasted"
              : "forecasted|posted";
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const eligibilities = ELIGIBILITY_CODES[query.applicantType ?? "any"];
    return {
        keyword: keywordPhrase(query.keywords),
        oppNum: "",
        cfda: "",
        agencies: "",
        oppStatuses,
        rows: limit,
        startRecordNum: 0,
        sortBy: "openDate|desc",
        eligibilities: eligibilities.join("|"),
    };
}

// ── Responses ───────────────────────────────────────────────────────

interface SearchHit {
    id?: string | number;
    number?: string;
    title?: string;
    agencyCode?: string;
    agency?: string;
    agencyName?: string;
    openDate?: string;
    closeDate?: string;
    oppStatus?: string;
    docType?: string;
    alnist?: string[];
    cfdaList?: string[];
}

/** "03/14/2026" → "2026-03-14"; ISO input passes through; anything else null. */
export function toIsoDay(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
    if (us) {
        const [, m, d, y] = us;
        return `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export function opportunityUrl(id: string): string {
    return `https://www.grants.gov/search-results-detail/${encodeURIComponent(id)}`;
}

/** Trimmed text, or null when the field is empty. */
function text(value: string | undefined | null): string | null {
    const trimmed = value?.trim();
    return trimmed === undefined || trimmed === "" ? null : trimmed;
}

function statusOf(
    raw: string | undefined,
    closesOn: string | null,
    now: Date
): GrantOpportunity["status"] {
    const word = raw?.toLowerCase();
    if (word === "forecasted") return "forecasted";
    if (word === "posted") {
        if (closesOn && closesOn < now.toISOString().slice(0, 10)) return "closed";
        return "posted";
    }
    if (word === "closed" || word === "archived") return "closed";
    return "unknown";
}

export function parseSearchResponse(
    json: unknown,
    now = new Date()
): { total: number; hits: GrantOpportunity[] } {
    const body = json as { data?: { hitCount?: number; oppHits?: SearchHit[] } };
    const hits: GrantOpportunity[] = [];
    for (const raw of body.data?.oppHits ?? []) {
        const id = raw.id === undefined || raw.id === null ? null : String(raw.id);
        const title = raw.title?.trim();
        if (!id || !title) continue;
        const closesOn = toIsoDay(raw.closeDate);
        hits.push({
            source: "grants_gov",
            externalId: id,
            title,
            funder:
                text(raw.agencyName) ??
                text(raw.agency) ??
                text(raw.agencyCode) ??
                "Federal agency",
            url: opportunityUrl(id),
            summary: null,
            opensOn: toIsoDay(raw.openDate),
            closesOn,
            status: statusOf(raw.oppStatus, closesOn, now),
            amountMin: null,
            amountMax: null,
            eligibility: null,
            categories: [...(raw.alnist ?? raw.cfdaList ?? [])].filter(Boolean),
            opportunityNumber: text(raw.number),
        });
    }
    return { total: body.data?.hitCount ?? hits.length, hits };
}

interface DetailSynopsis {
    synopsisDesc?: string;
    awardCeiling?: string | number;
    awardFloor?: string | number;
    applicantEligibilityDesc?: string;
    responseDate?: string;
    agencyName?: string;
    agencyContactName?: string;
}

/** Strip the HTML Grants.gov keeps in synopsis fields. */
export function plainText(html: string | undefined | null, max = 2_000): string | null {
    if (!html) return null;
    const text = html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n+/g, "\n")
        .trim();
    if (!text) return null;
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function money(raw: string | number | undefined): number | null {
    if (raw === undefined || raw === null || raw === "") return null;
    const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Merge a `fetchOpportunity` answer into a search hit. Unknown shapes leave the hit unchanged. */
export function parseOpportunityDetail(json: unknown, hit: GrantOpportunity): GrantOpportunity {
    const body = json as {
        data?: {
            synopsis?: DetailSynopsis;
            agencyDetails?: { agencyName?: string };
            opportunityTitle?: string;
        };
    };
    const synopsis = body.data?.synopsis;
    if (!synopsis) return hit;
    return {
        ...hit,
        funder:
            text(body.data?.agencyDetails?.agencyName) ?? text(synopsis.agencyName) ?? hit.funder,
        summary: plainText(synopsis.synopsisDesc) ?? hit.summary,
        amountMin: money(synopsis.awardFloor) ?? hit.amountMin,
        amountMax: money(synopsis.awardCeiling) ?? hit.amountMax,
        eligibility: plainText(synopsis.applicantEligibilityDesc, 1_200) ?? hit.eligibility,
        closesOn: hit.closesOn ?? toIsoDay(synopsis.responseDate),
    };
}

// ── HTTP ────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function postJson(url: string, body: unknown, options: GrantsGovOptions): Promise<unknown> {
    const fetchImpl = options.fetchImpl ?? fetch;
    let lastError: unknown;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
        try {
            const response = await fetchImpl(url, {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify(body),
                signal: options.signal,
            });
            if (response.status >= 500 && attempt < RETRIES) {
                lastError = new Error(`Grants.gov answered ${response.status}`);
                await sleep(RETRY_DELAY_MS);
                continue;
            }
            if (!response.ok) throw new Error(`Grants.gov answered ${response.status}`);
            return (await response.json()) as unknown;
        } catch (error) {
            if (options.signal?.aborted) throw error;
            lastError = error;
            if (attempt < RETRIES) await sleep(RETRY_DELAY_MS);
        }
    }
    throw lastError instanceof Error ? lastError : new Error("Grants.gov request failed");
}

async function mapLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const out: R[] = new Array<R>(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            out[index] = await fn(items[index]!);
        }
    });
    await Promise.all(workers);
    return out;
}

/** Open federal opportunities for the query, with synopses for the first hits. */
export async function searchGrantsGov(
    query: GrantSearchQuery,
    options: GrantsGovOptions
): Promise<{ total: number; hits: GrantOpportunity[] }> {
    const now = options.now ?? new Date();
    const search = await postJson(`${options.apiUrl}/search2`, buildSearchBody(query), options);
    const parsed = parseSearchResponse(search, now);
    // A search for open calls should not list closed ones; a synopsis read for
    // a closed opportunity is wasted.
    const open = parsed.hits.filter(h => h.status !== "closed");
    if (options.detail === false || open.length === 0) return { total: parsed.total, hits: open };

    const detailed = await mapLimit(open.slice(0, DETAIL_LIMIT), DETAIL_CONCURRENCY, async hit => {
        try {
            const json = await postJson(
                `${options.apiUrl}/fetchOpportunity`,
                { opportunityId: Number(hit.externalId) || hit.externalId },
                options
            );
            return parseOpportunityDetail(json, hit);
        } catch {
            // The listing is still useful without its synopsis.
            return hit;
        }
    });
    return { total: parsed.total, hits: [...detailed, ...open.slice(DETAIL_LIMIT)] };
}
