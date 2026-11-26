/**
 * Replays the benchmark's pools through production's ranking code and writes
 * ../results/production-*.json. Offline: recorded pools and cached vectors
 * only, never a model or a network call.
 *
 *   pnpm exec tsx experiments/company-search/production-replay/run.ts                 # the local model
 *   pnpm exec tsx experiments/company-search/production-replay/run.ts brief --model=gemini-embedding-001@768
 *   pnpm exec tsx experiments/company-search/production-replay/run.ts brief --seeds=3
 *
 * `brief`: an English brief beside a Norwegian one on the three Norwegian
 * pools. `--model` is one of models.ts whose vectors are on this machine
 * (record.ts records the paid ones); each model has its own block in the
 * results file. A run with fewer than E4's twenty seeds prints its table and
 * leaves the file alone.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SIMULATION } from "../e4-whom-to-check/config";
import { stringifyResults } from "../lib/json";
import {
    BRIEF_BUDGETS,
    briefTable,
    runBriefLanguageReplay,
    type BriefSummary,
} from "./brief-language";
import { offlineEmbedder, REPLAY_MODELS, replayModel } from "./models";
import { LOCAL_MODEL, recordingsPresent } from "./vectors";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.resolve(HERE, "..", "results");
export const BRIEF_RESULTS = path.join(RESULTS, "production-brief-language.json");

interface Results<Summary> {
    experiment: string;
    question: string;
    design: Record<string, unknown>;
    /** One block per embedding model the pools were replayed with. */
    byEmbedding: Record<string, Summary>;
}
export type BriefResults = Results<BriefSummary>;

function read<Summary>(file: string): Results<Summary> | null {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf8")) as Results<Summary>;
}
export const readBriefResults = (): BriefResults | null => read(BRIEF_RESULTS);

const INTERVALS = "95% percentile bootstrap, 2,000 resamples: over pools and then seeds, as in E4";

const embeddingModels = (models: Record<string, unknown>): Record<string, string> =>
    Object.fromEntries(Object.keys(models).map(id => [id, replayModel(id).label]));

/** A file's blocks with one model's replaced, in the registry's order whichever run wrote last. */
function merged<Summary>(
    previous: Results<Summary> | null,
    model: string,
    summary: Summary
): Record<string, Summary> {
    const all: Record<string, Summary> = {
        ...(previous?.byEmbedding ?? {}),
        [model]: summary,
    };
    return Object.fromEntries(REPLAY_MODELS.filter(m => m.id in all).map(m => [m.id, all[m.id]!]));
}

function briefDesign(byEmbedding: Record<string, unknown>): Record<string, unknown> {
    return {
        code: "src/distribution/semantic.ts (semanticRelevance), as production runs it; companies are checked from the top of that ranking down, as production does",
        pools: "E4's three Norwegian register pools: the companies' texts are Norwegian",
        briefs: {
            english: "the segment as an English-writing seller types it",
            norwegian: "E4's Norwegian brief: the same segment as a Norwegian seller would type it",
            higher: "per company, the higher of its two relevance scores",
        },
        check: "one check reveals one company's hidden label (its register code) and costs 1",
        candidates: `a seed's ${SIMULATION.subsample * 100}% draw of the pool, in the order of its relevance to the brief`,
        metrics: {
            found: `good companies among the first ${BRIEF_BUDGETS.join(", ")} checks of today's fixed ranking`,
            zeroScoreRule:
                "whole pool: the share of companies, and of good companies, whose relevance is above zero, which is what production keeps before any fit check",
        },
        embeddingModels: embeddingModels(byEmbedding),
        intervals: INTERVALS,
    };
}

async function main(): Promise<void> {
    const positional = process.argv.slice(2).filter(arg => !arg.startsWith("--"));
    const args = new Map(
        process.argv
            .slice(2)
            .filter(arg => arg.startsWith("--"))
            .map(arg => {
                const [key, value] = arg.replace(/^--/, "").split("=");
                return [key!, value ?? "true"] as const;
            })
    );
    const which = positional.length > 0 ? positional : ["brief"];
    const model = replayModel(args.get("model") ?? LOCAL_MODEL);
    const seedCount = Number(args.get("seeds") ?? SIMULATION.seeds.length);
    const seeds = SIMULATION.seeds.slice(0, seedCount);
    const full = seedCount === SIMULATION.seeds.length;
    if (!recordingsPresent(model.id)) {
        console.error(
            `The recorded pools or the ${model.id} vectors are not on this machine (COMPANY_SEARCH_BENCH_CACHE). Nothing to replay.`
        );
        process.exit(1);
    }
    const started = Date.now();
    const progress = (line: string): void =>
        console.log(`[${String(Math.round((Date.now() - started) / 1000)).padStart(4)} s] ${line}`);

    if (which.includes("brief")) {
        const summary = await runBriefLanguageReplay({
            embedder: offlineEmbedder(model.id),
            seeds,
        });
        console.log(`\n${briefTable(model.id, summary)}\n`);
        if (full) {
            const byEmbedding = merged(readBriefResults(), model.id, summary);
            const results: BriefResults = {
                experiment: "production-replay: the segment brief in the buyers' language",
                question:
                    "On Norwegian company texts, does a Norwegian brief rank better than an English one with the app's two built-in embedding models?",
                design: briefDesign(byEmbedding),
                byEmbedding,
            };
            writeFileSync(BRIEF_RESULTS, stringifyResults(results));
            progress(`wrote ${path.relative(process.cwd(), BRIEF_RESULTS)}`);
        }
    }
    if (!full) console.log(`${seedCount} seeds: a partial run, results files left as they are.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    await main();
