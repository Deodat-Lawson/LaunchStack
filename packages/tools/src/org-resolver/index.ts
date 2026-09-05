/**
 * org-resolver — deterministic organisation identity (distribution design
 * §4.1 stage 4). No LLM, no network: a mention (name, URL, country) becomes
 * a stable *resolve key* so repeat discovery runs upsert instead of
 * duplicating, and mentions of the same organisation from different sources
 * merge into one record.
 *
 * Key precedence: a real company domain wins ("d:<domain>"); otherwise a
 * normalised name plus country ("n:<name>|<cc>"). Aggregator and social
 * domains never identify an organisation — a Facebook page is a mention of a
 * company, not the company.
 */

export interface OrgMention {
    name?: string | null;
    /** Any URL that belongs to the organisation (site, page, listing). */
    url?: string | null;
    /** Already-known domain; wins over `url` when both are given. */
    domain?: string | null;
    /** ISO-3166 alpha-2 preferred; free text is normalised best-effort. */
    country?: string | null;
    region?: string | null;
    city?: string | null;
    roles?: readonly string[] | null;
    categories?: readonly string[] | null;
    description?: string | null;
    /** Where this mention came from (a source url or a provider name). */
    source?: string | null;
}

export interface ResolvedOrg {
    resolveKey: string;
    name: string;
    domain: string | null;
    country: string | null;
    region: string | null;
    city: string | null;
    roles: string[];
    categories: string[];
    description: string | null;
    /** Every URL seen for this organisation, first-seen order, deduplicated. */
    urls: string[];
    sources: string[];
    mentionCount: number;
}

export interface ResolveOptions {
    /** Domains that must never resolve to a candidate (the tenant, known partners). */
    excludeDomains?: readonly string[];
    /** Normalised-name keys to exclude (from excluded orgs without a domain). */
    excludeKeys?: readonly string[];
}

/**
 * Domains that host many organisations. A URL on one of these is evidence
 * about an organisation, never its identity.
 */
export const AGGREGATOR_DOMAINS: ReadonlySet<string> = new Set([
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "twitter.com",
    "x.com",
    "youtube.com",
    "tiktok.com",
    "pinterest.com",
    "google.com",
    "maps.google.com",
    "goo.gl",
    "yelp.com",
    "tripadvisor.com",
    "wikipedia.org",
    "amazon.com",
    "amazon.de",
    "amazon.co.uk",
    "alibaba.com",
    "aliexpress.com",
    "made-in-china.com",
    "globalsources.com",
    "indiamart.com",
    "europages.com",
    "kompass.com",
    "thomasnet.com",
    "crunchbase.com",
    "bloomberg.com",
    "opencorporates.com",
    "importyeti.com",
    "importgenius.com",
    "volza.com",
    "panjiva.com",
    "faire.com",
    "ankorstore.com",
    "shopify.com",
    "wordpress.com",
    "wixsite.com",
    "squarespace.com",
    "medium.com",
    "reddit.com",
    "glassdoor.com",
    "indeed.com",
    "zoominfo.com",
    "apollo.io",
    "dnb.com",
]);

/** Legal-form suffixes stripped from names before comparison. */
const LEGAL_SUFFIXES = [
    "gmbh & co kg",
    "gmbh & co. kg",
    "gmbh",
    "ag",
    "kg",
    "ohg",
    "ug",
    "e.k.",
    "ek",
    "b.v.",
    "bv",
    "n.v.",
    "nv",
    "s.a.",
    "sa",
    "s.a.s.",
    "sas",
    "sarl",
    "s.a.r.l.",
    "s.r.l.",
    "srl",
    "s.p.a.",
    "spa",
    "s.l.",
    "sl",
    "s.l.u.",
    "ltd",
    "ltd.",
    "limited",
    "plc",
    "llc",
    "l.l.c.",
    "inc",
    "inc.",
    "incorporated",
    "corp",
    "corp.",
    "corporation",
    "co",
    "co.",
    "company",
    "pty",
    "pty ltd",
    "oy",
    "ab",
    "as",
    "a/s",
    "aps",
    "kft",
    "sp. z o.o.",
    "sp z oo",
    "s.r.o.",
    "sro",
    "d.o.o.",
    "doo",
    "pte",
    "pte ltd",
    "sdn bhd",
    "bhd",
    "k.k.",
    "kk",
    "g.k.",
];

const SUFFIX_PATTERN = new RegExp(
    `(?:\\s|,|^)(?:${LEGAL_SUFFIXES.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\.?$`,
    "i"
);

/** Country names and common spellings → ISO alpha-2. Small on purpose; unknown input passes through uppercased when it already looks like a code. */
const COUNTRY_CODES: Record<string, string> = {
    germany: "DE",
    deutschland: "DE",
    netherlands: "NL",
    "the netherlands": "NL",
    holland: "NL",
    nederland: "NL",
    france: "FR",
    belgium: "BE",
    austria: "AT",
    switzerland: "CH",
    italy: "IT",
    spain: "ES",
    portugal: "PT",
    poland: "PL",
    sweden: "SE",
    norway: "NO",
    denmark: "DK",
    finland: "FI",
    ireland: "IE",
    "united kingdom": "GB",
    uk: "GB",
    britain: "GB",
    "great britain": "GB",
    england: "GB",
    "united states": "US",
    "united states of america": "US",
    usa: "US",
    america: "US",
    canada: "CA",
    mexico: "MX",
    brazil: "BR",
    argentina: "AR",
    chile: "CL",
    australia: "AU",
    "new zealand": "NZ",
    japan: "JP",
    china: "CN",
    "hong kong": "HK",
    singapore: "SG",
    "south korea": "KR",
    korea: "KR",
    india: "IN",
    "united arab emirates": "AE",
    uae: "AE",
    "saudi arabia": "SA",
    israel: "IL",
    turkey: "TR",
    türkiye: "TR",
    "south africa": "ZA",
    nigeria: "NG",
    kenya: "KE",
    egypt: "EG",
    "czech republic": "CZ",
    czechia: "CZ",
    hungary: "HU",
    romania: "RO",
    greece: "GR",
    vietnam: "VN",
    thailand: "TH",
    indonesia: "ID",
    malaysia: "MY",
    philippines: "PH",
    taiwan: "TW",
};

export function normalizeCountry(input: string | null | undefined): string | null {
    if (!input) return null;
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
    const mapped = COUNTRY_CODES[trimmed.toLowerCase()];
    return mapped ?? null;
}

/**
 * Host → registrable-ish domain: lowercase, strip `www.` and common
 * marketing subdomains, keep the rest (we do not ship a public-suffix list;
 * `shop.acme.co.uk` → `acme.co.uk` is handled by the known-second-level rule).
 */
export function normalizeDomain(input: string | null | undefined): string | null {
    if (!input) return null;
    let host = input.trim().toLowerCase();
    if (!host) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//.test(host)) host = `http://${host}`;
    let parsed: URL;
    try {
        parsed = new URL(host);
    } catch {
        return null;
    }
    let hostname = parsed.hostname.replace(/\.$/, "");
    if (!hostname || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":"))
        return null;
    if (!hostname.includes(".")) return null;
    hostname = hostname.replace(/^(www\d?|m|shop|store|en|de|fr|nl|us|uk|eu|www2)\./, "");
    const parts = hostname.split(".");
    const secondLevel = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "or", "ne"]);
    if (parts.length >= 3) {
        const tld = parts[parts.length - 1]!;
        const sld = parts[parts.length - 2]!;
        if (tld.length === 2 && secondLevel.has(sld)) {
            hostname = parts.slice(-3).join(".");
        } else {
            hostname = parts.slice(-2).join(".");
        }
    }
    return hostname;
}

export function isAggregatorDomain(domain: string | null | undefined): boolean {
    if (!domain) return false;
    return AGGREGATOR_DOMAINS.has(domain);
}

/** Lowercase, strip diacritics, legal suffixes, punctuation; collapse spaces. */
export function normalizeOrgName(input: string | null | undefined): string | null {
    if (!input) return null;
    let name = input
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[’'"`´]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!name) return null;
    // Strip up to three trailing legal forms ("Acme Holding GmbH & Co. KG"):
    // the ampersand is kept until after this so compound forms match.
    for (let i = 0; i < 3; i++) {
        const next = name
            .replace(SUFFIX_PATTERN, "")
            .trim()
            .replace(/[,\s&]+$/, "");
        if (next === name) break;
        name = next;
    }
    name = name
        .replace(/&/g, " and ")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
    return name || null;
}

export function makeResolveKey(args: {
    domain?: string | null;
    name?: string | null;
    country?: string | null;
}): string | null {
    const domain = normalizeDomain(args.domain);
    if (domain && !isAggregatorDomain(domain)) return `d:${domain}`;
    const name = normalizeOrgName(args.name);
    if (!name) return null;
    const country = normalizeCountry(args.country) ?? "";
    return `n:${name}|${country}`;
}

function pickDomain(mention: OrgMention): string | null {
    const explicit = normalizeDomain(mention.domain);
    if (explicit && !isAggregatorDomain(explicit)) return explicit;
    const fromUrl = normalizeDomain(mention.url);
    if (fromUrl && !isAggregatorDomain(fromUrl)) return fromUrl;
    return null;
}

function emptyToNull(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed?.length ? trimmed : null;
}

function pushUnique(target: string[], values: Iterable<string | null | undefined>): void {
    for (const value of values) {
        if (!value) continue;
        const trimmed = value.trim();
        if (trimmed && !target.includes(trimmed)) target.push(trimmed);
    }
}

/**
 * Merge mentions into organisations. Order is preserved (first mention wins
 * for scalar fields unless it is empty), so callers can put their most
 * trusted source first.
 */
export function resolveOrganizations(
    mentions: readonly OrgMention[],
    options: ResolveOptions = {}
): ResolvedOrg[] {
    const excludedDomains = new Set(
        (options.excludeDomains ?? [])
            .map(d => normalizeDomain(d))
            .filter((d): d is string => Boolean(d))
    );
    const excludedKeys = new Set([
        ...(options.excludeKeys ?? []),
        ...[...excludedDomains].map(d => `d:${d}`),
    ]);

    const byKey = new Map<string, ResolvedOrg>();
    for (const mention of mentions) {
        const domain = pickDomain(mention);
        const key = makeResolveKey({ domain, name: mention.name, country: mention.country });
        if (!key) continue;
        if (excludedKeys.has(key)) continue;
        if (domain && excludedDomains.has(domain)) continue;

        const existing = byKey.get(key);
        const trimmedName = mention.name?.trim();
        const name = trimmedName?.length ? trimmedName : (domain ?? key);
        if (!existing) {
            const org: ResolvedOrg = {
                resolveKey: key,
                name,
                domain,
                country: normalizeCountry(mention.country),
                region: emptyToNull(mention.region),
                city: emptyToNull(mention.city),
                roles: [],
                categories: [],
                description: emptyToNull(mention.description),
                urls: [],
                sources: [],
                mentionCount: 1,
            };
            pushUnique(org.roles, mention.roles ?? []);
            pushUnique(org.categories, mention.categories ?? []);
            pushUnique(org.urls, [mention.url]);
            pushUnique(org.sources, [mention.source]);
            byKey.set(key, org);
            continue;
        }
        existing.mentionCount += 1;
        if (!existing.domain && domain) existing.domain = domain;
        existing.country ??= normalizeCountry(mention.country);
        if (!existing.region && mention.region) existing.region = mention.region.trim();
        if (!existing.city && mention.city) existing.city = mention.city.trim();
        if (!existing.description && mention.description) {
            existing.description = mention.description.trim();
        }
        // Prefer a proper name over a domain stand-in.
        if (existing.name === existing.domain && mention.name?.trim()) {
            existing.name = mention.name.trim();
        }
        pushUnique(existing.roles, mention.roles ?? []);
        pushUnique(existing.categories, mention.categories ?? []);
        pushUnique(existing.urls, [mention.url]);
        pushUnique(existing.sources, [mention.source]);
    }
    return [...byKey.values()];
}
