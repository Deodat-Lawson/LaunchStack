/**
 * OpenStreetMap through the public Overpass API: organisations with a
 * website tag, by country (or city) and by what they are. No key, no
 * account. Free under ODbL, which is why every hit carries its OSM id as
 * provenance. The public instance asks for a User-Agent, one query at a
 * time and modest timeouts; this adapter does exactly that.
 */
import type { PartnerKind } from "../types";
import { cosine, type EmbedTexts } from "../semantic";
import type { OsmCategory } from "./taginfo";
import { escapeRegExp, overpassAreas } from "./geo";

export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
/** Public instances, tried in order; the shared servers answer 504 under load. */
export const OVERPASS_MIRRORS = [
    OVERPASS_URL,
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
];
export const KEYLESS_USER_AGENT =
    "LaunchStack-Prospects/0.1 (+https://github.com/Deodat-Lawson/LaunchStack)";

// A plain key filter; a regex over keys is what makes a country-wide query time out.
const WEBSITE_FILTER = '["website"]';
const MAX_SELECTORS = 4;

let categoryVectors: { key: string; vectors: number[][] } | null = null;

/**
 * The OpenStreetMap categories closest in meaning to who the segment sells
 * to, best first. A category must sit nearer the brief than the best match
 * does to an unrelated brief would — in practice: keep those within reach of
 * the best one (the gap a real second category shows), never a long tail.
 */
export async function chooseOsmCategories(
    embed: EmbedTexts,
    brief: string,
    vocabulary: readonly OsmCategory[],
    max = MAX_SELECTORS
): Promise<string[]> {
    if (vocabulary.length === 0) return [];
    const descriptions = vocabulary.map(c => c.description);
    const key = descriptions.join("|");
    if (categoryVectors?.key !== key) {
        categoryVectors = { key, vectors: await embed(descriptions) };
    }
    const [query] = await embed([brief]);
    if (!query) return [];
    const scored = vocabulary
        .map((c, i) => ({
            selector: c.selector,
            score: cosine(query, categoryVectors!.vectors[i] ?? []),
        }))
        .sort((a, b) => b.score - a.score);
    const best = scored[0]?.score ?? 0;
    const spread = best - (scored[Math.min(scored.length - 1, 20)]?.score ?? 0);
    // Within half the spread between the best and the 20th: the categories that
    // stand out from the pack, not the pack itself.
    return scored
        .filter(c => c.score >= best - spread / 2)
        .slice(0, max)
        .map(c => c.selector);
}

/** Forget the cached category vectors (tests; a changed embedding model). */
export function resetOsmCategoryVectors(): void {
    categoryVectors = null;
}

/**
 * Without an embedder: the categories whose description shares a word with
 * the segment's. A plain fallback over the same vocabulary — no hand-written
 * rules — used only when no embedding model is configured.
 */
export function tagSelectorsFor(
    keywords: readonly string[],
    vocabulary: readonly OsmCategory[]
): string[] {
    const words = new Set(
        keywords
            .flatMap(k => k.toLowerCase().split(/[^\p{L}\p{N}]+/u))
            .filter(w => w.length >= 3)
            .map(w => w.replace(/(ies|es|s)$/, ""))
    );
    if (words.size === 0) return [];
    const scored = vocabulary
        .map(c => {
            const own = c.description
                .toLowerCase()
                .split(/[^\p{L}\p{N}]+/u)
                .map(w => w.replace(/(ies|es|s)$/, ""));
            return { selector: c.selector, hits: own.filter(w => words.has(w)).length };
        })
        .filter(c => c.hits > 0)
        .sort((a, b) => b.hits - a.hits);
    return scored.slice(0, MAX_SELECTORS).map(c => c.selector);
}

/** A case-insensitive Overpass regex over names, from the significant words in the keywords. */
export function nameRegexFor(keywords: readonly string[]): string | null {
    const words = [
        ...new Set(
            keywords
                .flatMap(k => k.toLowerCase().split(/[^\p{L}\p{N}]+/u))
                .filter(w => w.length >= 4)
        ),
    ].slice(0, 6);
    if (words.length === 0) return null;
    return words.map(escapeRegExp).join("|");
}

export interface OverpassRequest {
    country: string;
    /** City or region name; null for the whole country (or the top cities of a large one). */
    region?: string | null;
    keywords: readonly string[];
    /** Tag selectors chosen for the segment; none → match names only. */
    selectors?: readonly string[];
    limit?: number;
    timeoutSeconds?: number;
}

export function buildOverpassQuery(
    area: { country: string; city: string | null },
    req: OverpassRequest
): string {
    const selectors = [...(req.selectors ?? [])].slice(0, MAX_SELECTORS);
    const nameRegex = nameRegexFor(req.keywords);
    const timeout = req.timeoutSeconds ?? 20;
    const limit = req.limit ?? 40;
    const areaDefs = [`area["ISO3166-1"="${area.country}"]->.c;`];
    let scope = "(area.c)";
    if (area.city) {
        areaDefs.push(
            `area["name"="${area.city.replace(/"/g, '\\"')}"]["boundary"="administrative"]->.r;`
        );
        scope = "(area.c)(area.r)";
    }
    const statements: string[] = selectors.map(s => `nwr${scope}${s}${WEBSITE_FILTER};`);
    // A name match is cheap inside a city and acceptable in a small country;
    // it is what finds "Nordlager Fulfilment" when no tag says fulfilment.
    if (nameRegex && (area.city || selectors.length === 0)) {
        statements.push(`nwr${scope}["name"~"${nameRegex}",i]${WEBSITE_FILTER};`);
    }
    if (statements.length === 0)
        statements.push(`nwr${scope}["office"="company"]${WEBSITE_FILTER};`);
    return `[out:json][timeout:${timeout}];\n${areaDefs.join("\n")}\n(\n  ${statements.join("\n  ")}\n);\nout center ${limit};`;
}

export interface OsmPlace {
    /** "osm:node/123" — the provenance id. */
    id: string;
    name: string;
    website: string | null;
    address: string;
    lat: number;
    lng: number;
    /** Tag pairs that made it match, e.g. ["shop=coffee"]. */
    categories: string[];
    country: string;
    city: string | null;
}

interface OverpassElement {
    type: string;
    id: number;
    lat?: number;
    lon?: number;
    center?: { lat: number; lon: number };
    tags?: Record<string, string>;
}

const CATEGORY_KEYS = [
    "shop",
    "amenity",
    "office",
    "craft",
    "tourism",
    "industrial",
    "building",
    "man_made",
    "leisure",
    "healthcare",
    "cuisine",
];

export function mapOverpassElements(
    elements: OverpassElement[],
    area: { country: string; city: string | null }
): OsmPlace[] {
    const out: OsmPlace[] = [];
    const seen = new Set<string>();
    for (const el of elements) {
        const tags = el.tags ?? {};
        const name = tags.name?.trim();
        if (!name) continue;
        const rawSite = tags.website ?? tags["contact:website"] ?? null;
        const website = rawSite ? normalizeWebsite(rawSite) : null;
        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        if (lat === undefined || lng === undefined) continue;
        const key = website ?? `${name.toLowerCase()}|${lat.toFixed(3)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const address = [
            [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" "),
            tags["addr:postcode"],
            tags["addr:city"] ?? area.city ?? undefined,
        ]
            .filter(Boolean)
            .join(", ");
        out.push({
            id: `osm:${el.type}/${el.id}`,
            name,
            website,
            address: address || (area.city ?? area.country),
            lat,
            lng,
            categories: CATEGORY_KEYS.filter(k => tags[k]).map(k => `${k}=${tags[k]}`),
            country: area.country,
            city: tags["addr:city"] ?? area.city,
        });
    }
    return out;
}

function normalizeWebsite(raw: string): string | null {
    const first = raw.split(/[;\s]+/)[0]!.trim();
    if (!first) return null;
    const withScheme = /^https?:\/\//i.test(first) ? first : `https://${first}`;
    try {
        const u = new URL(withScheme);
        if (!u.hostname.includes(".")) return null;
        return u.href;
    } catch {
        return null;
    }
}

export interface OverpassClientOptions {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    /** Instances to try in order; defaults to OVERPASS_MIRRORS. */
    urls?: readonly string[];
    userAgent?: string;
}

interface OverpassResponse {
    elements?: OverpassElement[];
    /** Overpass reports a server-side timeout as a 200 with a remark and no elements. */
    remark?: string;
}

async function requestArea(
    url: string,
    query: string,
    options: OverpassClientOptions
): Promise<OverpassElement[]> {
    const response = await (options.fetchImpl ?? fetch)(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": options.userAgent ?? KEYLESS_USER_AGENT,
            Accept: "application/json",
        },
        body: new URLSearchParams({ data: query }),
        signal: options.signal,
    });
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
            `Overpass ${response.status}${
                text
                    ? `: ${text
                          .replace(/<[^>]+>/g, " ")
                          .replace(/\s+/g, " ")
                          .trim()
                          .slice(0, 100)}`
                    : ""
            }`
        );
    }
    const json = (await response.json()) as OverpassResponse;
    const elements = json.elements ?? [];
    if (elements.length === 0 && json.remark && /timed out|error/i.test(json.remark))
        throw new Error(`Overpass remark: ${json.remark.slice(0, 120)}`);
    return elements;
}

/**
 * Runs one Overpass request per area (a country, or the top cities of a big
 * one), trying each public instance in turn when one is overloaded, and
 * merges the places. Throws only when every instance failed for an area,
 * so the gather stage can mark the source failed.
 */
export async function searchOverpass(
    req: OverpassRequest,
    options: OverpassClientOptions = {}
): Promise<OsmPlace[]> {
    const urls = options.urls ?? OVERPASS_MIRRORS;
    const areas = overpassAreas(req.country, req.region ?? null);
    const places: OsmPlace[] = [];
    let lastError: Error | null = null;
    for (const area of areas) {
        if (options.signal?.aborted) break;
        const query = buildOverpassQuery(area, req);
        let elements: OverpassElement[] | null = null;
        for (const url of urls) {
            try {
                elements = await requestArea(url, query, options);
                break;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                if (options.signal?.aborted) break;
            }
        }
        if (elements === null) continue;
        places.push(...mapOverpassElements(elements, area));
        if (places.length >= (req.limit ?? 40)) break;
    }
    if (places.length === 0 && lastError) throw lastError;
    return places.slice(0, req.limit ?? 40);
}

/** Food service and shops that sell to the public: a retailer for a segment's purposes. */
const RETAIL_AMENITIES = new Set([
    "cafe",
    "restaurant",
    "bar",
    "pub",
    "fast_food",
    "ice_cream",
    "food_court",
    "marketplace",
    "pharmacy",
]);

/**
 * What a directory tag says about an organisation's role, and nothing more:
 * a shop sells to the public, a wholesale shop to the trade, a craft or
 * industrial listing makes things. Tags that say nothing yield nothing, so
 * the requested kind is never echoed back as a finding.
 */
export function rolesForOsmCategories(categories: readonly string[]): PartnerKind[] {
    const roles = new Set<PartnerKind>();
    for (const category of categories) {
        const [key, value = ""] = category.split("=");
        if (key === "shop")
            roles.add(value === "wholesale" || value === "trade" ? "wholesaler" : "retailer");
        else if (key === "amenity" && RETAIL_AMENITIES.has(value)) roles.add("retailer");
        else if (
            key === "craft" ||
            key === "industrial" ||
            (key === "man_made" && value === "works")
        )
            roles.add("supplier");
    }
    return [...roles];
}
