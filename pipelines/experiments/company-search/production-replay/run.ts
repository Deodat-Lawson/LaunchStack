/**
 * Replays the benchmark's pools through production's ranking code and writes
 * ../results/production-*.json. Offline: recorded pools and cached vectors
 * only, never a model or a network call.
 *
 *   pnpm exec tsx experiments/company-search/production-replay/run.ts                 # both replays, local model
 *   pnpm exec tsx experiments/company-search/production-replay/run.ts shortlist --model=gemini-embedding-001@768
 *   pnpm exec tsx experiments/company-search/production-replay/run.ts brief --seeds=3
 *   pnpm exec tsx experiments/company-search/production-replay/run.ts shortlist --zero-score-rule
 *
 * `shortlist`: the shortlist that learns from each verdict, beside today's
 * ranking, on E4's seven pools. `brief`: an English brief beside a Norwegian
 * one on the three Norwegian pools. `verdicts` (only when asked for): the
 * shortlist replay on one pool whose checks answer what production's fit
 * check really said (record-verdicts.ts records them). `--model` is one of
 * models.ts whose vectors are on this machine (record.ts records the paid
 * ones); each model has its own block in a results file. A run with fewer
 * than E4's twenty seeds prints its table and leaves the files alone, and so
 * does one with `--zero-score-rule`, which drops the companies a run would
 * drop before ranking (relevance not above zero): the committed results rank
 * every company of a pool, as E4 does.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LEARNER_SETTINGS } from "../../../src/distribution/learn";
import { JUDGE_POOL_FACTOR, LEARNING_ROUND } from "../../../src/distribution/shortlist";
import { SIMULATION } from "../e4-whom-to-check/config";
import { stringifyResults } from "../lib/json";
import {
    BRIEF_BUDGETS,
    briefTable,
    runBriefLanguageReplay,
    type BriefSummary,
} from "./brief-language";
import { offlineEmbedder, REPLAY_MODELS, replayModel } from "./models";
import { table, type ShortlistSummary } from "./shortlist-report";
import { BUDGETS, CHECKS_CAP, SHORTLIST } from "./shortlist-replay";
import { runShortlistReplay } from "./shortlist-run";
import { LOCAL_MODEL, recordingsPresent } from "./vectors";
import { runVerdictReplay, verdictTable, type VerdictSummary } from "./verdict-replay";
import { JUDGE_ID, readVerdicts, WHERE } from "./verdicts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.resolve(HERE, "..", "results");
export const SHORTLIST_RESULTS = path.join(RESULTS, "production-shortlist.json");
export const BRIEF_RESULTS = path.join(RESULTS, "production-brief-language.json");
export const VERDICT_RESULTS = path.join(RESULTS, "production-verdicts.json");
/** The pool whose every company the real fit check was asked about. */
export const JUDGED_SEGMENT = "brreg-breweries";

interface Results<Summary> {
    experiment: string;
    question: string;
    design: Record<string, unknown>;
    /** One block per embedding model the pools were replayed with. */
    byEmbedding: Record<string, Summary>;
}
export type ShortlistResults = Results<ShortlistSummary>;
export type BriefResults = Results<BriefSummary>;
export type VerdictResults = Results<VerdictSummary>;

function read<Summary>(file: string): Results<Summary> | null {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf8")) as Results<Summary>;
}
export const readShortlistResults = (): ShortlistResults | null => read(SHORTLIST_RESULTS);
export const readBriefResults = (): BriefResults | null => read(BRIEF_RESULTS);
export const readVerdictResults = (): VerdictResults | null => read(VERDICT_RESULTS);

const INTERVALS = "95% percentile bootstrap, 2,000 resamples: over pools and then seeds, as in E4";

const embeddingModels = (models: Record<string, unknown>): Record<string, string> =>
    Object.fromEntries(Object.keys(models).map(id => [id, replayModel(id).label]));

/** A file's blocks with one model's replaced, in the registry's order whichever run wrote last. */
function merged<Summary>(
    previous: Results<Summary> | null,
    model: string,
    summary: Summary
): Record<string, Summary> {
    const all: Record<string, Summary> = { ...(previous?.byEmbedding ?? {}), [model]: summary };
    return Object.fromEntries(REPLAY_MODELS.filter(m => m.id in all).map(m => [m.id, all[m.id]!]));
}

function shortlistDesign(byEmbedding: Record<string, unknown>): Record<string, unknown> {
    return {
        code: "src/distribution/shortlist.ts (fillShortlist) and src/distribution/learn.ts (createShortlistLearner), as production runs them",
        pools: "E4's seven reported segments, each with a brief in its companies' own language (E4's headline condition)",
        check: "one check reveals one company's hidden label (directory tag or register code) and costs 1",
        candidates: `a seed's ${SIMULATION.subsample * 100}% draw of the pool, in today's order: relevance, ties in the draw's order`,
        arms: {
            today: `the fixed ranking through production's loop: ${JUDGE_POOL_FACTOR} companies per open shortlist place each round`,
            "today-in-rounds": `the fixed ranking asked ${LEARNING_ROUND} at a time, so the effect of the round size alone is visible`,
            learner: `production's learner picks every round of ${LEARNING_ROUND}`,
        },
        metrics: {
            found: `good companies among the first ${BUDGETS.join(", ")} checks, with no shortlist to fill`,
            checksTo25: `checks until the ${SHORTLIST}th good company was checked, capped at ${CHECKS_CAP}`,
            spent: `checks production's loop makes before a ${SHORTLIST}-place shortlist is full, in whole rounds`,
            rounds: "rounds of that run. The fit check makes one model call per twenty companies of a round: three for today's first round of fifty, one for a round of ten",
        },
        learner: LEARNER_SETTINGS,
        embeddingModels: embeddingModels(byEmbedding),
        intervals: INTERVALS,
    };
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

function verdictDesign(byEmbedding: Record<string, unknown>): Record<string, unknown> {
    return {
        code: "src/distribution/shortlist.ts (fillShortlist) and src/distribution/learn.ts (createShortlistLearner), as production runs them",
        pool: `${JUDGED_SEGMENT}: every company judged once by production's fit check (src/distribution/judge.ts, unchanged), English brief, "${WHERE[JUDGED_SEGMENT]}" as the place`,
        judge: `${JUDGE_ID}: the fast route of apps/web/config/chat-models.yaml through OpenRouter. A deployment whose chat routes point at another model may judge differently; none was called`,
        check: "one check answers the recorded verdict on that company and costs 1; the loop and the learner see nothing else",
        counted: {
            judged: "a company is good when the fit check said yes",
            register: "a company is good by its register code, as in E4",
        },
        stability:
            "200 companies were asked about a second time in other batches; `changed` is how many verdicts differ",
        candidates: `a seed's ${SIMULATION.subsample * 100}% draw of the pool, in today's order`,
        laterRun:
            "the pool is split in two at random. A first run fills its shortlist on one half with the learner and keeps its verdicts; a second run meets the other half three ways: today's ranking, the learner starting from nothing (`fresh`), and the learner starting from the kept verdicts (`seeded`)",
        embeddingModels: embeddingModels(byEmbedding),
        intervals:
            "95% percentile bootstrap over the seeds of this one pool: they say how stable the figure is on this pool, not how far it carries to another",
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
    const which = positional.length > 0 ? positional : ["brief", "shortlist"];
    const model = replayModel(args.get("model") ?? LOCAL_MODEL);
    const seedCount = Number(args.get("seeds") ?? SIMULATION.seeds.length);
    const seeds = SIMULATION.seeds.slice(0, seedCount);
    const zeroScoreRule = args.has("zero-score-rule") && args.get("zero-score-rule") !== "false";
    // Only the committed condition is written down: all twenty seeds, the whole pool ranked.
    const full = seedCount === SIMULATION.seeds.length && !zeroScoreRule;
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
    if (which.includes("shortlist")) {
        const { summary } = await runShortlistReplay({
            embedder: offlineEmbedder(model.id),
            seeds,
            zeroScoreRule,
            onProgress: progress,
        });
        console.log(`\n${model.id}\n${table(summary)}\n`);
        if (full) {
            const byEmbedding = merged(readShortlistResults(), model.id, summary);
            const results: ShortlistResults = {
                experiment: "production-replay: the shortlist learns from each verdict",
                question:
                    "Does production's own ranking code find more good companies per fit check than today's fixed ranking, on E4's pools?",
                design: shortlistDesign(byEmbedding),
                byEmbedding,
            };
            writeFileSync(SHORTLIST_RESULTS, stringifyResults(results));
            progress(`wrote ${path.relative(process.cwd(), SHORTLIST_RESULTS)}`);
        }
    }
    if (which.includes("verdicts")) {
        if (!readVerdicts(JUDGED_SEGMENT, "en")) {
            console.error(
                `No recorded fit-check verdicts for ${JUDGED_SEGMENT} on this machine: record-verdicts.ts records them (paid).`
            );
            process.exit(1);
        }
        const summary = await runVerdictReplay({
            embedder: offlineEmbedder(model.id),
            segment: JUDGED_SEGMENT,
            seeds,
            zeroScoreRule,
        });
        console.log(`\n${verdictTable(model.id, summary)}\n`);
        if (full) {
            const byEmbedding = merged(readVerdictResults(), model.id, summary);
            const results: VerdictResults = {
                experiment: "production-replay: the learning shortlist on real fit-check verdicts",
                question:
                    "When a check answers what production's fit check really said, does the learning shortlist still find more companies per check than today's ranking?",
                design: verdictDesign(byEmbedding),
                byEmbedding,
            };
            writeFileSync(VERDICT_RESULTS, stringifyResults(results));
            progress(`wrote ${path.relative(process.cwd(), VERDICT_RESULTS)}`);
        }
    }
    if (!full)
        console.log(
            zeroScoreRule
                ? `${seedCount} seeds with the relevance-above-zero rule applied first: a variant, results files left as they are.`
                : `${seedCount} seeds: a partial run, results files left as they are.`
        );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    await main();
