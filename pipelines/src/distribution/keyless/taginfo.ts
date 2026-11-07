/**
 * OpenStreetMap's own vocabulary of places, from taginfo: the most used
 * values of the keys that describe a business (shop, craft, amenity, office)
 * with the description each one's wiki page gives. This is what a segment's
 * place categories are chosen from, by meaning — nothing here is a list we
 * wrote. Loaded once per process; when taginfo cannot be reached, there is
 * no vocabulary and searches fall back to matching names.
 */
import { KEYLESS_USER_AGENT } from "./osm";

export const TAGINFO_URL = "https://taginfo.openstreetmap.org/api/4/key/values";

/** Keys whose values name what a business is. */
export const BUSINESS_KEYS = ["shop", "craft", "amenity", "office"] as const;

export interface OsmCategory {
    /** Overpass selector, e.g. `["shop"="coffee"]`. */
    selector: string;
    /** The tag's wiki description, e.g. "A shop that sells coffee beans…". */
    description: string;
}

interface TaginfoValue {
    value?: string;
    count?: number;
    in_wiki?: boolean;
    description?: string | null;
}

export interface VocabularyOptions {
    fetchImpl?: typeof fetch;
    /** Values per key, most used first (default 150). */
    perKey?: number;
}

let cached: Promise<OsmCategory[]> | null = null;

/** One key's documented values, most used first. */
async function valuesOf(
    key: string,
    perKey: number,
    fetchImpl: typeof fetch
): Promise<OsmCategory[]> {
    const url = `${TAGINFO_URL}?key=${key}&page=1&rp=${perKey}&sortname=count_all&sortorder=desc&lang=en`;
    const response = await fetchImpl(url, { headers: { "User-Agent": KEYLESS_USER_AGENT } });
    if (!response.ok) throw new Error(`taginfo ${key}: HTTP ${response.status}`);
    const body = (await response.json()) as { data?: TaginfoValue[] };
    const out: OsmCategory[] = [];
    for (const v of body.data ?? []) {
        const value = v.value?.trim();
        const description = v.description?.trim();
        // Only documented, plain values: "yes", "no" and free text say nothing.
        if (!value || !description || !v.in_wiki || !/^[a-z0-9_]+$/.test(value)) continue;
        if (value === "yes" || value === "no") continue;
        out.push({ selector: `["${key}"="${value}"]`, description });
    }
    return out;
}

/**
 * The vocabulary, loaded once. Empty (never thrown) when taginfo is down, so
 * a run goes on with name search; the next run tries again.
 */
export function osmVocabulary(options: VocabularyOptions = {}): Promise<OsmCategory[]> {
    if (cached) return cached;
    const fetchImpl = options.fetchImpl ?? fetch;
    const perKey = options.perKey ?? 150;
    const loading = Promise.all(BUSINESS_KEYS.map(k => valuesOf(k, perKey, fetchImpl)))
        .then(lists => lists.flat())
        .catch((error: unknown) => {
            console.warn("[distribution] taginfo unreachable; searching places by name:", error);
            cached = null;
            return [];
        });
    cached = loading;
    return loading;
}

/** Forget the loaded vocabulary (tests). */
export function resetOsmVocabulary(): void {
    cached = null;
}
