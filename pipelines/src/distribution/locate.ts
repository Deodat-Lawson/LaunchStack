/**
 * Where an organisation is, from what we actually saw about it — and whether
 * that is inside the segment's territory.
 *
 * Gather used to stamp every web result with the country (and region) of the
 * search that found it, so a San Francisco startup returned by a "Baltimore,
 * US" query came back as "Baltimore, US", scored full territory points, and
 * showed that as its HQ. Here a location is only what the result's own text
 * or domain says; otherwise it is unknown, and unknown is not "in".
 */
import { countriesMentioned, countryAliases, countryName } from "./keyless/geo";
import type { Territory } from "./types";

/** Country-code top-level domains we can map with confidence (generic ones say nothing). */
const CC_TLD: Readonly<Record<string, string>> = {
    de: "DE",
    nl: "NL",
    uk: "GB",
    fr: "FR",
    es: "ES",
    it: "IT",
    se: "SE",
    no: "NO",
    fi: "FI",
    dk: "DK",
    pl: "PL",
    cz: "CZ",
    at: "AT",
    ch: "CH",
    be: "BE",
    ie: "IE",
    pt: "PT",
    ca: "CA",
    au: "AU",
    nz: "NZ",
    jp: "JP",
    sg: "SG",
    in: "IN",
    br: "BR",
    mx: "MX",
};

/** The country a host's TLD names (`acme.co.uk` → GB); null for .com, .io, .ai and the like. */
export function countryFromHost(host: string | null | undefined): string | null {
    if (!host) return null;
    const tld = host.toLowerCase().replace(/\.$/, "").split(".").pop() ?? "";
    return CC_TLD[tld] ?? null;
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether `text` names `place` as a whole word ("Baltimore", not "Baltimoreans"). */
export function mentionsPlace(text: string, place: string): boolean {
    const p = place.trim();
    if (!p) return false;
    return new RegExp(`(^|[^\\p{L}])${escapeRegExp(p.toLowerCase())}($|[^\\p{L}])`, "u").test(
        text.toLowerCase()
    );
}

export interface SeenLocation {
    country: string | null;
    region: string | null;
}

/**
 * The location a result's own words (or domain) give. The wanted territory
 * only breaks ties: when the text names several countries and one is the
 * wanted one, that one; the wanted region counts only when the text names it.
 */
export function locateFromEvidence(
    text: string,
    host: string | null | undefined,
    wanted: Territory
): SeenLocation {
    const countries = countriesMentioned(text);
    const country = countries.includes(wanted.country)
        ? wanted.country
        : (countries[0] ?? countryFromHost(host));
    const region =
        wanted.region && country === wanted.country && mentionsPlace(text, wanted.region)
            ? wanted.region
            : null;
    return { country: country ?? null, region };
}

export type TerritoryFit = "in" | "out" | "unknown";

/**
 * Is an organisation inside a territory? "out" only on positive evidence (a
 * known country or city that differs); "unknown" when we cannot tell.
 */
export function territoryFit(
    org: { country: string | null; region?: string | null; city?: string | null },
    territory: Territory
): TerritoryFit {
    if (!org.country) return "unknown";
    if (org.country !== territory.country) return "out";
    if (!territory.region) return "in";
    const places = [org.region, org.city].filter((p): p is string => Boolean(p));
    if (places.length === 0) return "unknown";
    return places.some(
        p => mentionsPlace(p, territory.region!) || mentionsPlace(territory.region!, p)
    )
        ? "in"
        : "out";
}

/** The best fit across a segment's territories: in beats unknown beats out. */
export function bestTerritoryFit(
    org: { country: string | null; region?: string | null; city?: string | null },
    territories: readonly Territory[]
): TerritoryFit {
    let best: TerritoryFit = "out";
    for (const t of territories) {
        const fit = territoryFit(org, t);
        if (fit === "in") return "in";
        if (fit === "unknown") best = "unknown";
    }
    return territories.length === 0 ? "unknown" : best;
}

/** Words that name a place in the territory — to keep them out of topic keywords. */
export function placeWords(territory: Territory): Set<string> {
    const words = [...countryAliases(territory.country), territory.region ?? ""]
        .flatMap(s => s.toLowerCase().split(/[^\p{L}\p{N}]+/u))
        .filter(Boolean);
    return new Set(words);
}

const US_STATES = new Set(
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(
        " "
    )
);

/** A two-letter code we know, upper-cased; null otherwise. */
function knownCode(token: string): string | null {
    const code = token.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return null;
    if (code === "UK") return "GB";
    return countryName(code) !== code ? code : null;
}

/**
 * One place as people write it — "Baltimore, MD, USA", "Amsterdam,
 * Netherlands", "NL", "Germany" — as a territory. The last part that names
 * a country is the country; the first part, when it isn't the country, is
 * the city or region. A bare city ("Austin") takes `defaultCountry` (the
 * company's own, say). Null when no country can be told.
 */
export function parsePlace(text: string, defaultCountry?: string | null): Territory | null {
    const parts = text
        .split(",")
        .map(p => p.trim())
        .filter(Boolean);
    if (parts.length === 0) return null;
    let country: string | null = null;
    let countryAt = -1;
    const home = defaultCountry?.toUpperCase() ?? null;
    for (let i = parts.length - 1; i >= 0; i--) {
        const token = parts[i]!.toUpperCase();
        // "Austin, TX": a US state code after a city is the US — when the
        // company is in the US, even for codes that are also countries
        // (CA, DE, IN), since that is how Americans write addresses.
        if (i > 0 && US_STATES.has(token) && (home === "US" || !knownCode(token))) {
            country = "US";
            countryAt = i;
            break;
        }
        const code = knownCode(parts[i]!) ?? countriesMentioned(parts[i]!)[0] ?? null;
        if (code) {
            country = code;
            countryAt = i;
            break;
        }
    }
    country ??= home;
    if (!country) return null;
    const region = countryAt === 0 ? null : parts[0]!;
    return region ? { country, region } : { country };
}

/** Several places, one per line or separated by ";" — commas belong to a place. */
export function parsePlaces(text: string, defaultCountry?: string | null): Territory[] {
    const out: Territory[] = [];
    for (const entry of text.split(/[;\n]+/)) {
        const t = parsePlace(entry, defaultCountry);
        if (t && !out.some(o => o.country === t.country && o.region === t.region)) out.push(t);
    }
    return out;
}

/** A territory as people write it: "Baltimore, United States" or "Netherlands". */
export function placeLabel(territory: Territory): string {
    const country = countryName(territory.country);
    return territory.region ? `${territory.region}, ${country}` : country;
}
