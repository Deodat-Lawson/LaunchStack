/**
 * Places as people write them, resolved by OpenStreetMap's geocoder
 * (Nominatim) instead of any list of codes. Used when a segment is created
 * and to read the company's headquarters.
 */
import { NOMINATIM_URL } from "./keyless/nominatim";
import { KEYLESS_USER_AGENT } from "./keyless/osm";

interface GeocodeHit {
    addresstype?: string;
    address?: Record<string, string> | null;
}

/** Address parts that name a place a segment can target, most specific first. */
const PLACE_PARTS = ["city", "town", "village", "municipality", "county", "state"] as const;

/**
 * A place as people write it ("Baltimore, MD", "Wilmington, DE", "Amsterdam")
 * as a territory, from OpenStreetMap's geocoder rather than from any list of
 * codes: its answer says the country, and the city (or county, or state)
 * when the text named one. `homeCountry` breaks ties for a bare city name.
 * Null when the geocoder finds nothing or cannot be reached.
 */
export async function geocodePlace(
    text: string,
    options: {
        homeCountry?: string | null;
        fetchImpl?: typeof fetch;
        signal?: AbortSignal;
        url?: string;
    } = {}
): Promise<{ country: string; region?: string } | null> {
    const q = text.trim();
    if (!q) return null;
    const fetchImpl = options.fetchImpl ?? fetch;
    const ask = async (countrycodes?: string) => {
        const params = new URLSearchParams({
            q,
            format: "jsonv2",
            addressdetails: "1",
            limit: "1",
        });
        if (countrycodes) params.set("countrycodes", countrycodes);
        const response = await fetchImpl(`${options.url ?? NOMINATIM_URL}?${params.toString()}`, {
            headers: { "User-Agent": KEYLESS_USER_AGENT, Accept: "application/json" },
            signal: options.signal,
        });
        if (!response.ok) throw new Error(`Nominatim ${response.status} for ${q}`);
        return ((await response.json()) as GeocodeHit[])[0] ?? null;
    };
    try {
        // A bare city in the company's own country first ("Austin" from a US
        // company), then anywhere ("Austin, Texas", "Hamburg, Germany").
        const home = options.homeCountry?.toLowerCase();
        const hit = (!q.includes(",") && home ? await ask(home) : null) ?? (await ask());
        const code = hit?.address?.country_code?.toUpperCase();
        if (!hit || !code) return null;
        if (hit.addresstype === "country") return { country: code };
        const address = hit.address ?? {};
        const region = PLACE_PARTS.map(p => address[p]).find(Boolean);
        return region ? { country: code, region } : { country: code };
    } catch (error) {
        console.warn(`[distribution] could not geocode "${q}":`, error);
        return null;
    }
}
