/**
 * Small geography tables the keyless sources need: country names in the
 * forms directories print them, the cities to split a country-wide
 * OpenStreetMap query into when the country is too large for one request,
 * and a rough map box per country for the place sweep.
 * Deliberately short; anything not listed falls back to the ISO code.
 */

/** A map box in degrees: west, south, east, north. */
export type Bbox = readonly [minLon: number, minLat: number, maxLon: number, maxLat: number];

export interface CountryInfo {
    /** English name as a directory prints it. */
    name: string;
    /** Other spellings seen in directory location strings. */
    aliases: string[];
    /** Largest cities, used to scope Overpass queries in big countries. */
    cities: string[];
    /** True when a country-wide Overpass query is cheap enough to run as one. */
    small: boolean;
    /**
     * Rough box around the country's main landmass, the root of the place
     * sweep. It may reach into neighbours (results are kept by country code)
     * and leaves out far-off islands and territories.
     */
    box: Bbox;
}

export const COUNTRIES: Record<string, CountryInfo> = {
    NL: {
        name: "Netherlands",
        aliases: ["the Netherlands", "Nederland", "Holland"],
        cities: ["Amsterdam", "Rotterdam", "Utrecht", "Eindhoven"],
        small: true,
        box: [3.3, 50.7, 7.25, 53.6],
    },
    BE: {
        name: "Belgium",
        aliases: ["België", "Belgique"],
        cities: ["Brussels", "Antwerp", "Ghent"],
        small: true,
        box: [2.5, 49.45, 6.45, 51.55],
    },
    LU: {
        name: "Luxembourg",
        aliases: [],
        cities: ["Luxembourg"],
        small: true,
        box: [5.7, 49.4, 6.55, 50.2],
    },
    DE: {
        name: "Germany",
        aliases: ["Deutschland"],
        cities: ["Berlin", "Hamburg", "Munich", "Cologne", "Frankfurt"],
        small: false,
        box: [5.85, 47.25, 15.05, 55.1],
    },
    AT: {
        name: "Austria",
        aliases: ["Österreich"],
        cities: ["Vienna", "Graz", "Linz"],
        small: true,
        box: [9.5, 46.35, 17.2, 49.05],
    },
    CH: {
        name: "Switzerland",
        aliases: ["Schweiz", "Suisse", "Svizzera"],
        cities: ["Zürich", "Geneva", "Basel"],
        small: true,
        box: [5.95, 45.8, 10.5, 47.85],
    },
    FR: {
        name: "France",
        aliases: [],
        cities: ["Paris", "Lyon", "Marseille", "Toulouse"],
        small: false,
        box: [-5.15, 41.3, 9.6, 51.1],
    },
    GB: {
        name: "United Kingdom",
        aliases: ["UK", "England", "Scotland", "Wales", "Great Britain"],
        cities: ["London", "Manchester", "Birmingham", "Leeds", "Glasgow"],
        small: false,
        box: [-8.65, 49.85, 1.8, 60.9],
    },
    IE: {
        name: "Ireland",
        aliases: [],
        cities: ["Dublin", "Cork"],
        small: true,
        box: [-10.7, 51.3, -5.9, 55.5],
    },
    ES: {
        name: "Spain",
        aliases: ["España"],
        cities: ["Madrid", "Barcelona", "Valencia", "Seville"],
        small: false,
        box: [-9.35, 35.9, 4.35, 43.8],
    },
    PT: {
        name: "Portugal",
        aliases: [],
        cities: ["Lisbon", "Porto"],
        small: true,
        box: [-9.55, 36.95, -6.15, 42.2],
    },
    IT: {
        name: "Italy",
        aliases: ["Italia"],
        cities: ["Milan", "Rome", "Turin", "Bologna"],
        small: false,
        box: [6.6, 35.45, 18.55, 47.1],
    },
    DK: {
        name: "Denmark",
        aliases: ["Danmark"],
        cities: ["Copenhagen", "Aarhus"],
        small: true,
        box: [8.0, 54.5, 15.3, 57.8],
    },
    SE: {
        name: "Sweden",
        aliases: ["Sverige"],
        cities: ["Stockholm", "Gothenburg", "Malmö"],
        small: true,
        box: [11.1, 55.3, 24.2, 69.1],
    },
    NO: {
        name: "Norway",
        aliases: ["Norge"],
        cities: ["Oslo", "Bergen"],
        small: true,
        box: [4.5, 57.95, 31.2, 71.2],
    },
    FI: {
        name: "Finland",
        aliases: ["Suomi"],
        cities: ["Helsinki", "Tampere"],
        small: true,
        box: [19.3, 59.7, 31.6, 70.1],
    },
    PL: {
        name: "Poland",
        aliases: ["Polska"],
        cities: ["Warsaw", "Kraków", "Wrocław"],
        small: false,
        box: [14.1, 49.0, 24.15, 54.85],
    },
    CZ: {
        name: "Czechia",
        aliases: ["Czech Republic"],
        cities: ["Prague", "Brno"],
        small: true,
        box: [12.05, 48.55, 18.9, 51.1],
    },
    US: {
        name: "United States",
        aliases: ["USA", "United States of America", "US"],
        cities: ["New York", "Los Angeles", "Chicago", "Houston", "San Francisco"],
        small: false,
        box: [-124.85, 24.4, -66.85, 49.4],
    },
    CA: {
        name: "Canada",
        aliases: [],
        cities: ["Toronto", "Vancouver", "Montreal"],
        small: false,
        box: [-141.0, 41.65, -52.6, 70.0],
    },
    AU: {
        name: "Australia",
        aliases: [],
        cities: ["Sydney", "Melbourne", "Brisbane"],
        small: false,
        box: [112.9, -43.75, 153.65, -10.05],
    },
    NZ: {
        name: "New Zealand",
        aliases: [],
        cities: ["Auckland", "Wellington"],
        small: true,
        box: [166.4, -47.3, 178.6, -34.35],
    },
    JP: {
        name: "Japan",
        aliases: [],
        cities: ["Tokyo", "Osaka"],
        small: false,
        box: [128.5, 30.9, 145.85, 45.55],
    },
    SG: {
        name: "Singapore",
        aliases: [],
        cities: ["Singapore"],
        small: true,
        box: [103.6, 1.15, 104.1, 1.48],
    },
    IN: {
        name: "India",
        aliases: [],
        cities: ["Mumbai", "Bengaluru", "Delhi"],
        small: false,
        box: [68.1, 6.75, 97.4, 35.5],
    },
    BR: {
        name: "Brazil",
        aliases: ["Brasil"],
        cities: ["São Paulo", "Rio de Janeiro"],
        small: false,
        box: [-74.0, -33.75, -34.75, 5.3],
    },
    MX: {
        name: "Mexico",
        aliases: ["México"],
        cities: ["Mexico City", "Guadalajara", "Monterrey"],
        small: false,
        box: [-118.4, 14.5, -86.7, 32.75],
    },
};

export function countryName(code: string): string {
    return COUNTRIES[code.toUpperCase()]?.name ?? code.toUpperCase();
}

/** The country's sweep box, or null for a country the table does not list. */
export function countryBox(code: string): Bbox | null {
    return COUNTRIES[code.toUpperCase()]?.box ?? null;
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

/**
 * Can one OpenStreetMap area stand for the whole territory? True for a named
 * region and for a country small enough to ask as one; false for a large
 * country, where `overpassAreas` names its largest cities only.
 */
export function oneAreaCoversTerritory(country: string, region?: string | null): boolean {
    if (region) return true;
    const info = COUNTRIES[country.toUpperCase()];
    return !info || info.small;
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
