/**
 * Where the sites come from: three free, keyless directories, read through
 * the recorder. Each returns an ordered list of candidate sites; the sample
 * is the first N of each list whose homepage is readable.
 *
 *  - Norway: the Brreg register of legal entities (website and staff count).
 *  - Netherlands and Germany: OpenStreetMap places with a website, through
 *    production's own `searchPhoton`.
 *  - English-language B2B: the public YC company directory.
 */
import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { searchPhoton } from "../../../src/distribution/keyless/photon";
import {
    NotRecordedError,
    failOnUnrecorded,
    type RecordedExchange,
    type Recorder,
} from "../lib/recorder";
import { createRng, hashSeed } from "../lib/rng";
import { bareHost } from "./html";

export type GroupId = "no" | "nlde" | "en";

export const GROUPS: Array<{ id: GroupId; label: string }> = [
    { id: "no", label: "Norway (Brreg register)" },
    { id: "nlde", label: "Netherlands and Germany (OpenStreetMap)" },
    { id: "en", label: "English-language B2B (YC directory)" },
];

export interface Candidate {
    group: GroupId;
    /** NO, NL, DE or EN. */
    country: string;
    /** Sub-list the candidate came from (a NACE code, a country, "yc"). */
    stratum: string;
    host: string;
    /** The organisation's name, only ever passed to production's extractFacts. */
    name: string;
}

/**
 * Hosts that are somebody else's platform, not the company's own site:
 * social networks, link hubs, marketplaces, directories and app stores.
 */
const HUB_HOSTS = [
    "facebook.com",
    "fb.com",
    "fb.me",
    "instagram.com",
    "linkedin.com",
    "twitter.com",
    "x.com",
    "youtube.com",
    "youtu.be",
    "tiktok.com",
    "pinterest.com",
    "snapchat.com",
    "threads.net",
    "wa.me",
    "whatsapp.com",
    "t.me",
    "telegram.me",
    "discord.gg",
    "discord.com",
    "linktr.ee",
    "linkin.bio",
    "bio.link",
    "beacons.ai",
    "campsite.bio",
    "taplink.cc",
    "lnk.bio",
    "carrd.co",
    "about.me",
    "flow.page",
    "google.com",
    "g.page",
    "goo.gl",
    "business.site",
    "bit.ly",
    "tinyurl.com",
    "apple.com",
    "github.com",
    "github.io",
    "medium.com",
    "substack.com",
    "notion.site",
    "notion.so",
    "calendly.com",
    "typeform.com",
    "yelp.com",
    "tripadvisor.com",
    "booking.com",
    "thuisbezorgd.nl",
    "lieferando.de",
    "ubereats.com",
    "just-eat.no",
    "foodora.no",
    "etsy.com",
    "amazon.com",
    "amazon.de",
    "amazon.nl",
    "ebay.com",
    "ebay.de",
    "marktplaats.nl",
    "finn.no",
    "proff.no",
    "1881.no",
    "gulesider.no",
    "wikipedia.org",
];

export function isHubHost(host: string): boolean {
    const bare = bareHost(host);
    return HUB_HOSTS.some(hub => bare === hub || bare.endsWith(`.${hub}`));
}

/** The host of a website as a directory writes it ("www.x.no", "http://x.de/shop"). */
export function hostOf(website: string): string | null {
    const raw = website.trim().split(/[;,\s]+/)[0] ?? "";
    if (!raw) return null;
    try {
        const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
        const host = url.hostname.toLowerCase();
        return host.includes(".") && !/[^a-z0-9.-]/.test(host) ? host : null;
    } catch {
        return null;
    }
}

function seededShuffle<T>(items: readonly T[], label: string): T[] {
    return createRng(hashSeed(`e3:sample:${label}`)).shuffle(items);
}

/** a1, b1, c1, a2, b2, … so no one sub-list fills the sample alone. */
function roundRobin<T>(lists: readonly T[][]): T[] {
    const out: T[] = [];
    const longest = Math.max(0, ...lists.map(list => list.length));
    for (let i = 0; i < longest; i++) {
        for (const list of lists) {
            const item = list[i];
            if (item !== undefined) out.push(item);
        }
    }
    return out;
}

// ─── Norway ──────────────────────────────────────────────────────────────────

/**
 * NACE codes (SN2025): tea and coffee processing, brewing, wholesale of
 * coffee, tea, cocoa and spices, architecture, programming. 62.010 from the
 * older standard returns nothing any more; 62.100 is its successor.
 */
export const BRREG_CODES = ["10.830", "11.050", "46.370", "71.110", "62.100"];
/** Register entries with fewer employees are left out by the register itself. */
export const BRREG_MIN_STAFF = 5;

interface BrregUnit {
    navn?: string;
    hjemmeside?: string;
    antallAnsatte?: number;
    organisasjonsform?: { kode?: string };
    konkurs?: boolean;
    underAvvikling?: boolean;
    underTvangsavviklingEllerTvangsopplosning?: boolean;
}

interface BrregPage {
    _embedded?: { enheter?: BrregUnit[] };
}

export function brregUrl(code: string, page: number): string {
    return `https://data.brreg.no/enhetsregisteret/api/enheter?naeringskode=${code}&fraAntallAnsatte=${BRREG_MIN_STAFF}&size=100&page=${page}`;
}

async function norway(recorder: Recorder): Promise<Candidate[]> {
    const lists: Candidate[][] = [];
    for (const code of BRREG_CODES) {
        const json = await recorder.getJson<BrregPage>(brregUrl(code, 0));
        const list: Candidate[] = [];
        for (const unit of json._embedded?.enheter ?? []) {
            if (unit.konkurs || unit.underAvvikling) continue;
            if (unit.underTvangsavviklingEllerTvangsopplosning) continue;
            // Sole proprietorships carry a person's name; companies only.
            if (unit.organisasjonsform?.kode === "ENK") continue;
            if ((unit.antallAnsatte ?? 0) < BRREG_MIN_STAFF) continue;
            const host = unit.hjemmeside ? hostOf(unit.hjemmeside) : null;
            if (!host) continue;
            list.push({ group: "no", country: "NO", stratum: code, host, name: unit.navn ?? host });
        }
        lists.push(seededShuffle(list, `no:${code}`));
    }
    return roundRobin(lists);
}

// ─── Netherlands and Germany ─────────────────────────────────────────────────

export const PHOTON_CITIES: Record<"NL" | "DE", string[]> = {
    NL: ["Amsterdam", "Rotterdam", "Utrecht", "Eindhoven"],
    DE: ["Berlin", "Hamburg", "Munich", "Cologne"],
};
/** OpenStreetMap tags, as production's Overpass-style selectors. */
export const PHOTON_SELECTORS = [
    '["craft"="brewery"]',
    '["shop"="coffee"]',
    '["office"="company"]',
];
/** Name words production's native-term list uses for wholesalers, bakeries, brewers and roasters. */
export const PHOTON_WORDS: Record<"NL" | "DE", string[][]> = {
    NL: [
        ["groothandel", "bakkerij"],
        ["brouwerij", "koffiebranderij"],
    ],
    DE: [
        ["großhandel", "bäckerei"],
        ["brauerei", "kaffeerösterei"],
    ],
};

async function lowlandsAndGermany(fetchImpl: typeof fetch): Promise<Candidate[]> {
    const lists: Candidate[][] = [];
    for (const country of ["NL", "DE"] as const) {
        const list: Candidate[] = [];
        for (const city of PHOTON_CITIES[country]) {
            for (const [index, words] of PHOTON_WORDS[country].entries()) {
                const places = await searchPhoton(
                    {
                        country,
                        region: city,
                        keywords: words,
                        // The tag searches run once per city, with the first word pair.
                        selectors: index === 0 ? PHOTON_SELECTORS : [],
                        limit: 100,
                    },
                    { fetchImpl }
                );
                for (const place of places) {
                    const host = place.website ? hostOf(place.website) : null;
                    if (!host) continue;
                    list.push({ group: "nlde", country, stratum: country, host, name: place.name });
                }
            }
        }
        lists.push(seededShuffle(list, `nlde:${country}`));
    }
    return roundRobin(lists);
}

// ─── English-language B2B ────────────────────────────────────────────────────

export const YC_URL = "https://yc-oss.github.io/api/companies/all.json";
const YC_REGIONS = ["United States of America", "United Kingdom", "Canada"];

interface YcCompany {
    name?: string;
    website?: string;
    status?: string;
    industry?: string;
    regions?: string[];
}

async function english(recorder: Recorder): Promise<Candidate[]> {
    const all = await recorder.getJson<YcCompany[]>(YC_URL);
    const list: Candidate[] = [];
    for (const company of all) {
        if (company.status !== "Active" || company.industry !== "B2B") continue;
        if (!(company.regions ?? []).some(region => YC_REGIONS.includes(region))) continue;
        const host = company.website ? hostOf(company.website) : null;
        if (!host) continue;
        list.push({ group: "en", country: "EN", stratum: "yc", host, name: company.name ?? host });
    }
    return seededShuffle(list, "en:yc");
}

// ─── all three ───────────────────────────────────────────────────────────────

export interface SourceReport {
    /** Requests to the directories, by host and HTTP status ("ERR" when none came back). */
    statuses: Record<string, number>;
    /** Directory requests that failed and stayed failed after backing off. */
    failed: number;
    listed: Record<GroupId, number>;
    /** After removing platform hosts and hosts already seen. */
    usable: Record<GroupId, number>;
}

/** Directory hosts; their failed exchanges may be dropped and asked again. */
const SOURCE_HOSTS = [
    "data.brreg.no",
    "photon.komoot.io",
    "api.openstreetmap.org",
    "yc-oss.github.io",
];

function isFailure(status: number): boolean {
    return status === 0 || status === 429 || status >= 500;
}

/**
 * Forget the failed exchanges of the directory hosts, so a later attempt asks
 * again. Company sites are never touched: there a failure is part of the world.
 */
export function forgetFailedSourceExchanges(recorder: Recorder): number {
    let dropped = 0;
    for (const host of SOURCE_HOSTS) {
        const dir = path.join(recorder.dir, host);
        if (!existsSync(dir)) continue;
        for (const file of readdirSync(dir)) {
            if (!file.endsWith(".json.gz")) continue;
            const full = path.join(dir, file);
            const exchange = JSON.parse(
                gunzipSync(readFileSync(full)).toString("utf8")
            ) as RecordedExchange;
            if (isFailure(exchange.status)) {
                unlinkSync(full);
                dropped += 1;
            }
        }
    }
    return dropped;
}

/**
 * The candidate lists of the three groups, de-duplicated by host across
 * groups. `recorder` must allow large bodies (the YC file is several MB).
 */
export async function loadCandidates(
    recorder: Recorder
): Promise<{ candidates: Record<GroupId, Candidate[]>; report: SourceReport }> {
    const statuses = new Map<string, number>();
    let failed = 0;
    const note = (url: string, status: number | "ERR") => {
        let host = "unknown";
        try {
            host = new URL(url).hostname;
        } catch {
            /* keep "unknown" */
        }
        const key = `${host} ${status}`;
        statuses.set(key, (statuses.get(key) ?? 0) + 1);
        if (status === "ERR" || isFailure(status)) failed += 1;
    };
    // Production's Photon search catches every fetch error and returns what it
    // has. A request that is missing from the recording is not a failed
    // request: it is checked for once the search returns, and stops the run.
    const strict = failOnUnrecorded(recorder.fetchImpl);
    const fetchImpl: typeof fetch = async (input, init) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        try {
            const response = await strict.fetchImpl(input, init);
            note(url, response.status);
            return response;
        } catch (error) {
            if (!(error instanceof NotRecordedError)) note(url, "ERR");
            throw error;
        }
    };

    const raw: Record<GroupId, Candidate[]> = {
        no: await norway(recorder),
        nlde: await lowlandsAndGermany(fetchImpl),
        en: await english(recorder),
    };
    strict.assertAllRecorded();
    const seen = new Set<string>();
    const candidates: Record<GroupId, Candidate[]> = { no: [], nlde: [], en: [] };
    for (const group of GROUPS) {
        for (const candidate of raw[group.id]) {
            const key = bareHost(candidate.host);
            if (isHubHost(candidate.host) || seen.has(key)) continue;
            seen.add(key);
            candidates[group.id].push(candidate);
        }
    }
    return {
        candidates,
        report: {
            statuses: Object.fromEntries(
                [...statuses.entries()].sort(([a], [b]) => a.localeCompare(b))
            ),
            failed,
            listed: { no: raw.no.length, nlde: raw.nlde.length, en: raw.en.length },
            usable: {
                no: candidates.no.length,
                nlde: candidates.nlde.length,
                en: candidates.en.length,
            },
        },
    };
}
