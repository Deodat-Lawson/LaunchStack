/**
 * The paid step of the production replay: embeds the benchmark's pools, briefs
 * and baseline with one of the app's built-in embedding models and writes the
 * vectors to the local cache, so every replay after it is free and offline.
 *
 *   COMPANY_SEARCH_BENCH_MODE=record pnpm exec tsx \
 *     experiments/company-search/production-replay/record.ts \
 *     --model=gemini-embedding-001@768 --cap-usd=1 [--pools=brreg-food,brreg-drinks] [--via=openrouter]
 *
 * `--via` picks the endpoint (models.ts): the vendor's own by default.
 *
 * It sends nothing unless record mode is set and a spend cap is given, prints
 * its estimate first and stops when the estimate is over the cap. A text that
 * is already cached is never sent again, so a run can be stopped and started
 * again. What leaves the machine: company names and their own activity texts
 * (no address, phone or email), to the model's provider.
 */
import { BASELINE_TEXT } from "../../../src/distribution/semantic";
import { allQueryTexts } from "../e4-whom-to-check/briefs";
import { createRecorder, loadPool, POOL_IDS } from "../e4-whom-to-check/data";
import type { PoolId } from "../e4-whom-to-check/segments";
import { defaultMode } from "../lib/recorder";
import { recordingEmbedder, replayModel } from "./models";
import { cachedEmbedder, NotCachedError } from "./vectors";

const args = new Map(
    process.argv.slice(2).map(arg => {
        const [key, value] = arg.replace(/^--/, "").split("=");
        return [key!, value ?? "true"] as const;
    })
);
const modelId = args.get("model");
const capUsd = Number(args.get("cap-usd"));
if (!modelId || !Number.isFinite(capUsd) || capUsd <= 0) {
    console.error(
        "Usage: record.ts --model=<id> --cap-usd=<dollars> [--pools=a,b] [--via=<route>]"
    );
    process.exit(1);
}
if (defaultMode() !== "record") {
    console.error("Not in record mode (COMPANY_SEARCH_BENCH_MODE=record): nothing was sent.");
    process.exit(1);
}
const model = replayModel(modelId);
const poolIds = (args.get("pools")?.split(",") as PoolId[] | undefined) ?? POOL_IDS;

const recorder = createRecorder("replay");
const texts = new Set<string>([BASELINE_TEXT, ...allQueryTexts()]);
for (const id of poolIds) for (const text of (await loadPool(recorder, id)).texts) texts.add(text);

// What is not cached yet, and what sending it would cost at the list price.
const offline = cachedEmbedder({ model: model.id });
const missing: string[] = [];
for (const text of texts) {
    try {
        await offline.embed([text]);
    } catch (error) {
        if (!(error instanceof NotCachedError)) throw error;
        missing.push(text);
    }
}
const chars = missing.reduce((sum, text) => sum + Math.min(text.length, 2_000), 0);
// Three characters a token: on the safe side for Norwegian.
const tokens = Math.ceil(chars / 3);
const estimate = (tokens / 1e6) * (model.usdPerMTok ?? 0);
console.log(
    `${model.label}: ${texts.size} texts, ${missing.length} not cached (${chars} characters, about ${tokens} tokens, about $${estimate.toFixed(3)} at $${model.usdPerMTok} per million)`
);
if (missing.length === 0) process.exit(0);
if (estimate > capUsd) {
    console.error(`Over the cap of $${capUsd}: nothing was sent.`);
    process.exit(1);
}
const embedder = recordingEmbedder(model.id, { route: args.get("via") });
const started = Date.now();
const CHUNK = 960;
for (let at = 0; at < missing.length; at += CHUNK) {
    await embedder.embed(missing.slice(at, at + CHUNK));
    console.log(
        `  ${Math.min(missing.length, at + CHUNK)} of ${missing.length} (${Math.round((Date.now() - started) / 1000)} s)`
    );
}
const spentUsd = (embedder.spent.tokens / 1e6) * (model.usdPerMTok ?? 0);
console.log(
    `Recorded ${embedder.stats.computed} vectors with ${model.id}: ${embedder.spent.tokens} tokens in ${embedder.spent.requests} requests, about $${spentUsd.toFixed(3)}.`
);
