/**
 * The recorded world for E2: for every search word, the first pages the
 * register's name search returned, and the true population of the target
 * industry class.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import { DEFAULT_CACHE_DIR } from "../lib/recorder";
import type { RegisterSegment } from "./segments";

export const REGISTER_URL = "https://data.brreg.no/enhetsregisteret/api/enheter";
export const PAGE_SIZE = 20;
/**
 * The format the recorder writes. 2: a word whose recording stopped at a
 * request that got no answer is listed in `cutShort`. Before that such a word
 * could not be told from one with no matches, so a replay does not accept a
 * world of an earlier format (see ../lib/worlds.ts).
 */
export const WORLD_FORMAT = 2;

export interface Company {
    /** Organisation number. */
    id: string;
    name: string;
    /** Primary NACE code, when the register has one. */
    code: string | null;
}

export interface RegisterWorld {
    /** `WORLD_FORMAT` of the recorder that wrote this world; absent before format 2. */
    format?: number;
    segment: RegisterSegment;
    /** pages[word][n] = the n-th page of the name search for that word. */
    pages: Record<string, Company[][]>;
    /** Matches the register reports for each word, over all pages. */
    totals: Record<string, number>;
    terms: {
        plan: string[];
        /** Words from target companies' names found by recorded pages. */
        mined: string[];
    };
    /** Organisation numbers of every company in the target class. */
    truth: string[];
    requests: number;
    /**
     * Words whose recording stopped at a request that got no answer (no
     * response or an HTTP error). Their recorded pages are not the whole
     * answer, so such a word is never complete. Absent in a whole recording.
     */
    cutShort?: string[];
}

export function searchUrl(term: string, page: number): string {
    const params = new URLSearchParams({ navn: term, size: String(PAGE_SIZE), page: String(page) });
    return `${REGISTER_URL}?${params.toString()}`;
}

export function classUrl(code: string, page: number): string {
    const params = new URLSearchParams({ naeringskode: code, size: "100", page: String(page) });
    return `${REGISTER_URL}?${params.toString()}`;
}

/** Name words: lower-case, split on anything that is not a letter or digit. */
export function nameTokens(name: string): string[] {
    return name
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean);
}

function worldFile(segmentId: string): string {
    return path.join(DEFAULT_CACHE_DIR, "e2-worlds", `${segmentId}.json.gz`);
}

export function saveWorld(world: RegisterWorld): void {
    const file = worldFile(world.segment.id);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, gzipSync(Buffer.from(JSON.stringify(world), "utf8")));
}

export function loadWorld(segmentId: string): RegisterWorld | null {
    const file = worldFile(segmentId);
    if (!existsSync(file)) return null;
    return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as RegisterWorld;
}

/** True when the world was written by the current recorder. */
export function isCurrentWorld(world: RegisterWorld): boolean {
    return world.format === WORLD_FORMAT;
}
