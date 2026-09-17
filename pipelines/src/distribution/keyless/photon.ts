/**
 * Photon (komoot's public OpenStreetMap geocoder) plus the OSM API: the
 * reliable keyless route to the same places Overpass would find. Photon
 * answers category-filtered searches in a second or two even when the
 * shared Overpass servers are overloaded; it returns OSM ids but not
 * website tags, so the tags are fetched afterwards from the OSM API in one
 * multi-fetch call per element type. No key on either side.
 *
 * Photon ranks by text match and ignores location unless boxed, so every
 * search is confined to a bounding box around a city centre.
 */
import { COUNTRIES, countryName } from "./geo";
import { KEYLESS_USER_AGENT, type OsmPlace } from "./osm";

export const PHOTON_URL = "https://photon.komoot.io/api/";
export const OSM_API_URL = "https://api.openstreetmap.org/api/0.6";

interface PhotonFeature {
    geometry?: { coordinates?: [number, number] };
    properties: {
        osm_type?: "N" | "W" | "R";
        osm_id?: number;
        osm_key?: string;
        osm_value?: string;
        name?: string;
        city?: string;
        countrycode?: string;
        street?: string;
        housenumber?: string;
        postcode?: string;
    };
}

interface OsmElement {
    type: "node" | "way" | "relation";
    id: number;
    lat?: number;
    lon?: number;
    tags?: Record<string, string>;
}

export interface PhotonClientOptions {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    photonUrl?: string;
    osmApiUrl?: string;
}

/** `["shop"="coffee"]` → `shop:coffee`; selectors without an exact value are skipped. */
export function photonTagsFor(selectors: readonly string[]): string[] {
    const out: string[] = [];
    for (const s of selectors) {
        const m = /^\["([^"]+)"="([^"]+)"\]$/.exec(s);
        if (m && !out.includes(`${m[1]}:${m[2]}`)) out.push(`${m[1]}:${m[2]}`);
    }
    return out;
}

/** Cities to box searches into: the region if given, else the country's top three. */
export function photonAreas(country: string, region?: string | null): string[] {
    if (region) return [region];
    return COUNTRIES[country.toUpperCase()]?.cities.slice(0, 3) ?? [country.toUpperCase()];
}

async function getJson<T>(url: string, options: PhotonClientOptions): Promise<T> {
    const response = await (options.fetchImpl ?? fetch)(url, {
        headers: { "User-Agent": KEYLESS_USER_AGENT, Accept: "application/json" },
        signal: options.signal,
    });
    if (!response.ok) throw new Error(`${new URL(url).host} ${response.status}`);
    return (await response.json()) as T;
}

/** The centre of a city for the bounding box; null when Photon cannot place it in the country. */
export async function locateCity(
    city: string,
    country: string,
    options: PhotonClientOptions
): Promise<{ lat: number; lon: number } | null> {
    const params = new URLSearchParams({ q: `${city}, ${countryName(country)}`, limit: "5" });
    const json = await getJson<{ features: PhotonFeature[] }>(
        `${options.photonUrl ?? PHOTON_URL}?${params.toString()}`,
        options
    );
    const hit = json.features.find(
        f =>
            (f.properties.countrycode ?? "").toUpperCase() === country.toUpperCase() &&
            f.geometry?.coordinates &&
            (f.properties.osm_key === "place" || f.properties.osm_key === "boundary")
    );
    const coords = hit?.geometry?.coordinates;
    if (!coords) return null;
    return { lat: coords[1], lon: coords[0] };
}

export interface PhotonRequest {
    country: string;
    region?: string | null;
    keywords: readonly string[];
    /** Overpass-style selectors; converted to Photon osm_tag filters. */
    selectors?: readonly string[];
    limit?: number;
}

const BOX_LON = 0.35;
const BOX_LAT = 0.25;

/**
 * Category-filtered search inside a box around each city, then tags from
 * the OSM API. Only elements in the requested country with a website survive.
 */
export async function searchPhoton(
    req: PhotonRequest,
    options: PhotonClientOptions = {}
): Promise<OsmPlace[]> {
    const limit = req.limit ?? 40;
    const tags = photonTagsFor(req.selectors ?? []).slice(0, 3);
    const words = req.keywords.filter(w => w.length >= 3).slice(0, 2);
    const found = new Map<string, { feature: PhotonFeature; city: string }>();

    for (const city of photonAreas(req.country, req.region ?? null)) {
        if (options.signal?.aborted) break;
        const centre = await locateCity(city, req.country, options).catch(() => null);
        if (!centre) continue;
        const bbox = [
            centre.lon - BOX_LON,
            centre.lat - BOX_LAT,
            centre.lon + BOX_LON,
            centre.lat + BOX_LAT,
        ]
            .map(n => n.toFixed(4))
            .join(",");
        const searches: Array<{ tag: string | null; q: string }> = [
            ...tags.map(tag => ({ tag, q: tag.split(":")[1]!.replace(/_/g, " ") })),
            ...words.map(q => ({ tag: null, q })),
        ];
        for (const search of searches) {
            const params = new URLSearchParams({ q: search.q, limit: "50", lang: "en", bbox });
            if (search.tag) params.append("osm_tag", search.tag);
            let json: { features: PhotonFeature[] };
            try {
                json = await getJson<{ features: PhotonFeature[] }>(
                    `${options.photonUrl ?? PHOTON_URL}?${params.toString()}`,
                    options
                );
            } catch {
                continue;
            }
            for (const f of json.features) {
                const p = f.properties;
                if (!p.osm_id || !p.osm_type || !p.name) continue;
                if ((p.countrycode ?? "").toUpperCase() !== req.country.toUpperCase()) continue;
                const key = `${p.osm_type}${p.osm_id}`;
                if (!found.has(key)) found.set(key, { feature: f, city });
            }
        }
        if (found.size >= limit * 3) break;
    }
    if (found.size === 0) return [];

    const byType: Record<"node" | "way" | "relation", number[]> = {
        node: [],
        way: [],
        relation: [],
    };
    for (const { feature } of found.values()) {
        const p = feature.properties;
        const type = p.osm_type === "N" ? "node" : p.osm_type === "W" ? "way" : "relation";
        byType[type].push(p.osm_id!);
    }
    const elements: OsmElement[] = [];
    for (const type of ["node", "way", "relation"] as const) {
        const ids = byType[type];
        for (let i = 0; i < ids.length; i += 100) {
            const chunk = ids.slice(i, i + 100);
            try {
                const json = await getJson<{ elements: OsmElement[] }>(
                    `${options.osmApiUrl ?? OSM_API_URL}/${type}s.json?${type}s=${chunk.join(",")}`,
                    options
                );
                elements.push(...json.elements);
            } catch {
                /* a missing chunk only loses those places */
            }
        }
    }

    const categoryKeys = [
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
    const places: OsmPlace[] = [];
    const seenSites = new Set<string>();
    for (const el of elements) {
        const tags = el.tags ?? {};
        const rawSite = tags.website ?? tags["contact:website"];
        const name = tags.name?.trim();
        if (!rawSite || !name) continue;
        let website: string | null = null;
        try {
            const first = rawSite.split(/[;\s]+/)[0]!;
            const u = new URL(/^https?:\/\//i.test(first) ? first : `https://${first}`);
            website = u.hostname.includes(".") ? u.href : null;
        } catch {
            website = null;
        }
        if (!website || seenSites.has(website)) continue;
        seenSites.add(website);
        const key = `${el.type === "node" ? "N" : el.type === "way" ? "W" : "R"}${el.id}`;
        const origin = found.get(key);
        const coords = origin?.feature.geometry?.coordinates;
        const lat = el.lat ?? coords?.[1];
        const lng = el.lon ?? coords?.[0];
        if (lat === undefined || lng === undefined) continue;
        const props = origin?.feature.properties;
        const address = [
            [tags["addr:street"] ?? props?.street, tags["addr:housenumber"] ?? props?.housenumber]
                .filter(Boolean)
                .join(" "),
            tags["addr:postcode"] ?? props?.postcode,
            tags["addr:city"] ?? props?.city,
        ]
            .filter(Boolean)
            .join(", ");
        places.push({
            id: `osm:${el.type}/${el.id}`,
            name,
            website,
            address: address || (origin?.city ?? req.country),
            lat,
            lng,
            categories: categoryKeys.filter(k => tags[k]).map(k => `${k}=${tags[k]}`),
            country: req.country.toUpperCase(),
            city: tags["addr:city"] ?? props?.city ?? origin?.city ?? null,
        });
        if (places.length >= limit) break;
    }
    return places;
}
