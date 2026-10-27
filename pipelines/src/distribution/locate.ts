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
import { countriesMentioned, countryAliases } from "./keyless/geo";
import type { Territory } from "./types";

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
 * The location a result's own words give. The wanted territory
 * only breaks ties: when the text names several countries and one is the
 * wanted one, that one; the wanted region counts only when the text names it.
 */
export function locateFromEvidence(text: string, wanted: Territory): SeenLocation {
    const countries = countriesMentioned(text);
    const country = countries.includes(wanted.country) ? wanted.country : (countries[0] ?? null);
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
