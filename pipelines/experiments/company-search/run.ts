/**
 * Replays every company-search experiment from the local recordings and
 * rewrites ./results/*.json. Offline: nothing leaves the machine.
 *
 *   pnpm exec tsx experiments/company-search/run.ts            # all experiments
 *   pnpm exec tsx experiments/company-search/run.ts e1 e3      # only these
 *
 * Each experiment is its own script, run in its own process so one cannot
 * disturb another. Recording (the only step that touches the network) is
 * separate: see each experiment's record.ts and the README.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXPERIMENTS: Record<string, string> = {
    e1: "e1-where-to-look/run.ts",
    e2: "e2-what-to-ask/run.ts",
    e3: "e3-what-to-read/run.ts",
    e4: "e4-whom-to-check/run.ts",
};

const here = path.dirname(fileURLToPath(import.meta.url));
const wanted = process.argv.slice(2);
const ids = wanted.length > 0 ? wanted : Object.keys(EXPERIMENTS);
let failed = 0;
for (const id of ids) {
    const script = EXPERIMENTS[id];
    if (!script) {
        console.error(`Unknown experiment "${id}". Known: ${Object.keys(EXPERIMENTS).join(", ")}`);
        failed += 1;
        continue;
    }
    console.log(`\n######## ${id}: ${script}`);
    const started = Date.now();
    const result = spawnSync("pnpm", ["exec", "tsx", path.join(here, script)], {
        stdio: "inherit",
        // Replay only: a missing recording is an error, never a live request.
        env: { ...process.env, COMPANY_SEARCH_BENCH_MODE: "replay" },
    });
    console.log(`######## ${id} finished in ${Math.round((Date.now() - started) / 1000)} s`);
    if (result.status !== 0) failed += 1;
}
process.exit(failed === 0 ? 0 : 1);
