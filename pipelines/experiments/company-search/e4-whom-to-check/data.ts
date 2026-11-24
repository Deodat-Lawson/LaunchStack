/**
 * The pools: fetched through the recorder, turned into the text a policy may
 * read and the label it may not.
 *
 * A company's text is built with production's `companyText`, from its name
 * and its own description only. Tags, industries and register codes never
 * reach the text: they are the hidden labels.
 *
 * Register records can hold names of people and contact details. Nothing here
 * prints or returns a row; callers get texts for the local embedder, labels,
 * and counts.
 */
import { createHash } from "node:crypto";

import { companyText } from "../../../src/distribution/semantic";
import { createLocalEmbedder, type LocalEmbedder } from "../lib/embed";
import { Recorder, type RecorderMode } from "../lib/recorder";
import { type LabelRule, type PoolId, type PoolSpec, POOLS, poolSpec } from "./segments";

export const EMBED_DIM = 768;
export const NAMESPACE = "e4";

const YC_URL = "https://yc-oss.github.io/api/companies/all.json";
const BRREG_URL = "https://data.brreg.no/enhetsregisteret/api/enheter";
const BRREG_PAGE = 100;
/** The register refuses to page past this many results of one query. */
const BRREG_WINDOW = 10_000;
/** Characters of the long description that count as a company's own words. */
const YC_LONG_CHARS = 600;

export function createRecorder(mode: RecorderMode): Recorder {
    return new Recorder({
        namespace: NAMESPACE,
        mode,
        // The directory is one 20 MB document; the default cut is 1.5 MB.
        maxBodyBytes: 120 * 1024 * 1024,
        timeoutMs: 180_000,
        hostDelayMs: { "data.brreg.no": 700 },
    });
}

interface Company {
    /** What a policy may read: production's companyText of the parts. */
    text: string;
    /** The same words as separate parts, the way the word-overlap fallback is given them. */
    parts: string[];
    /** Hidden label fields. */
    tags: string[];
    industry: string;
    subindustry: string;
    nace: string;
}

export interface LoadedPool {
    spec: PoolSpec;
    size: number;
    texts: string[];
    parts: string[][];
    /** 1 where the company is good for the rule. */
    labels(rule: LabelRule): Uint8Array;
    /** Why records of the source were left out, as counts. */
    leftOut: Record<string, number>;
    /** Hash of every text and label field, so a re-recording that changed the pool is visible. */
    fingerprint: string;
}

const squash = (value: string | undefined | null): string =>
    (value ?? "").replace(/\s+/g, " ").trim();

function finish(spec: PoolSpec, companies: Company[], leftOut: Record<string, number>): LoadedPool {
    const hash = createHash("sha1");
    for (const c of companies)
        hash.update(
            `${c.text}\n${c.tags.join("|")}\n${c.industry}\n${c.subindustry}\n${c.nace}\n\n`
        );
    return {
        spec,
        size: companies.length,
        texts: companies.map(c => c.text),
        parts: companies.map(c => c.parts),
        labels(rule) {
            const out = new Uint8Array(companies.length);
            for (const [i, c] of companies.entries()) {
                if (rule.kind === "brreg") out[i] = c.nace === rule.nace ? 1 : 0;
                else
                    out[i] =
                        c.tags.some(t => rule.tags.includes(t)) ||
                        rule.industries.includes(c.industry) ||
                        rule.subindustries.includes(c.subindustry)
                            ? 1
                            : 0;
            }
            return out;
        },
        leftOut,
        fingerprint: hash.digest("hex").slice(0, 16),
    };
}

interface YcRecord {
    name?: string;
    one_liner?: string;
    long_description?: string;
    industry?: string;
    subindustry?: string;
    tags?: string[];
}

async function loadYc(recorder: Recorder, spec: PoolSpec): Promise<LoadedPool> {
    const all = await recorder.getJson<YcRecord[]>(YC_URL);
    const companies: Company[] = [];
    let noOneLiner = 0;
    for (const record of all) {
        const name = squash(record.name);
        const oneLiner = squash(record.one_liner);
        if (!name || !oneLiner) {
            noOneLiner += 1;
            continue;
        }
        const long = squash(record.long_description).slice(0, YC_LONG_CHARS);
        const extra = long ? [long] : [];
        companies.push({
            text: companyText({ name, description: oneLiner, extra }),
            parts: [name, oneLiner, ...extra],
            tags: record.tags ?? [],
            industry: record.industry ?? "",
            subindustry: record.subindustry ?? "",
            nace: "",
        });
    }
    return finish(spec, companies, { "no one-liner": noOneLiner });
}

interface BrregUnit {
    organisasjonsnummer?: string;
    navn?: string;
    aktivitet?: string[];
    vedtektsfestetFormaal?: string[];
    naeringskode1?: { kode?: string };
    naeringskode2?: { kode?: string };
    naeringskode3?: { kode?: string };
}

interface BrregPage {
    _embedded?: { enheter?: BrregUnit[] };
    page?: { totalElements?: number; totalPages?: number };
}

function brregUrl(query: { naeringskode: string; kommunenummer?: string }, page: number): string {
    const params = [
        `naeringskode=${encodeURIComponent(query.naeringskode)}`,
        ...(query.kommunenummer ? [`kommunenummer=${query.kommunenummer}`] : []),
        `size=${BRREG_PAGE}`,
        `page=${page}`,
        "sort=organisasjonsnummer,ASC",
    ];
    return `${BRREG_URL}?${params.join("&")}`;
}

async function loadBrreg(
    recorder: Recorder,
    spec: PoolSpec,
    onPage?: (done: number, total: number) => void
): Promise<LoadedPool> {
    const units = new Map<string, BrregUnit>();
    for (const query of spec.queries ?? []) {
        const first = await recorder.getJson<BrregPage>(brregUrl(query, 0));
        const total = first.page?.totalElements ?? 0;
        if (total > BRREG_WINDOW)
            throw new Error(`${spec.id}: ${total} results, past the register's paging window`);
        const pages = first.page?.totalPages ?? 0;
        for (let page = 0; page < pages; page++) {
            const body =
                page === 0 ? first : await recorder.getJson<BrregPage>(brregUrl(query, page));
            for (const unit of body._embedded?.enheter ?? [])
                if (unit.organisasjonsnummer) units.set(unit.organisasjonsnummer, unit);
            onPage?.(page + 1, pages);
        }
    }
    const prefixes = spec.primaryPrefixes ?? [];
    const leftOut = {
        "primary code outside the pool": 0,
        "no activity text": 0,
        "target only as a secondary code": 0,
    };
    const companies: Company[] = [];
    const ordered = [...units.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [, unit] of ordered) {
        const nace = unit.naeringskode1?.kode ?? "";
        if (!prefixes.some(p => nace.startsWith(p))) {
            leftOut["primary code outside the pool"] += 1;
            continue;
        }
        const secondary = [unit.naeringskode2?.kode, unit.naeringskode3?.kode];
        if (spec.targetNace && nace !== spec.targetNace && secondary.includes(spec.targetNace)) {
            leftOut["target only as a secondary code"] += 1;
            continue;
        }
        const name = squash(unit.navn);
        const activity = squash((unit.aktivitet ?? []).join(" "));
        const purpose = squash((unit.vedtektsfestetFormaal ?? []).join(" "));
        if (!name || (!activity && !purpose)) {
            leftOut["no activity text"] += 1;
            continue;
        }
        // Many statutes repeat the activity word for word; say it once.
        const extra = purpose && purpose.toLowerCase() !== activity.toLowerCase() ? [purpose] : [];
        companies.push({
            text: companyText({ name, description: activity || null, extra }),
            parts: [name, ...(activity ? [activity] : []), ...extra],
            tags: [],
            industry: "",
            subindustry: "",
            nace,
        });
    }
    return finish(spec, companies, leftOut);
}

export async function loadPool(
    recorder: Recorder,
    id: PoolId,
    onPage?: (done: number, total: number) => void
): Promise<LoadedPool> {
    const spec = poolSpec(id);
    return spec.source === "yc" ? loadYc(recorder, spec) : loadBrreg(recorder, spec, onPage);
}

export const POOL_IDS: PoolId[] = POOLS.map(p => p.id);

// ── Embeddings ──────────────────────────────────────────────────────────────

/** nomic-embed-text's task prefixes, or none. */
export type PrefixMode = "plain" | "prefixed";
export const QUERY_PREFIX = "search_query: ";
export const DOCUMENT_PREFIX = "search_document: ";

export interface Vectors {
    /** Row-major [count × EMBED_DIM], as the model returned them. */
    data: Float32Array;
    count: number;
}

export interface VectorSource {
    readonly embedder: LocalEmbedder;
    /** Vectors of company texts. */
    documents(
        texts: readonly string[],
        mode: PrefixMode,
        onProgress?: (done: number, total: number) => void
    ): Promise<Vectors>;
    /** Vectors of briefs and of production's baseline text. */
    queries(texts: readonly string[], mode: PrefixMode): Promise<Vectors>;
}

/** A loopback port nothing listens on: an embedding that is not cached fails instead of calling the model. */
const OFFLINE_URL = "http://127.0.0.1:9";

/**
 * `offline: true` (run.ts) never reaches the model: every vector must already
 * be in the on-disk cache that record.ts filled.
 */
export function createVectorSource(options: { offline: boolean }): VectorSource {
    const embedder = createLocalEmbedder(options.offline ? { baseUrl: OFFLINE_URL } : {});
    const embedAll = async (
        texts: readonly string[],
        onProgress?: (done: number, total: number) => void
    ): Promise<Vectors> => {
        const data = new Float32Array(texts.length * EMBED_DIM);
        const CHUNK = 256;
        for (let at = 0; at < texts.length; at += CHUNK) {
            let vectors: number[][];
            try {
                vectors = await embedder.embed(texts.slice(at, at + CHUNK));
            } catch (error) {
                if (options.offline)
                    throw new Error(
                        "An embedding is not in the cache. Run record.ts first (COMPANY_SEARCH_BENCH_MODE=record, with Ollama running)."
                    );
                throw error;
            }
            for (const [i, vector] of vectors.entries()) {
                if (vector.length !== EMBED_DIM)
                    throw new Error(`Expected ${EMBED_DIM} dimensions, got ${vector.length}`);
                data.set(vector, (at + i) * EMBED_DIM);
            }
            onProgress?.(Math.min(texts.length, at + CHUNK), texts.length);
        }
        return { data, count: texts.length };
    };
    return {
        embedder,
        documents: (texts, mode, onProgress) =>
            embedAll(mode === "prefixed" ? texts.map(t => DOCUMENT_PREFIX + t) : texts, onProgress),
        queries: (texts, mode) =>
            embedAll(mode === "prefixed" ? texts.map(t => QUERY_PREFIX + t) : texts),
    };
}
