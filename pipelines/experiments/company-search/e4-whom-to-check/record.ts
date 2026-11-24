/**
 * Entry point 1 of 2: fetch the pools and compute the embeddings.
 *
 *   COMPANY_SEARCH_BENCH_MODE=record pnpm exec tsx experiments/company-search/e4-whom-to-check/record.ts
 *
 * In `record` mode, requests that are not in the cache are sent (one YC
 * document, about a hundred register pages, at most one every 0.7 s) and
 * texts that have no vector yet go to the local Ollama model. Without the
 * variable it only checks that the cache is complete: no request leaves the
 * machine and the model is not called.
 *
 * Prints counts only. Register records can name people; no row is printed.
 */
import { defaultMode } from "../lib/recorder";
import { allQueryTexts } from "./briefs";
import { createRecorder, createVectorSource, loadPool, POOL_IDS, type PrefixMode } from "./data";
import { SEGMENTS } from "./segments";

const started = Date.now();
const mode = defaultMode();
const recorder = createRecorder(mode);
const vectors = createVectorSource({ offline: mode === "replay" });
const MODES: PrefixMode[] = ["plain", "prefixed"];

console.log(`mode: ${mode}`);
let documents = 0;
for (const id of POOL_IDS) {
    const pool = await loadPool(recorder, id, (done, total) => {
        if (done === total || done % 10 === 0)
            process.stdout.write(`\r  ${id}: register page ${done}/${total}   `);
    });
    process.stdout.write("\r");
    console.log(
        `${id}: ${pool.size} companies (fingerprint ${pool.fingerprint}); left out: ${Object.entries(
            pool.leftOut
        )
            .map(([why, n]) => `${n} ${why}`)
            .join(", ")}`
    );
    for (const segment of SEGMENTS.filter(s => s.pool === id)) {
        const labels = pool.labels(segment.label);
        const good = labels.reduce((sum, v) => sum + v, 0);
        console.log(
            `  ${segment.id} [${segment.role}]: ${good} good (${((100 * good) / pool.size).toFixed(1)}%)`
        );
    }
    for (const prefix of MODES) {
        await vectors.documents(pool.texts, prefix, (done, total) => {
            process.stdout.write(`\r  ${id}: ${prefix} vectors ${done}/${total}   `);
        });
        process.stdout.write("\r");
        documents += pool.size;
    }
    console.log(`  vectors ready (plain and prefixed)                `);
}
const queries = allQueryTexts();
for (const prefix of MODES) await vectors.queries(queries, prefix);

console.log(
    `requests: ${recorder.live} live, ${recorder.replayed} from cache; vectors: ${vectors.embedder.stats.computed} computed, ${vectors.embedder.stats.cached} from cache (${documents} company vectors, ${queries.length * MODES.length} brief vectors); ${((Date.now() - started) / 1000).toFixed(0)} s`
);
