/**
 * Local text embeddings for the experiments, from an Ollama server on this
 * machine (no paid call, nothing leaves the computer). Stands in for the
 * workspace embedder that Prospects is given in production.
 *
 * Vectors are cached on disk by a hash of (model, text), so a replay never
 * needs the model to be running.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DEFAULT_CACHE_DIR } from "./recorder";

export interface LocalEmbedderOptions {
    /** Ollama model name (default nomic-embed-text). */
    model?: string;
    /** Ollama base URL (default http://localhost:11434). */
    baseUrl?: string;
    /** Texts per request (default 32). */
    batchSize?: number;
    /** Characters kept per text before embedding (default 2,000, as production's companyText). */
    maxChars?: number;
    dir?: string;
}

export interface LocalEmbedder {
    /** One vector per text, in order. */
    embed(texts: readonly string[]): Promise<number[][]>;
    /** Texts answered from disk / computed by the model, in this process. */
    readonly stats: { cached: number; computed: number };
}

export function createLocalEmbedder(options: LocalEmbedderOptions = {}): LocalEmbedder {
    const model = options.model ?? "nomic-embed-text";
    const baseUrl = options.baseUrl ?? "http://localhost:11434";
    const batchSize = options.batchSize ?? 32;
    const maxChars = options.maxChars ?? 2_000;
    const dir = path.join(
        options.dir ?? DEFAULT_CACHE_DIR,
        "embeddings",
        model.replace(/[^\w.-]/g, "_")
    );
    const stats = { cached: 0, computed: 0 };

    const fileFor = (text: string): string => {
        const hash = createHash("sha1").update(`${model}\n${text}`).digest("hex");
        return path.join(dir, hash.slice(0, 2), `${hash}.f32`);
    };
    const read = (text: string): number[] | null => {
        const file = fileFor(text);
        if (!existsSync(file)) return null;
        const buffer = readFileSync(file);
        return Array.from(
            new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
        );
    };
    const write = (text: string, vector: readonly number[]): void => {
        const file = fileFor(text);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, Buffer.from(new Float32Array(vector).buffer));
    };

    return {
        stats,
        async embed(texts) {
            const clipped = texts.map(t => t.slice(0, maxChars));
            const out: Array<number[] | null> = clipped.map(read);
            const missing = [...new Set(clipped.filter((_, i) => out[i] === null))];
            stats.cached += clipped.length - clipped.filter((_, i) => out[i] === null).length;
            const fresh = new Map<string, number[]>();
            for (let i = 0; i < missing.length; i += batchSize) {
                const batch = missing.slice(i, i + batchSize);
                const response = await fetch(`${baseUrl}/api/embed`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ model, input: batch, truncate: true }),
                });
                if (!response.ok)
                    throw new Error(
                        `Local embedder ${response.status}: is Ollama running with ${model}?`
                    );
                const json = (await response.json()) as { embeddings?: number[][] };
                const vectors = json.embeddings ?? [];
                if (vectors.length !== batch.length)
                    throw new Error("Local embedder returned a different number of vectors");
                for (const [j, text] of batch.entries()) {
                    fresh.set(text, vectors[j]!);
                    write(text, vectors[j]!);
                }
                stats.computed += batch.length;
            }
            return clipped.map((text, i) => out[i] ?? fresh.get(text)!);
        },
    };
}
