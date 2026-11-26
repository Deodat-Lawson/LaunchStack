/**
 * The other paid step of the production replay: asks production's own fit
 * check about every company of one pool and keeps the verdicts on disk
 * (verdicts.ts), so the learning shortlist can be replayed over real verdicts
 * for free afterwards.
 *
 *   COMPANY_SEARCH_BENCH_MODE=record OPENROUTER_API_KEY=... pnpm exec tsx \
 *     experiments/company-search/production-replay/record-verdicts.ts \
 *     --segment=brreg-breweries --cap-usd=1 [--again=200] [--limit=20]
 *
 * The judge is src/distribution/judge.ts unchanged, on the fast route of
 * apps/web/config/chat-models.yaml through OpenRouter (the dev setup). It
 * sends nothing unless record mode is set and a spend cap is given, prints its
 * estimate first and stops when the estimate is over the cap. A company that
 * already has a verdict is never asked about again. `--again=N` asks about N
 * companies a second time, in other batches, to see how stable a verdict is;
 * `--limit=N` stops after the first N companies (a trial before the pool).
 * What leaves the machine: company names and their own activity texts (no
 * address, phone or email), to OpenRouter and the model's provider.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { configureChatModels, createChatModelsConfig } from "@launchstack/llm";

import { createFitJudge } from "../../../src/distribution/judge";
import { briefOf, segmentText, type BriefLanguage } from "../e4-whom-to-check/briefs";
import { createRecorder, loadPool } from "../e4-whom-to-check/data";
import { segmentById } from "../e4-whom-to-check/segments";
import { defaultMode } from "../lib/recorder";
import { createRng, hashSeed } from "../lib/rng";
import { JUDGE_ID, readVerdicts, WHERE, writeVerdicts, type RecordedVerdicts } from "./verdicts";

/** OpenRouter's list price for the fast route's model on 2026-11-26, US dollars per million tokens. */
const USD_PER_MTOK = { input: 0.825, output: 4.125 };
/** Companies per model call: the judge's own batch size. */
const BATCH = 20;
/** What one call carries besides the companies (instructions, brief, place), in tokens. */
const CALL_OVERHEAD = 480;
/** A verdict in the answer: id, yes or no, one short sentence. */
const TOKENS_PER_VERDICT = 50;

const args = new Map(
    process.argv.slice(2).map(arg => {
        const [key, value] = arg.replace(/^--/, "").split("=");
        return [key!, value ?? "true"] as const;
    })
);
const segmentId = args.get("segment");
const capUsd = Number(args.get("cap-usd"));
const language = (args.get("brief") ?? "en") as BriefLanguage;
const againCount = Number(args.get("again") ?? 0);
if (!segmentId || !Number.isFinite(capUsd) || capUsd <= 0) {
    console.error(
        "Usage: record-verdicts.ts --segment=<id> --cap-usd=<dollars> [--brief=en|no] [--again=N]"
    );
    process.exit(1);
}
if (defaultMode() !== "record") {
    console.error("Not in record mode (COMPANY_SEARCH_BENCH_MODE=record): nothing was sent.");
    process.exit(1);
}
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
    console.error("OPENROUTER_API_KEY is not set: nothing was sent.");
    process.exit(1);
}
const where = WHERE[segmentId];
if (!where) {
    console.error(`No place is written down for ${segmentId} (verdicts.ts).`);
    process.exit(1);
}

const segment = segmentById(segmentId);
const pool = await loadPool(createRecorder("replay"), segment.pool);
const brief = briefOf(segmentText(segment, language));
const recorded: RecordedVerdicts = readVerdicts(segmentId, language) ?? {
    segment: segmentId,
    briefLanguage: language,
    judge: JUDGE_ID,
    poolFingerprint: pool.fingerprint,
    verdicts: {},
};
if (recorded.poolFingerprint !== pool.fingerprint) {
    console.error("The pool changed since these verdicts were recorded: nothing was sent.");
    process.exit(1);
}

const limit = Number(args.get("limit") ?? Number.POSITIVE_INFINITY);
const missing = pool.texts
    .map((_, i) => i)
    .filter(i => !recorded.verdicts[String(i)])
    .slice(0, limit);
// A second opinion: a fixed draw of judged companies, shuffled into other batches.
const rng = createRng(hashSeed(`${segmentId}|again`));
const again =
    againCount > 0
        ? rng
              .shuffle(pool.texts.map((_, i) => i))
              .slice(0, againCount)
              .filter(i => !recorded.again?.[String(i)])
        : [];

const ask = [...missing, ...again];
const inputTokens =
    Math.ceil(ask.length / BATCH) * CALL_OVERHEAD +
    ask.reduce((sum, i) => sum + Math.ceil(Math.min(pool.texts[i]!.length, 2_000) / 3) + 10, 0);
const outputTokens = ask.length * TOKENS_PER_VERDICT;
const estimate =
    (inputTokens / 1e6) * USD_PER_MTOK.input + (outputTokens / 1e6) * USD_PER_MTOK.output;
console.log(
    `${segmentId}: ${pool.size} companies, ${missing.length} without a verdict, ${again.length} to ask again; about ${inputTokens} tokens in and ${outputTokens} out, about $${estimate.toFixed(2)}`
);
if (ask.length === 0) process.exit(0);
if (estimate > capUsd) {
    console.error(`Over the cap of $${capUsd}: nothing was sent.`);
    process.exit(1);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
configureChatModels(
    createChatModelsConfig({
        yaml: readFileSync(
            path.resolve(HERE, "../../../../apps/web/config/chat-models.yaml"),
            "utf8"
        ),
        endpoint: { baseUrl: "https://openrouter.ai/api/v1", apiKey },
    })
);
const judge = createFitJudge();

/** OpenRouter's own count of what the key has spent, in dollars; null when it cannot be read. */
async function keyUsage(): Promise<number | null> {
    try {
        const response = await fetch("https://openrouter.ai/api/v1/key", {
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        const body = (await response.json()) as { data?: { usage?: number } };
        return typeof body.data?.usage === "number" ? body.data.usage : null;
    } catch {
        return null;
    }
}

const before = await keyUsage();
const started = Date.now();
let unanswered = 0;

async function round(indexes: number[], into: "verdicts" | "again"): Promise<void> {
    const PARALLEL = 3;
    const batches: number[][] = [];
    for (let at = 0; at < indexes.length; at += BATCH) batches.push(indexes.slice(at, at + BATCH));
    for (let at = 0; at < batches.length; at += PARALLEL) {
        const answers = await Promise.all(
            batches.slice(at, at + PARALLEL).map(async batch => {
                const verdicts = await judge({
                    brief,
                    where: where!,
                    candidates: batch.map(i => ({ id: String(i), name: "", text: pool.texts[i]! })),
                });
                return { batch, verdicts };
            })
        );
        for (const { batch, verdicts } of answers) {
            for (const i of batch) {
                const verdict = verdicts.get(String(i));
                if (!verdict) {
                    unanswered += 1;
                    continue;
                }
                if (into === "again") (recorded.again ??= {})[String(i)] = verdict;
                else recorded.verdicts[String(i)] = verdict;
            }
        }
        writeVerdicts(recorded);
        const done = Math.min(batches.length, at + PARALLEL);
        if (done % 12 === 0 || done === batches.length)
            console.log(
                `  ${into}: ${done} of ${batches.length} calls (${Math.round((Date.now() - started) / 1000)} s)`
            );
    }
}

await round(missing, "verdicts");
await round(again, "again");
const after = await keyUsage();
const yes = Object.values(recorded.verdicts).filter(v => v.fit).length;
console.log(
    `Recorded: ${Object.keys(recorded.verdicts).length} verdicts (${yes} yes), ${Object.keys(recorded.again ?? {}).length} second opinions, ${unanswered} not answered for.`
);
if (before !== null && after !== null)
    console.log(
        `OpenRouter counts $${(after - before).toFixed(4)} spent on this key while this ran (anything else using the key at the same time is in that figure).`
    );
