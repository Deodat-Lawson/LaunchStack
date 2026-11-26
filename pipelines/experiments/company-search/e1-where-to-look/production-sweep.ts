/**
 * E1 against production — what the app's keyless place search returns on the
 * recorded segments.
 *
 *   pnpm exec tsx experiments/company-search/e1-where-to-look/production-sweep.ts
 *
 * Replays `createKeylessPorts().searchPlaces` against the recorded servers
 * (see ./production.ts) and writes ../results/e1-production-sweep.json.
 * Offline and deterministic: the same recording gives byte-identical results.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stringifyResults } from "../lib/json";
import { printReplay, replayProduction } from "./production";

// The search logs one line per call; the table below says the same.
const info = console.info;
console.info = () => undefined;
const replay = await replayProduction();
console.info = info;
if (!replay) {
    console.error("No E1 recordings on this machine; see the README (record.ts).");
    process.exit(1);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "..", "results");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "e1-production-sweep.json"), stringifyResults(replay));
printReplay(replay);
