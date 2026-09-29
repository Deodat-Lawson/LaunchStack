/**
 * OpenStreetMap through the public Overpass API: organisations with a
 * website tag, by country (or city) and by what they are. No key, no
 * account. Free under ODbL, which is why every hit carries its OSM id as
 * provenance. The public instance asks for a User-Agent, one query at a
 * time and modest timeouts; this adapter does exactly that.
 */
import type { PartnerKind } from "../types";
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

/** Overpass tag selectors for the kinds of organisation a category names. */
const TAG_RULES: Array<{ match: RegExp; selectors: string[] }> = [
    {
        match: /coffee|roast|koffie|kaffee|espresso|barista/i,
        selectors: ['["shop"="coffee"]', '["craft"="coffee_roaster"]', '["cuisine"="coffee_shop"]'],
    },
    {
        match: /bak(er|ery|kerij)|bread|brood|bäck|pastry|patiss/i,
        selectors: ['["shop"="bakery"]', '["craft"="bakery"]', '["shop"="pastry"]'],
    },
    { match: /\btea\b|thee\b/i, selectors: ['["shop"="tea"]'] },
    {
        match: /wine|wijn|wein|spirits|liquor|beer|brew|distill/i,
        selectors: [
            '["shop"="wine"]',
            '["shop"="alcohol"]',
            '["craft"="brewery"]',
            '["craft"="winery"]',
            '["craft"="distillery"]',
        ],
    },
    {
        match: /deli|delicatess|fine food|specialty food|speciality food|gourmet|cheese|kaas|käse|organic|\bbio\b|health food/i,
        selectors: [
            '["shop"="deli"]',
            '["shop"="cheese"]',
            '["shop"="health_food"]',
            '["shop"="organic"]',
            '["shop"="farm"]',
        ],
    },
    {
        match: /grocer|supermarket|food retail|convenience|minimarket/i,
        selectors: ['["shop"="supermarket"]', '["shop"="greengrocer"]', '["shop"="convenience"]'],
    },
    {
        match: /restaurant|hospitality|horeca|caf[eé]|\bbar\b|catering|bistro/i,
        selectors: ['["amenity"="restaurant"]', '["amenity"="cafe"]', '["amenity"="bar"]'],
    },
    {
        match: /hotel|hostel|accommodation|guest ?house|b&b/i,
        selectors: ['["tourism"="hotel"]', '["tourism"="guest_house"]', '["tourism"="hostel"]'],
    },
    {
        match: /cosmetic|beauty|skin ?care|salon|hairdress|barber|nail/i,
        selectors: ['["shop"="cosmetics"]', '["shop"="beauty"]', '["shop"="hairdresser"]'],
    },
    {
        match: /fashion|apparel|clothing|boutique|kleding|\bmode\b|garment|footwear|shoe/i,
        selectors: ['["shop"="clothes"]', '["shop"="boutique"]', '["shop"="shoes"]'],
    },
    {
        match: /furniture|interior|home ?ware|meubel|möbel|decor/i,
        selectors: [
            '["shop"="furniture"]',
            '["shop"="interior_decoration"]',
            '["shop"="houseware"]',
        ],
    },
    {
        match: /sport|outdoor|bike|bicycle|cycl|fitness equipment/i,
        selectors: ['["shop"="sports"]', '["shop"="bicycle"]', '["shop"="outdoor"]'],
    },
    { match: /\bpet|dog|cat food|dieren|tierbedarf/i, selectors: ['["shop"="pet"]'] },
    {
        match: /electronic|computer|hardware store|phone|gadget/i,
        selectors: ['["shop"="electronics"]', '["shop"="computer"]', '["shop"="mobile_phone"]'],
    },
    {
        match: /pharma|health|clinic|medical|dental|physio|care home/i,
        selectors: [
            '["amenity"="pharmacy"]',
            '["amenity"="clinic"]',
            '["amenity"="dentist"]',
            '["healthcare"~"."]',
        ],
    },
    {
        match: /book|stationery|toy|gift/i,
        selectors: [
            '["shop"="books"]',
            '["shop"="stationery"]',
            '["shop"="toys"]',
            '["shop"="gift"]',
        ],
    },
    {
        match: /garden|plant|florist|flower|nursery/i,
        selectors: ['["shop"="garden_centre"]', '["shop"="florist"]'],
    },
    {
        match: /logistic|warehous|fulfil|3pl|distribution cent|freight|shipping|storage|courier|parcel/i,
        selectors: [
            '["office"="logistics"]',
            '["building"="warehouse"]',
            '["industrial"="warehouse"]',
            '["office"="courier"]',
        ],
    },
    {
        match: /manufactur|factory|fabriek|fabrik|industrial|producer|\bplant\b|machin|engineering/i,
        selectors: ['["man_made"="works"]', '["industrial"="factory"]', '["office"="engineer"]'],
    },
    {
        match: /wholesale|groothandel|großhandel|grossist|cash ?& ?carry/i,
        selectors: ['["shop"="wholesale"]', '["shop"="trade"]'],
    },
    {
        match: /import|distribut|trading|\bhandel\b/i,
        selectors: ['["office"="company"]', '["shop"="wholesale"]'],
    },
    {
        match: /software|saas|\btech\b|startup|agency|consult|\bit\b|digital|design studio/i,
        selectors: ['["office"="it"]', '["office"="company"]', '["office"="advertising_agency"]'],
    },
    {
        match: /school|education|training|university|academy/i,
        selectors: [
            '["amenity"="school"]',
            '["amenity"="university"]',
            '["amenity"="college"]',
            '["office"="educational_institution"]',
        ],
    },
    {
        match: /gym|fitness|yoga|wellness|spa\b|pilates/i,
        selectors: [
            '["leisure"="fitness_centre"]',
            '["leisure"="sports_centre"]',
            '["shop"="massage"]',
        ],
    },
    {
        match: /\bcar\b|auto|garage|dealer|vehicle|motor/i,
        selectors: ['["shop"="car"]', '["shop"="car_repair"]', '["shop"="car_parts"]'],
    },
    {
        match: /construct|build|contractor|architect|plumb|electric|roof|hvac|install/i,
        selectors: [
            '["office"="construction_company"]',
            '["craft"="electrician"]',
            '["craft"="plumber"]',
            '["office"="architect"]',
            '["craft"="hvac"]',
        ],
    },
    {
        match: /\blaw\b|legal|attorney|advoca|notar/i,
        selectors: ['["office"="lawyer"]', '["office"="notary"]'],
    },
    {
        match: /account|\btax\b|bookkeep|financ|insur|bank/i,
        selectors: [
            '["office"="accountant"]',
            '["office"="financial"]',
            '["office"="insurance"]',
            '["office"="financial_advisor"]',
        ],
    },
    {
        match: /real ?estate|property|makelaar|immobil|estate agent/i,
        selectors: ['["office"="estate_agent"]'],
    },
    {
        match: /farm|agri|nursery|greenhouse|kwekerij|landwirt/i,
        selectors: [
            '["shop"="farm"]',
            '["landuse"="farmyard"]["name"]',
            '["man_made"="greenhouse"]["name"]',
        ],
    },
];

// A plain key filter; a regex over keys is what makes a country-wide query time out.
const WEBSITE_FILTER = '["website"]';
const MAX_SELECTORS = 4;

/** Tag selectors for a list of category words; empty when nothing is recognised. */
export function tagSelectorsFor(keywords: readonly string[]): string[] {
    const text = keywords.join(" ");
    const out: string[] = [];
    for (const rule of TAG_RULES) {
        if (rule.match.test(text))
            for (const s of rule.selectors) if (!out.includes(s)) out.push(s);
        if (out.length >= MAX_SELECTORS) break;
    }
    return out.slice(0, MAX_SELECTORS);
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
    /** Pre-computed selectors; defaults to tagSelectorsFor(keywords). */
    selectors?: readonly string[];
    limit?: number;
    timeoutSeconds?: number;
}

export function buildOverpassQuery(
    area: { country: string; city: string | null },
    req: OverpassRequest
): string {
    const selectors = (
        req.selectors?.length ? [...req.selectors] : tagSelectorsFor(req.keywords)
    ).slice(0, MAX_SELECTORS);
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
