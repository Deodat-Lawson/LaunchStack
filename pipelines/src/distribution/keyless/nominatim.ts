/**
 * Nominatim, OpenStreetMap's public geocoder, as a second keyless place
 * source. It matches names rather than categories, so it finds the
 * organisations whose names contain the segment's words ("koffiebranderij",
 * "fulfilment", "bakery"), with the same website tags Overpass would return
 * but from a different, lighter service. Usage policy: one request per
 * second, a User-Agent, small volumes — which is what this adapter does.
 */
import { countryName } from "./geo";
import { KEYLESS_USER_AGENT, type OsmPlace } from "./osm";

export const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

interface NominatimResult {
    osm_type?: string;
    osm_id?: number;
    name?: string;
    display_name?: string;
    lat?: string;
    lon?: string;
    type?: string;
    category?: string;
    class?: string;
    extratags?: Record<string, string> | null;
    address?: Record<string, string> | null;
}

export function mapNominatimResults(
    results: NominatimResult[],
    area: { country: string; city: string | null }
): OsmPlace[] {
    const out: OsmPlace[] = [];
    const seen = new Set<string>();
    for (const r of results) {
        const trimmed = r.name?.trim();
        const name = trimmed?.length ? trimmed : r.display_name?.split(",")[0]?.trim();
        const site = r.extratags?.website ?? r.extratags?.["contact:website"];
        const lat = Number(r.lat);
        const lng = Number(r.lon);
        if (!name || !site || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        let website: string | null = null;
        try {
            const u = new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`);
            website = u.hostname.includes(".") ? u.href : null;
        } catch {
            website = null;
        }
        if (!website || seen.has(website)) continue;
        seen.add(website);
        const kind = r.category ?? r.class;
        const addr = r.address ?? {};
        out.push({
            id: `osm:${r.osm_type ?? "node"}/${r.osm_id ?? 0}`,
            name,
            website,
            address:
                [addr.road, addr.house_number].filter(Boolean).join(" ") +
                    ((addr.city ?? addr.town ?? addr.village)
                        ? `, ${addr.city ?? addr.town ?? addr.village}`
                        : "") ||
                (area.city ?? area.country),
            lat,
            lng,
            categories: kind && r.type ? [`${kind}=${r.type}`] : [],
            country: area.country,
            city: addr.city ?? addr.town ?? area.city,
        });
    }
    return out;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function searchNominatim(
    req: {
        country: string;
        areas: Array<{ country: string; city: string | null }>;
        keywords: readonly string[];
        limit?: number;
    },
    options: { fetchImpl?: typeof fetch; signal?: AbortSignal; url?: string; pauseMs?: number } = {}
): Promise<OsmPlace[]> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const places: OsmPlace[] = [];
    let first = true;
    for (const area of req.areas) {
        if (options.signal?.aborted) break;
        if (!first) await sleep(options.pauseMs ?? 1100);
        first = false;
        const q = `${req.keywords.join(" ")} ${area.city ?? countryName(area.country)}`.trim();
        const params = new URLSearchParams({
            q,
            format: "jsonv2",
            extratags: "1",
            addressdetails: "1",
            countrycodes: area.country.toLowerCase(),
            limit: String(Math.min(50, req.limit ?? 40)),
        });
        const response = await fetchImpl(`${options.url ?? NOMINATIM_URL}?${params.toString()}`, {
            headers: { "User-Agent": KEYLESS_USER_AGENT, Accept: "application/json" },
            signal: options.signal,
        });
        if (!response.ok) throw new Error(`Nominatim ${response.status} for ${q}`);
        const json = (await response.json()) as NominatimResult[];
        for (const p of mapNominatimResults(json, area))
            if (!places.some(x => x.website === p.website)) places.push(p);
        if (places.length >= (req.limit ?? 40)) break;
    }
    return places.slice(0, req.limit ?? 40);
}
