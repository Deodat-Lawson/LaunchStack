/**
 * Entry point 2 of 2: run the experiment and write the results.
 *
 *   pnpm exec tsx experiments/company-search/e4-whom-to-check/run.ts
 *
 * Offline and deterministic: it reads only what record.ts cached (an
 * unrecorded request or a missing vector is an error, not a network call),
 * every random draw is seeded, and the results file carries no timestamp, so
 * two runs write the same bytes.
 *
 * Each pool runs in its own process when processors are free (E4_WORKERS
 * sets how many at once, 1 keeps everything in this process). The numbers
 * do not depend on it.
 */
import { fork } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NotRecordedError } from "../lib/recorder";
import { GRIDS, HYPER, SIMULATION, TUNING } from "./config";
import { createRecorder, createVectorSource, POOL_IDS } from "./data";
import { type JobResult, type JobSpec, runJob, type TaskSpec } from "./job";
import { decidePrefixMode } from "./prefix";
import { BATCH_SENSITIVITY_POLICIES, buildResults } from "./report";
import { DEV_SEGMENTS, REPORTED_SEGMENTS } from "./segments";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_FILE = path.resolve(HERE, "..", "results", "e4-whom-to-check.json");
const TUNING_FILE = path.join(HERE, "tuning.json");

const started = Date.now();
let decision: Awaited<ReturnType<typeof decidePrefixMode>>;
try {
    decision = await decidePrefixMode(
        createRecorder("replay"),
        createVectorSource({ offline: true })
    );
} catch (error) {
    // A fresh checkout has no recordings: say so and stop. Nothing has been written yet.
    const missing =
        error instanceof NotRecordedError ||
        (error instanceof Error && error.message.includes("not in the cache"));
    if (!missing) throw error;
    console.error(
        `${error instanceof Error ? error.message : String(error)}\nThe recording is missing or incomplete, and nothing was written. Record first:\n  COMPANY_SEARCH_BENCH_MODE=record pnpm exec tsx experiments/company-search/e4-whom-to-check/record.ts`
    );
    process.exit(1);
}

const requested = Number(process.env.E4_WORKERS ?? "");
/** Processes at once: E4_WORKERS, else one per job while a processor stays free for everything else. */
const atOnce =
    Number.isFinite(requested) && requested >= 1
        ? Math.floor(requested)
        : Math.max(1, Math.min(5, availableParallelism() - 1));
/**
 * With several processes, a pool with more segments than this is split over
 * jobs so the big pool does not hold the run up; each job then builds the
 * pool's matrix again. In one process the matrix is built once per pool.
 */
const SEGMENTS_PER_JOB = atOnce > 1 ? 2 : Number.POSITIVE_INFINITY;

const jobs: JobSpec[] = [];
for (const poolId of POOL_IDS) {
    const segments = REPORTED_SEGMENTS.filter(s => s.pool === poolId).map(segment => {
        const tasks: TaskSpec[] = [{ language: "en", batchSize: SIMULATION.batchSize }];
        for (const batchSize of SIMULATION.otherBatchSizes)
            tasks.push({ language: "en", batchSize, policies: BATCH_SENSITIVITY_POLICIES });
        if (segment.norwegian) tasks.push({ language: "no", batchSize: SIMULATION.batchSize });
        return { segmentId: segment.id, tasks };
    });
    for (let at = 0; at < segments.length; at += SEGMENTS_PER_JOB)
        jobs.push({
            poolId,
            mode: decision.used,
            segments: segments.slice(at, at + SEGMENTS_PER_JOB),
            seeds: [...SIMULATION.seeds],
            hyper: HYPER,
        });
}

function inChild(job: JobSpec): Promise<JobResult> {
    return new Promise((resolve, reject) => {
        const child = fork(path.join(HERE, "worker.ts"), [], {
            stdio: ["ignore", "inherit", "inherit", "ipc"],
        });
        let settled = false;
        child.on("message", (message: { ok: boolean; result?: JobResult; error?: string }) => {
            settled = true;
            if (message.ok && message.result) resolve(message.result);
            else reject(new Error(`${job.poolId}: ${message.error ?? "job failed"}`));
        });
        child.on("error", reject);
        child.on("exit", code => {
            if (!settled) reject(new Error(`${job.poolId}: worker exited with code ${code}`));
        });
        child.send(job);
    });
}

async function runAll(all: JobSpec[], atOnce: number): Promise<JobResult[]> {
    const results = new Array<JobResult>(all.length);
    if (atOnce <= 1) {
        for (const [i, job] of all.entries()) results[i] = await runJob(job);
        return results;
    }
    let next = 0;
    const lane = async (): Promise<void> => {
        for (;;) {
            const i = next++;
            if (i >= all.length) return;
            results[i] = await inChild(all[i]!);
        }
    };
    await Promise.all(Array.from({ length: Math.min(atOnce, all.length) }, lane));
    return results;
}

const jobResults = await runAll(jobs, atOnce);

const tuning = existsSync(TUNING_FILE)
    ? (JSON.parse(readFileSync(TUNING_FILE, "utf8")) as Record<string, unknown>)
    : null;
const { results, table } = buildResults(jobResults, {
    decision,
    tuning,
    hyper: HYPER,
    grids: GRIDS,
    tuningSeeds: [...TUNING.seeds],
    devSegments: DEV_SEGMENTS.map(s => s.id),
});

mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
writeFileSync(RESULTS_FILE, `${JSON.stringify(results, null, 2)}\n`);

console.log(table);
const cpu: Record<string, number> = {};
for (const job of jobResults)
    for (const [phase, seconds] of Object.entries(job.cpu))
        cpu[phase] = (cpu[phase] ?? 0) + seconds;
const total = Object.values(cpu).reduce((sum, v) => sum + v, 0);
const heaviest = Object.entries(cpu)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([phase, seconds]) => `${phase} ${seconds.toFixed(0)} s`)
    .join("; ");
console.log(
    `\nwrote ${path.relative(process.cwd(), RESULTS_FILE)} in ${((Date.now() - started) / 1000).toFixed(0)} s wall (${atOnce} process${atOnce === 1 ? "" : "es"} at once; ${total.toFixed(0)} s of processor time in the jobs: ${heaviest})`
);
