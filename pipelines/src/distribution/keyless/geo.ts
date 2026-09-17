/**
 * Small geography tables the keyless sources need: country names in the
 * forms directories print them, and the cities to split a country-wide
 * OpenStreetMap query into when the country is too large for one request.
 * Deliberately short; anything not listed falls back to the ISO code.
 */

export interface CountryInfo {
    /** English name as a directory prints it. */
    name: string;
    /** Other spellings seen in directory location strings. */
    aliases: string[];
    /** Largest cities, used to scope Overpass queries in big countries. */
    cities: string[];
    /** True when a country-wide Overpass query is cheap enough to run as one. */
    small: boolean;
}

export const COUNTRIES: Record<string, CountryInfo> = {
    NL: {
        name: "Netherlands",
        aliases: ["the Netherlands", "Nederland", "Holland"],
        cities: ["Amsterdam", "Rotterdam", "Utrecht", "Eindhoven"],
        small: true,
    },
    BE: {
        name: "Belgium",
        aliases: ["België", "Belgique"],
        cities: ["Brussels", "Antwerp", "Ghent"],
        small: true,
    },
    LU: { name: "Luxembourg", aliases: [], cities: ["Luxembourg"], small: true },
    DE: {
        name: "Germany",
        aliases: ["Deutschland"],
        cities: ["Berlin", "Hamburg", "Munich", "Cologne", "Frankfurt"],
        small: false,
    },
    AT: {
        name: "Austria",
        aliases: ["Österreich"],
        cities: ["Vienna", "Graz", "Linz"],
        small: true,
    },
    CH: {
        name: "Switzerland",
        aliases: ["Schweiz", "Suisse", "Svizzera"],
        cities: ["Zürich", "Geneva", "Basel"],
        small: true,
    },
    FR: {
        name: "France",
        aliases: [],
        cities: ["Paris", "Lyon", "Marseille", "Toulouse"],
        small: false,
    },
    GB: {
        name: "United Kingdom",
        aliases: ["UK", "England", "Scotland", "Wales", "Great Britain"],
        cities: ["London", "Manchester", "Birmingham", "Leeds", "Glasgow"],
        small: false,
    },
    IE: { name: "Ireland", aliases: [], cities: ["Dublin", "Cork"], small: true },
    ES: {
        name: "Spain",
        aliases: ["España"],
        cities: ["Madrid", "Barcelona", "Valencia", "Seville"],
        small: false,
    },
    PT: { name: "Portugal", aliases: [], cities: ["Lisbon", "Porto"], small: true },
    IT: {
        name: "Italy",
        aliases: ["Italia"],
        cities: ["Milan", "Rome", "Turin", "Bologna"],
        small: false,
    },
    DK: { name: "Denmark", aliases: ["Danmark"], cities: ["Copenhagen", "Aarhus"], small: true },
    SE: {
        name: "Sweden",
        aliases: ["Sverige"],
        cities: ["Stockholm", "Gothenburg", "Malmö"],
        small: true,
    },
    NO: { name: "Norway", aliases: ["Norge"], cities: ["Oslo", "Bergen"], small: true },
    FI: { name: "Finland", aliases: ["Suomi"], cities: ["Helsinki", "Tampere"], small: true },
    PL: {
        name: "Poland",
        aliases: ["Polska"],
        cities: ["Warsaw", "Kraków", "Wrocław"],
        small: false,
    },
    CZ: { name: "Czechia", aliases: ["Czech Republic"], cities: ["Prague", "Brno"], small: true },
    US: {
        name: "United States",
        aliases: ["USA", "United States of America", "US"],
        cities: ["New York", "Los Angeles", "Chicago", "Houston", "San Francisco"],
        small: false,
    },
    CA: { name: "Canada", aliases: [], cities: ["Toronto", "Vancouver", "Montreal"], small: false },
    AU: {
        name: "Australia",
        aliases: [],
        cities: ["Sydney", "Melbourne", "Brisbane"],
        small: false,
    },
    NZ: { name: "New Zealand", aliases: [], cities: ["Auckland", "Wellington"], small: true },
    JP: { name: "Japan", aliases: [], cities: ["Tokyo", "Osaka"], small: false },
    SG: { name: "Singapore", aliases: [], cities: ["Singapore"], small: true },
    IN: { name: "India", aliases: [], cities: ["Mumbai", "Bengaluru", "Delhi"], small: false },
    BR: {
        name: "Brazil",
        aliases: ["Brasil"],
        cities: ["São Paulo", "Rio de Janeiro"],
        small: false,
    },
    MX: {
        name: "Mexico",
        aliases: ["México"],
        cities: ["Mexico City", "Guadalajara", "Monterrey"],
        small: false,
    },
};

export function countryName(code: string): string {
    return COUNTRIES[code.toUpperCase()]?.name ?? code.toUpperCase();
}

/** Every spelling a directory might use for the country, lower-cased. */
export function countryAliases(code: string): string[] {
    const info = COUNTRIES[code.toUpperCase()];
    const list = info ? [info.name, ...info.aliases] : [code];
    return [...new Set(list.map(s => s.toLowerCase()))];
}

/** Areas to query in OpenStreetMap: one country-wide area, or the top cities of a large country. */
export function overpassAreas(
    country: string,
    region?: string | null
): Array<{ country: string; city: string | null }> {
    const cc = country.toUpperCase();
    if (region) return [{ country: cc, city: region }];
    const info = COUNTRIES[cc];
    if (!info || info.small) return [{ country: cc, city: null }];
    return info.cities.slice(0, 4).map(city => ({ country: cc, city }));
}

/** Country mentions in free text, as ISO codes; the territory's own country counts once. */
export function countriesMentioned(text: string): string[] {
    const lower = text.toLowerCase();
    const found: string[] = [];
    for (const [code, info] of Object.entries(COUNTRIES)) {
        const names = [info.name, ...info.aliases];
        const hit = names.some(n =>
            n.length > 2
                ? new RegExp(`\\b${escapeRegExp(n.toLowerCase())}\\b`).test(lower)
                : // Two-letter forms ("UK", "US") only count when written in capitals,
                  // otherwise every "us" in a sentence would be a country.
                  new RegExp(`\\b${escapeRegExp(n)}\\b`).test(text)
        );
        if (hit) found.push(code);
    }
    return found;
}

export function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Words that appear in business names for a category, in the languages of the target markets. */
const NATIVE_TERMS: Array<{ match: RegExp; terms: string[] }> = [
    {
        match: /coffee|roast|espresso/i,
        terms: ["koffiebranderij", "kaffeerösterei", "torréfacteur", "tostador", "coffee roasters"],
    },
    {
        match: /bak(er|ery)|bread|pastry/i,
        terms: ["bakkerij", "bäckerei", "boulangerie", "panadería", "bakery"],
    },
    { match: /brew|beer/i, terms: ["brouwerij", "brauerei", "brasserie", "cervecería", "brewery"] },
    {
        match: /wine|spirits|liquor|distill/i,
        terms: ["wijnhandel", "weinhandlung", "cave à vin", "distillery"],
    },
    { match: /cheese/i, terms: ["kaas", "käse", "fromagerie"] },
    { match: /butcher|meat/i, terms: ["slagerij", "metzgerei", "boucherie"] },
    {
        match: /wholesale/i,
        terms: ["groothandel", "großhandel", "grossiste", "mayorista", "wholesale"],
    },
    {
        match: /logistic|warehous|fulfil|3pl|freight|storage/i,
        terms: ["logistiek", "logistik", "logistique", "fulfilment", "fulfillment", "warehousing"],
    },
    {
        match: /import|distribut|trading/i,
        terms: ["import", "distributie", "vertrieb", "distribution", "trading"],
    },
    { match: /florist|flower/i, terms: ["bloemist", "blumen", "fleuriste", "florist"] },
    {
        match: /garden|plant|nursery/i,
        terms: ["tuincentrum", "gartencenter", "jardinerie", "kwekerij", "garden centre"],
    },
    { match: /pharma/i, terms: ["apotheek", "apotheke", "pharmacie", "pharmacy"] },
    { match: /dental|dentist/i, terms: ["tandarts", "zahnarzt", "dentiste", "dental"] },
    {
        match: /physio|clinic|medical/i,
        terms: ["fysiotherapie", "physiotherapie", "kliniek", "klinik", "clinic"],
    },
    { match: /gym|fitness/i, terms: ["sportschool", "fitnessstudio", "salle de sport", "gym"] },
    { match: /bike|bicycle|cycl/i, terms: ["fietsenwinkel", "fahrrad", "vélo", "bike shop"] },
    {
        match: /furniture|interior/i,
        terms: ["meubel", "möbel", "meubles", "interieur", "furniture"],
    },
    { match: /print/i, terms: ["drukkerij", "druckerei", "imprimerie", "printing"] },
    {
        match: /account|bookkeep|tax/i,
        terms: ["accountant", "administratiekantoor", "steuerberater", "expert-comptable"],
    },
    { match: /law|legal|attorney/i, terms: ["advocaten", "rechtsanwälte", "avocats", "law firm"] },
    {
        match: /real ?estate|property/i,
        terms: ["makelaar", "immobilien", "immobilier", "estate agents"],
    },
    {
        match: /car|auto|garage|dealer/i,
        terms: ["autobedrijf", "autohaus", "garage", "concessionnaire"],
    },
    { match: /hotel/i, terms: ["hotel"] },
    {
        match: /restaurant|cafe|café|catering/i,
        terms: ["restaurant", "café", "catering", "eetcafé"],
    },
    {
        match: /software|saas|tech|startup|digital|agency|it\b/i,
        terms: ["software", "digital", "tech", "agency", "bureau"],
    },
    {
        match: /manufactur|factory|producer|machin|engineering/i,
        terms: ["fabriek", "fabrik", "usine", "manufacturing", "engineering"],
    },
    {
        match: /school|education|training|academy/i,
        terms: ["school", "schule", "école", "academy", "opleiding"],
    },
];

/** Name words to search for, in the local languages, from the segment's words. */
export function nativeTermsFor(keywords: readonly string[], max = 4): string[] {
    const text = keywords.join(" ");
    const out: string[] = [];
    for (const rule of NATIVE_TERMS) {
        if (!rule.match.test(text)) continue;
        for (const t of rule.terms) if (!out.includes(t)) out.push(t);
        if (out.length >= max) break;
    }
    return out.slice(0, max);
}
