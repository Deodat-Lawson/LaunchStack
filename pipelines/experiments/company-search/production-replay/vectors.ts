/**
 * Embedding vectors for the replays, from the on-disk cache the experiments
 * share (../lib/embed.ts writes the same files for the local model).
 *
 * A replay never calls a model: a text that is not cached is an error unless
 * the caller hands in `compute`, which is how a recording run fills the cache
 * for a paid model once. The cache sits beside the recorded pools and is never
 * committed (see ../.gitignore).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DEFAULT_CACHE_DIR } from "../lib/recorder";

export interface ReplayEmbedder {
    /** The cache's name for the model, with its dimensions when they are a choice. */
    readonly model: string;
    /** One vector per text, in order. */
    embed(texts: readonly string[]): Promise<number[][]>;
    /** Texts answered from disk / computed by the model, in this process. */
    readonly stats: { cached: number; computed: number };
}

export interface CachedEmbedderOptions {
    model: string;
    /** Computes vectors for texts the cache lacks; absent, a missing text is an error. */
    compute?: (texts: string[]) => Promise<number[][]>;
    /** Texts per `compute` call (default 96). */
    batchSize?: number;
    /** Characters kept per text before embedding (default 2,000, as production's companyText). */
    maxChars?: number;
    dir?: string;
}

export class NotCachedError extends Error {
    constructor(model: string, missing: number) {
        super(
            `${missing} text(s) have no cached ${model} vector. A replay never calls a model: record them first.`
        );
        this.name = "NotCachedError";
    }
}

export function embeddingCacheDir(model: string, dir = DEFAULT_CACHE_DIR): string {
    return path.join(dir, "embeddings", model.replace(/[^\w.-]/g, "_"));
}

export function cachedEmbedder(options: CachedEmbedderOptions): ReplayEmbedder {
    const { model, compute } = options;
    const batchSize = options.batchSize ?? 96;
    const maxChars = options.maxChars ?? 2_000;
    const dir = embeddingCacheDir(model, options.dir);
    const stats = { cached: 0, computed: 0 };
    /** A pool is read once per process, however many seeds replay it. */
    const memory = new Map<string, number[]>();

    const fileFor = (text: string): string => {
        const hash = createHash("sha1").update(`${model}\n${text}`).digest("hex");
        return path.join(dir, hash.slice(0, 2), `${hash}.f32`);
    };
    const read = (text: string): number[] | null => {
        const known = memory.get(text);
        if (known) return known;
        const file = fileFor(text);
        if (!existsSync(file)) return null;
        const buffer = readFileSync(file);
        const vector = Array.from(
            new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
        );
        memory.set(text, vector);
        return vector;
    };
    const write = (text: string, vector: readonly number[]): void => {
        const file = fileFor(text);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, Buffer.from(new Float32Array(vector).buffer));
        // What a replay will read back is the single-precision copy.
        memory.set(text, Array.from(new Float32Array(vector)));
    };

    return {
        model,
        stats,
        async embed(texts) {
            const clipped = texts.map(t => t.slice(0, maxChars));
            const found = clipped.map(read);
            const missing = [...new Set(clipped.filter((_, i) => found[i] === null))];
            stats.cached += clipped.length - found.filter(v => v === null).length;
            if (missing.length > 0) {
                if (!compute) throw new NotCachedError(model, missing.length);
                for (let i = 0; i < missing.length; i += batchSize) {
                    const batch = missing.slice(i, i + batchSize);
                    const vectors = await compute(batch);
                    if (vectors.length !== batch.length)
                        throw new Error(`${model} returned a different number of vectors`);
                    for (const [j, text] of batch.entries()) write(text, vectors[j]!);
                    stats.computed += batch.length;
                }
            }
            return clipped.map(text => read(text)!);
        },
    };
}

/** The local model the benchmark was recorded with. */
export const LOCAL_MODEL = "nomic-embed-text";

/** Whether the recorded pools and this model's vectors are on this machine. */
export function recordingsPresent(model = LOCAL_MODEL, dir = DEFAULT_CACHE_DIR): boolean {
    return existsSync(path.join(dir, "e4")) && existsSync(embeddingCacheDir(model, dir));
}
