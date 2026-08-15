/**
 * Campaign Planner benchmark runner — raw LLM-judge scores.
 *
 * Scores each candidate post in
 *   packages/features/src/marketing-pipeline/benchmark/candidates.sample.json
 * against its platform reference (references/<platform>.md), using the LLM judge
 * (scores only — never rewrites). Writes machine-readable results and prints a
 * per-post + per-criterion summary — the raw-score core of the benchmark.
 *
 * Run (calls the LLM judge API, so it's gated):
 *   RUN_LLM_BENCHMARK=1 pnpm --filter @launchstack/web test -- campaign-benchmark
 * (CHAT_API_KEY / AI_API_KEY — or GOOGLE_AI_API_KEY for the default Gemini
 * endpoint — is read from the repo-root .env; see benchmark/setup.ts.)
 */
import fs from "node:fs";
import path from "node:path";
import * as dotenv from "dotenv";

import {
    scorePost,
    configureJudgeFromEnv,
    JUDGE_CRITERIA,
    type ReferencePlatform,
    type ScoredPost,
} from "@launchstack/features/marketing-pipeline/benchmark";

const RUN = ["1", "true"].includes((process.env.RUN_LLM_BENCHMARK ?? "").toLowerCase());
const suite = RUN ? describe : describe.skip;

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const BENCH_DIR = path.join(REPO_ROOT, "packages/features/src/marketing-pipeline/benchmark");

interface Candidate {
    id: string;
    platform: ReferencePlatform;
    companyContext: string;
    post: string;
}

function loadReference(platform: ReferencePlatform, cache: Map<string, string>) {
    if (!cache.has(platform)) {
        cache.set(
            platform,
            fs.readFileSync(path.join(BENCH_DIR, "references", `${platform}.md`), "utf8")
        );
    }
    return cache.get(platform)!;
}

function mean(nums: number[]): number {
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

suite("campaign planner benchmark (LLM judge, raw scores)", () => {
    jest.setTimeout(180_000);

    it("scores candidates and writes results", async () => {
        dotenv.config({ path: path.join(REPO_ROOT, ".env") });
        configureJudgeFromEnv();

        const { candidates } = JSON.parse(
            fs.readFileSync(path.join(BENCH_DIR, "candidates.sample.json"), "utf8")
        ) as { candidates: Candidate[] };

        const runnable = candidates.filter(c => c.post && !c.post.trim().startsWith("<"));
        if (runnable.length === 0) {
            console.warn(
                "[benchmark] no runnable candidates — fill candidates.sample.json with real posts. Skipping."
            );
            return;
        }

        const refCache = new Map<string, string>();
        const results: (ScoredPost & { id: string })[] = [];
        for (const c of runnable) {
            const scored = await scorePost({
                platform: c.platform,
                companyContext: c.companyContext,
                post: c.post,
                referenceMarkdown: loadReference(c.platform, refCache),
            });
            results.push({ id: c.id, ...scored });
        }

        // Aggregate: overall mean + per-criterion mean across all scored posts.
        const overallMean = mean(results.map(r => r.overall));
        const byCriterion: Record<string, number> = {};
        for (const crit of JUDGE_CRITERIA) {
            byCriterion[crit] = mean(
                results.flatMap(r => r.scores.filter(s => s.criterion === crit).map(s => s.score))
            );
        }

        const runId = new Date().toISOString().replace(/[:.]/g, "-");
        const outDir = path.join(REPO_ROOT, "docs/pipeline/benchmarks", runId);
        fs.mkdirSync(outDir, { recursive: true });
        const payload = {
            runId,
            judgeModel: results[0]?.judgeModel,
            rubricVersion: results[0]?.rubricVersion,
            overallMean,
            byCriterion,
            results,
        };
        fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(payload, null, 2));

        // Human-readable summary.
        console.log(`\n=== Campaign Benchmark — ${results.length} post(s) ===`);
        console.log(
            `judge=${payload.judgeModel}  rubric=${payload.rubricVersion}  overallMean=${overallMean.toFixed(1)}`
        );
        for (const r of results) {
            console.log(`  ${r.id} [${r.platform}]  overall=${r.overall}`);
        }
        console.log("  per-criterion means:");
        for (const crit of JUDGE_CRITERIA) {
            console.log(`    ${crit.padEnd(20)} ${(byCriterion[crit] ?? 0).toFixed(1)}`);
        }
        console.log(`  results → ${path.relative(REPO_ROOT, outDir)}/results.json\n`);

        expect(results.every(r => r.scores.length > 0)).toBe(true);
    });
});
