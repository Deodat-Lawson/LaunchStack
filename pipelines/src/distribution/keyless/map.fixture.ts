/**
 * A pretend OpenStreetMap for tests: Photon with its page of 50 and its
 * name-prefix matching, the OSM API's tag lookup, and an Overpass that can be
 * told to answer or not. Every request is counted, so a test can say how many
 * were sent and whether any was sent twice. Nothing here touches the network.
 */
import { createHostThrottle, type HostThrottle } from "./throttle";

export interface FakePlace {
    type: "N" | "W";
    id: number;
    name: string;
    lon: number;
    lat: number;
    /** "shop:bicycle". */
    tag: string;
    country: string;
    website?: string;
    /** Carries the site under `contact:website` instead of `website`. */
    contactWebsite?: string;
    city?: string;
}

export interface FakeMapOptions {
    /** What an Overpass instance does: answer with every place, or fail with this status. */
    overpass?: "answers" | 504 | 429 | "empty";
    /** Per instance host, overriding `overpass`. */
    overpassByHost?: Record<string, "answers" | 504 | 429 | "empty">;
    /** Photon requests (by full URL) that fail with a 503. */
    photonFails?: (url: string) => boolean;
    /** OSM API requests that fail. */
    osmApiFails?: (url: string) => boolean;
    /** Where Photon places a city asked for by name: "Hamburg" → its centre. */
    cities?: Record<string, { lon: number; lat: number; country: string }>;
}

export interface FakeMap {
    fetchImpl: typeof fetch;
    /** Every request in order: "photon <url>", "osmapi <url>", "overpass <host>", "nominatim <url>". */
    calls: string[];
    count(kind: "photon" | "osmapi" | "overpass" | "nominatim"): number;
    /** Photon place searches only (not city lookups), as full URLs. */
    sweepUrls(): string[];
    /** The Overpass queries received. */
    overpassQueries: string[];
    options: FakeMapOptions;
}

const fold = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const words = (name: string) =>
    fold(name)
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
const urlOf = (input: Parameters<typeof fetch>[0]): string =>
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });

export function createFakeMap(places: readonly FakePlace[], options: FakeMapOptions = {}): FakeMap {
    const calls: string[] = [];
    const overpassQueries: string[] = [];
    const tagsOf = (p: FakePlace): Record<string, string> => {
        const [key, value] = p.tag.split(":");
        return {
            name: p.name,
            [key!]: value!,
            ...(p.website ? { website: p.website } : {}),
            ...(p.contactWebsite ? { "contact:website": p.contactWebsite } : {}),
            ...(p.city ? { "addr:city": p.city } : {}),
        };
    };
    const fetchImpl: typeof fetch = (input, init) => {
        const url = new URL(urlOf(input));
        const host = url.hostname;
        if (host === "photon.komoot.io") {
            calls.push(`photon ${url.href}`);
            if (options.photonFails?.(url.href))
                return Promise.resolve(new Response("busy", { status: 503 }));
            const q = url.searchParams.get("q") ?? "";
            const tag = url.searchParams.get("osm_tag");
            const bbox = url.searchParams.get("bbox")?.split(",").map(Number);
            // A city lookup: "Hamburg, Germany", no box.
            if (!bbox) {
                const city = options.cities?.[q.split(",")[0]!.trim()];
                return Promise.resolve(
                    json({
                        features: city
                            ? [
                                  {
                                      geometry: { coordinates: [city.lon, city.lat] },
                                      properties: {
                                          osm_key: "place",
                                          osm_value: "city",
                                          countrycode: city.country,
                                          name: q.split(",")[0],
                                      },
                                  },
                              ]
                            : [],
                    })
                );
            }
            const wanted = words(q);
            const limit = Number(url.searchParams.get("limit") ?? "15");
            const matches = places.filter(
                p =>
                    (!tag || p.tag === tag) &&
                    p.lon >= bbox[0]! &&
                    p.lon <= bbox[2]! &&
                    p.lat >= bbox[1]! &&
                    p.lat <= bbox[3]! &&
                    wanted.every(w => words(p.name).some(n => n.startsWith(w)))
            );
            return Promise.resolve(
                json({
                    features: matches.slice(0, limit).map(p => ({
                        geometry: { coordinates: [p.lon, p.lat] },
                        properties: {
                            osm_type: p.type,
                            osm_id: p.id,
                            osm_key: p.tag.split(":")[0],
                            osm_value: p.tag.split(":")[1],
                            name: p.name,
                            countrycode: p.country,
                            ...(p.city ? { city: p.city } : {}),
                        },
                    })),
                })
            );
        }
        if (host === "api.openstreetmap.org") {
            calls.push(`osmapi ${url.href}`);
            if (options.osmApiFails?.(url.href))
                return Promise.resolve(new Response("gone", { status: 404 }));
            const type = url.pathname.includes("/nodes") ? "N" : "W";
            const ids = (url.searchParams.get(type === "N" ? "nodes" : "ways") ?? "")
                .split(",")
                .map(Number);
            return Promise.resolve(
                json({
                    elements: places
                        .filter(p => p.type === type && ids.includes(p.id))
                        .map(p => ({
                            type: type === "N" ? "node" : "way",
                            id: p.id,
                            ...(type === "N" ? { lat: p.lat, lon: p.lon } : {}),
                            // The real API also returns who edited the element.
                            user: "a-mapper",
                            uid: 1,
                            tags: tagsOf(p),
                        })),
                })
            );
        }
        if (host === "nominatim.openstreetmap.org") {
            calls.push(`nominatim ${url.href}`);
            return Promise.resolve(json([]));
        }
        if (url.pathname.endsWith("/interpreter")) {
            calls.push(`overpass ${host}`);
            const body = init?.body instanceof URLSearchParams ? (init.body.get("data") ?? "") : "";
            overpassQueries.push(body);
            const mode = options.overpassByHost?.[host] ?? options.overpass ?? "answers";
            if (mode === "empty") return Promise.resolve(json({ elements: [] }));
            if (mode !== "answers")
                return Promise.resolve(new Response("<html>busy</html>", { status: mode }));
            const country = /"ISO3166-1"="([A-Z]{2})"/.exec(body)?.[1];
            const selectors = [...body.matchAll(/\["([a-z_]+)"="([a-z_]+)"\]\["name"\]/g)].map(
                m => `${m[1]}:${m[2]}`
            );
            return Promise.resolve(
                json({
                    elements: places
                        .filter(p => p.country === country && selectors.includes(p.tag))
                        .map(p =>
                            p.type === "N"
                                ? {
                                      type: "node",
                                      id: p.id,
                                      lat: p.lat,
                                      lon: p.lon,
                                      tags: tagsOf(p),
                                  }
                                : {
                                      type: "way",
                                      id: p.id,
                                      center: { lat: p.lat, lon: p.lon },
                                      tags: tagsOf(p),
                                  }
                        ),
                })
            );
        }
        calls.push(`other ${url.href}`);
        return Promise.resolve(new Response("not found", { status: 404 }));
    };
    return {
        fetchImpl,
        calls,
        overpassQueries,
        options,
        count: kind => calls.filter(c => c.startsWith(`${kind} `)).length,
        sweepUrls: () =>
            calls
                .filter(c => c.startsWith("photon ") && c.includes("bbox="))
                .map(c => c.slice("photon ".length)),
    };
}

/** A throttle that never waits: tests are about what is asked, not when. */
export const noWait: HostThrottle = createHostThrottle({ gapMs: {} });

/**
 * A made-up country's worth of places: two dense towns and a thin
 * countryside, names starting with every letter, most with a website.
 * Deterministic: the same call gives the same places.
 */
export function fakePopulation(
    count: number,
    options: {
        tag?: string;
        country?: string;
        /** West, south, east, north. */
        box?: readonly [number, number, number, number];
        firstId?: number;
    } = {}
): FakePlace[] {
    const tag = options.tag ?? "shop:bicycle";
    const country = options.country ?? "NL";
    const [west, south, east, north] = options.box ?? [3.3, 50.7, 7.25, 53.6];
    const firstId = options.firstId ?? 1;
    // A small linear congruential generator: stable across platforms.
    let seed = 12345 + count;
    const random = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    };
    const firsts = ["Alfa", "Brug", "Café", "Dijk", "Élan", "Fiets", "Groen", "Huis", "Rijwiel"];
    const seconds = ["Noord", "Oost", "Plein", "Station", "Tweewielers", "Veld", "Zuid"];
    const towns = [
        { lon: west + (east - west) * 0.3, lat: south + (north - south) * 0.4 },
        { lon: west + (east - west) * 0.7, lat: south + (north - south) * 0.75 },
    ];
    const places: FakePlace[] = [];
    for (let i = 0; i < count; i++) {
        const inTown = random() < 0.7;
        const town = towns[i % towns.length]!;
        const lon = inTown ? town.lon + (random() - 0.5) * 0.2 : west + random() * (east - west);
        const lat = inTown
            ? town.lat + (random() - 0.5) * 0.15
            : south + random() * (north - south);
        const id = firstId + i;
        const name = `${firsts[Math.floor(random() * firsts.length)]} ${seconds[Math.floor(random() * seconds.length)]} ${id}`;
        const site = random();
        places.push({
            type: i % 9 === 0 ? "W" : "N",
            id,
            name,
            lon,
            lat,
            tag,
            country,
            ...(site < 0.55
                ? { website: `https://place-${id}.example/` }
                : site < 0.65
                  ? { contactWebsite: `place-${id}.example` }
                  : {}),
        });
    }
    return places;
}
