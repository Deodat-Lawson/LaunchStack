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
