/** External-cache runner. Input contains only questions and fixture workspace IDs. */
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import postgres from "postgres";
import { sql as statement } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { z } from "zod";
import { configureSecretBox } from "@launchstack/store/crypto";
import { resolveChatModel } from "@launchstack/llm";
import type { TopicSelectionProviders } from "../src/server/vantage/weekly-review-topic-run";
import { resolveDocumentDigestProvider } from "../src/server/vantage/document-digest-provider";
import { createAzureResponsesAgentPort } from "./vantage-benchmark-azure-port";
import {
    AZURE_LIVE_LIMIT,
    AZURE_LUNA_DEPLOYMENT,
    AZURE_LUNA_OUTPUT_LIMIT,
    AZURE_LUNA_RESERVATION_PER_MILLION,
    planAzureLive,
} from "./vantage-benchmark-azure-plan";
import { createBenchmarkMeter, type BenchmarkMeterSnapshot } from "./vantage-benchmark-meter";
import type {
    WeeklyReviewDatabase,
    WeeklyReviewQuery,
} from "../src/server/vantage/weekly-review-types";
import {
    assertBenchmarkDatabaseUrl,
    benchmarkFailureCode,
    BenchmarkQuestionSchema,
    type BenchmarkQuestion,
    runBenchmarkRetrieval,
    type BenchmarkArm,
} from "./vantage-benchmark-retrieval";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const fixtureDatabase = "vantage_rag_benchmark_20261121";
const revision = "39071af3f4dd25e59f5c59a6f9b6e8e99cd643b3";
const freeArms = ["baseline", "seeds", "scripted"] as const;
const armSchema = z.enum(["free", ...freeArms, "configured-live-dry-run", "configured-live"]);
const workspace = z.object({
    enterprise: z.string(),
    workspaceId: z.string().regex(/^[1-9]\d*$/),
});
const manifestSchema = z.object({
    databaseUrl: z.string(),
    revision: z.literal(revision),
    week: z.literal("2026-11-09"),
    asOf: z.literal("2026-11-16T00:00:00Z"),
    enterprises: z.array(workspace).length(5),
});
const localJson = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/);
const caseDeadlineCode = "topic_exploration_failed:timeout";
type BenchmarkResult = Awaited<ReturnType<typeof runBenchmarkRetrieval>>;
const caseFile = (directory: string, index: number) =>
    resolve(directory, "case-" + String(index + 1).padStart(2, "0") + ".json");
function isWithin(root: string, candidate: string) {
    const offset = relative(root, candidate);
    return !isAbsolute(offset) && offset !== ".." && !offset.startsWith(".." + sep);
}
async function cacheFile(cache: string, leaf: string) {
    const name = localJson.parse(leaf);
    const path = await realpath(resolve(cache, name));
    if (!isWithin(cache, path)) throw new Error("benchmark_cache_file_outside_cache");
    return path;
}
async function validateExternalCache(value: string) {
    const cache = await realpath(value);
    if (isWithin(await realpath(repository), cache))
        throw new Error("benchmark_cache_must_be_external");
    for (let path = cache; path !== dirname(path); path = dirname(path)) {
        try {
            await access(resolve(path, ".git"));
            throw new Error("benchmark_cache_must_be_external");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
    }
    return cache;
}
function verifyLockedCache(cache: string) {
    const check = spawnSync(
        process.execPath,
        [
            resolve(repository, "scripts/dev/vantage-rag-multi-corpus-loader.mjs"),
            "verify",
            cache,
            "--database",
        ],
        { encoding: "utf8", windowsHide: true }
    );
    if (check.error || check.status !== 0) throw new Error("benchmark_corpus_verification_failed");
}
async function replaceLocalJson(path: string, value: unknown) {
    const temporary = path + "." + randomUUID() + ".tmp";
    await writeFile(temporary, JSON.stringify(value) + "\n", { flag: "wx", flush: true });
    await rename(temporary, path);
}

async function loadLiveCheckpoint(
    cache: string,
    outputName: string,
    captureDir: string,
    requests: readonly BenchmarkQuestion[]
) {
    if ((await realpath(captureDir)) !== captureDir)
        throw new Error("benchmark_live_capture_directory_mismatch");
    const priorLedger = JSON.parse(
        await readFile(await cacheFile(captureDir, "usage-ledger.json"), "utf8")
    ) as BenchmarkMeterSnapshot;
    const prefix = JSON.parse(
        await readFile(await cacheFile(cache, outputName), "utf8")
    ) as BenchmarkResult[];
    if (
        !Array.isArray(prefix) ||
        !prefix.length ||
        prefix.length >= requests.length ||
        !Array.isArray(priorLedger.records) ||
        priorLedger.hold !== "usage_unresolved" ||
        prefix.at(-1)?.failure !== caseDeadlineCode
    )
        throw new Error("benchmark_live_checkpoint_not_resumable");
    let end = 0;
    for (const [index, result] of prefix.entries()) {
        const request = requests[index];
        if (
            !request ||
            result.arm !== "configured-live" ||
            result.caseId !== request.caseId ||
            result.enterprise !== request.enterprise ||
            result.workspaceId !== request.workspaceId
        )
            throw new Error("benchmark_live_checkpoint_request_mismatch");
        const name = caseFile(captureDir, index);
        if ((await realpath(name)) !== name) throw new Error("benchmark_live_case_path_mismatch");
        const capture = JSON.parse(await readFile(name, "utf8"));
        if (
            capture.caseId !== result.caseId ||
            capture.runId !== result.runId ||
            capture.status !== result.status ||
            capture.failure !== result.failure ||
            capture.ledgerStart !== end ||
            !Number.isSafeInteger(capture.ledgerEnd) ||
            capture.ledgerEnd < end
        )
            throw new Error("benchmark_live_checkpoint_case_mismatch");
        end = capture.ledgerEnd;
    }
    if (end !== priorLedger.records.length)
        throw new Error("benchmark_live_checkpoint_ledger_mismatch");
    return { prefix, priorLedger };
}

async function run() {
    const { values } = parseArgs({
        options: {
            cache: { type: "string" },
            requests: { type: "string" },
            output: { type: "string" },
            arm: { type: "string", default: "free" },
            "end-to-end": { type: "string", default: "0" },
            "cold-digests": { type: "boolean" },
            "approve-live": { type: "boolean" },
            "preflight-live": { type: "boolean" },
            "resume-live": { type: "boolean" },
        },
    });
    const arm = armSchema.parse(values.arm);
    const executeLive = arm === "configured-live";
    if (values["preflight-live"] && !executeLive)
        throw new Error("benchmark_preflight_requires_configured_live");
    if (values["preflight-live"]) {
        const { summary } = await planAzureLive();
        console.log(JSON.stringify(summary, null, 2));
        if (summary.paddedUsd > summary.limitUsd)
            throw new Error("benchmark_projected_budget_exceeded");
        return;
    }
    if (!values.cache || !values.requests || !values.output)
        throw new Error("benchmark_cache_requests_output_required");
    const endToEnd = z.coerce.number().int().min(0).max(2).parse(values["end-to-end"]);
    const resumeLive = Boolean(values["resume-live"]);
    if (
        executeLive !== Boolean(values["approve-live"]) ||
        (resumeLive && !executeLive) ||
        (executeLive && (Boolean(values["cold-digests"]) === resumeLive || endToEnd !== 0))
    )
        throw new Error("configured_live_requires_explicit_approval_and_freeze_only");
    const cache = await validateExternalCache(values.cache);
    const output = resolve(cache, localJson.parse(values.output));
    if (!resumeLive) {
        try {
            await access(output);
            throw new Error("benchmark_output_already_exists");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
    }
    verifyLockedCache(cache);
    const manifest = manifestSchema.parse(
        JSON.parse(await readFile(await cacheFile(cache, "corpus-manifest.json"), "utf8"))
    );
    const requests = z
        .array(BenchmarkQuestionSchema)
        .min(1)
        .max(100)
        .parse(JSON.parse(await readFile(await cacheFile(cache, values.requests), "utf8")));
    if ((arm === "configured-live-dry-run" || executeLive) && requests.length !== 20)
        throw new Error("configured_live_uses_only_the_20_case_pilot");
    if (new Set(requests.map(item => item.caseId)).size !== requests.length)
        throw new Error("duplicate_benchmark_case");
    const allowed = new Map(manifest.enterprises.map(item => [item.enterprise, item.workspaceId]));
    if (
        allowed.size !== 5 ||
        new Set(allowed.values()).size !== 5 ||
        requests.some(request => allowed.get(request.enterprise) !== request.workspaceId)
    )
        throw new Error("benchmark_workspace_manifest_mismatch");
    assertBenchmarkDatabaseUrl(manifest.databaseUrl);
    const live = executeLive ? await planAzureLive() : undefined;
    if (live) {
        console.log(JSON.stringify(live.summary, null, 2));
        if (live.summary.paddedUsd > AZURE_LIVE_LIMIT)
            throw new Error("benchmark_projected_budget_exceeded");
    }
    const captureDir = live ? output.replace(/\.json$/, ".evidence") : undefined;
    const checkpoint =
        captureDir && resumeLive
            ? await loadLiveCheckpoint(cache, values.output, captureDir, requests)
            : undefined;
    if (live && checkpoint) {
        const paddedIncludingPriorUsd =
            live.summary.paddedUsd + checkpoint.priorLedger.projectedTotalUsd;
        console.log(JSON.stringify({ paddedIncludingPriorUsd, limitUsd: AZURE_LIVE_LIMIT }));
        if (paddedIncludingPriorUsd > AZURE_LIVE_LIMIT)
            throw new Error("benchmark_projected_budget_exceeded");
    }
    if (captureDir && !resumeLive) {
        await mkdir(captureDir);
        await writeFile(output, "[]\n", { flag: "wx", flush: true });
    }
    const originalFetch = globalThis.fetch;
    let ledgerWrites = Promise.resolve();
    const meter =
        live && captureDir
            ? createBenchmarkMeter({
                  limitUsd: AZURE_LIVE_LIMIT,
                  modelId: AZURE_LUNA_DEPLOYMENT,
                  endpointUrl: live.endpoint + "/chat/completions",
                  pricingSource: live.summary.rateSource,
                  pricingScope:
                      "upper published Azure Standard rates, no cache discount, up to EU long-context cache writes",
                  promptUsdPerToken: AZURE_LUNA_RESERVATION_PER_MILLION.input / 1e6,
                  cachedPromptUsdPerToken: AZURE_LUNA_RESERVATION_PER_MILLION.input / 1e6,
                  cacheWriteUsdPerToken: AZURE_LUNA_RESERVATION_PER_MILLION.input / 1e6,
                  completionUsdPerToken: AZURE_LUNA_RESERVATION_PER_MILLION.output / 1e6,
                  contextTokens: 1_000_000,
                  maxOutputTokens: AZURE_LUNA_OUTPUT_LIMIT,
                  timeoutMs: 150_000,
                  ...(checkpoint
                      ? { priorLedger: checkpoint.priorLedger, allowLegacyPriorLedger: true }
                      : {}),
                  persist: snapshot =>
                      (ledgerWrites = ledgerWrites.then(() =>
                          replaceLocalJson(resolve(captureDir, "usage-ledger.json"), snapshot)
                      )),
              })
            : undefined;
    const meteredFetch = meter?.wrapFetch(originalFetch);
    const providers: TopicSelectionProviders | undefined =
        live && meteredFetch
            ? {
                  digest: resolveDocumentDigestProvider(options =>
                      resolveChatModel({ ...options, config: live.config, streaming: false })
                  ),
                  exploration: () =>
                      createAzureResponsesAgentPort({
                          endpoint: live.endpoint,
                          apiKey: live.apiKey,
                          deployment: AZURE_LUNA_DEPLOYMENT,
                          reasoningEffort: "high",
                          operatorInstructions: live.config.endpoint.systemInstructions,
                          fetch: meteredFetch,
                      }),
              }
            : undefined;
    configureSecretBox({ key: randomBytes(32).toString("base64") });
    const sql = postgres(manifest.databaseUrl, { max: 16 });
    const db = drizzle(sql);
    const database: WeeklyReviewDatabase = {
        transaction(work) {
            return db.transaction(tx => {
                const query: WeeklyReviewQuery = async (text, args = []) => {
                    const parts = text
                        .split(/(\$\d+)/g)
                        .map(part =>
                            /^\$\d+$/.test(part)
                                ? statement.param(args[Number(part.slice(1)) - 1])
                                : statement.raw(part)
                        );
                    return [
                        ...(await tx.execute(statement.join(parts, statement.raw("")))),
                    ] as Record<string, unknown>[];
                };
                return work(query);
            });
        },
    };
    const arms: readonly BenchmarkArm[] = arm === "free" ? freeArms : [arm];
    const selectedWorkspaces = [...allowed.values()];
    const dumpDigests = async () => {
        if (!captureDir) return;
        const digests =
            await sql`SELECT id::text,company_id::text,document_id::text,version_id::text,
            content_hash,format_version,headline,items FROM pdr_ai_v2_document_version_digests
            WHERE company_id=ANY(${selectedWorkspaces}::bigint[]) ORDER BY company_id,version_id,id`;
        await replaceLocalJson(resolve(captureDir, "digests.json"), digests);
    };
    const runLock = captureDir ? resolve(captureDir, "active.lock") : undefined;
    let locked = false;
    let startedLive = false;
    try {
        if (runLock) {
            await writeFile(runLock, "", { flag: "wx" });
            locked = true;
        }
        if (checkpoint && captureDir) {
            const current = await loadLiveCheckpoint(cache, values.output, captureDir, requests);
            if (
                current.prefix.length !== checkpoint.prefix.length ||
                JSON.stringify(current.priorLedger) !== JSON.stringify(checkpoint.priorLedger)
            )
                throw new Error("benchmark_live_checkpoint_changed");
        }
        if (meteredFetch) globalThis.fetch = meteredFetch;
        const [identity] = await sql`SELECT current_database() AS database_name`;
        if (identity?.database_name !== fixtureDatabase)
            throw new Error("benchmark_database_identity_changed");
        // Compare workspace IDs against actual fixture policies before making any writes.
        const policyRows =
            await sql`SELECT company_id::text FROM pdr_ai_v2_vantage_weekly_review_policy
            WHERE company_id=ANY(${[...allowed.values()]}::bigint[])`;
        if (policyRows.length !== allowed.size)
            throw new Error("benchmark_fixture_policies_missing");
        if (values["cold-digests"])
            await sql`DELETE FROM pdr_ai_v2_document_version_digests WHERE company_id=ANY(${[...allowed.values()]}::bigint[])`;
        startedLive = Boolean(live);
        if (checkpoint && meter) {
            await meter.clearCaseDeadlineHold({ terminalCode: caseDeadlineCode });
            console.log("Resuming after checkpoint case " + checkpoint.prefix.length);
        }
        const jobs: {
            index: number;
            request: BenchmarkQuestion;
            arm: BenchmarkArm;
            subject: string;
        }[] = [];
        for (const [index, request] of requests.entries()) {
            if (index < (checkpoint?.prefix.length ?? 0)) continue;
            for (const currentArm of arms) {
                const subject = randomUUID();
                const email = `benchmark-${subject}@example.test`;
                await sql.begin(async tx => {
                    await tx`INSERT INTO pdr_ai_v2_auth_user(id,name,email,created_at,updated_at)
                        VALUES (${subject},'Benchmark owner',${email},now(),now())`;
                    const [owner] =
                        await tx`INSERT INTO pdr_ai_v2_users(name,email,"userId",company_id,role,status)
                        VALUES ('Benchmark owner',${email},${subject},${request.workspaceId},'employer','active') RETURNING id`;
                    if (!owner) throw new Error("benchmark_owner_insert_failed");
                    await tx`INSERT INTO pdr_ai_v2_user_company_memberships(user_id,company_id,role,status)
                        VALUES (${owner.id},${request.workspaceId},'owner','active')`;
                });
                jobs.push({ index, request, arm: currentArm, subject });
            }
        }
        const results: BenchmarkResult[] = checkpoint?.prefix ?? [];
        // Serializable transactions can contend across workspaces on shared run tables.
        // Keep the capture schedule serial while retaining production transaction isolation.
        for (const job of jobs) {
            const id = job.request.workspaceId;
            const loadActor = async () => {
                const [row] = await sql`SELECT u."userId" AS subject, m.company_id::text, m.role
                        FROM pdr_ai_v2_users u JOIN pdr_ai_v2_user_company_memberships m ON m.user_id=u.id
                        WHERE u."userId"=${job.subject} AND m.company_id=${id} AND m.status='active' AND u.status='active'`;
                if (!row || row.role !== "owner") throw new Error("benchmark_owner_revoked");
                return {
                    companyId: String(row.company_id),
                    userId: String(row.subject),
                    role: "owner",
                    canRead: true,
                    canMutate: true,
                    canConfigure: true,
                    documentScope: { kind: "everything" as const },
                };
            };
            const ledgerStart = meter?.snapshot().records.length ?? 0;
            const result = await runBenchmarkRetrieval({
                database,
                databaseUrl: manifest.databaseUrl,
                loadActor,
                request: job.request,
                arm: job.arm,
                week: manifest.week,
                asOf: manifest.asOf,
                endToEnd: job.index < endToEnd,
                ...(providers ? { providers } : {}),
            });
            results.push(result);
            if (captureDir && meter) {
                await meter.drainPending();
                const [stored] = result.runId
                    ? await sql`SELECT trace,digest_ids,snapshot_commitment
                    FROM pdr_ai_v2_vantage_weekly_review_run_manifests
                    WHERE run_id=${result.runId}::uuid AND company_id=${id}::bigint
                      AND owner_id=${job.subject}`
                    : [];
                const checkpoint = meter.snapshot();
                await replaceLocalJson(caseFile(captureDir, job.index), {
                    ...result,
                    trace: stored?.trace ?? null,
                    digestIds: stored?.digest_ids ?? [],
                    snapshotCommitment: stored?.snapshot_commitment ?? null,
                    ledgerStart,
                    ledgerEnd: checkpoint.records.length,
                });
                await replaceLocalJson(output, results);
                await dumpDigests();
                console.log(
                    "Live case " +
                        (job.index + 1) +
                        " " +
                        result.status +
                        " · conservative list-rate $" +
                        checkpoint.settledListRateUsd.toFixed(3)
                );
                if (checkpoint.hold === "usage_unresolved" && result.failure === caseDeadlineCode) {
                    // The case is terminal. Keep every unknown request reserved and do not rerun it.
                    if (job.index < requests.length - 1)
                        await meter.clearCaseDeadlineHold({ terminalCode: caseDeadlineCode });
                } else if (checkpoint.hold) {
                    console.log("Live stop " + checkpoint.hold);
                    break;
                }
            }
            if (results.length % 30 === 0)
                console.log("Captured " + results.length + " of " + jobs.length);
        }
        if (!live) await writeFile(output, JSON.stringify(results) + "\n", { flag: "wx" });
        console.log("Captured " + results.length + " benchmark attempts.");
    } finally {
        globalThis.fetch = originalFetch;
        try {
            await ledgerWrites;
            if (startedLive && meter && captureDir) {
                await dumpDigests();
                await replaceLocalJson(resolve(captureDir, "usage-ledger.json"), meter.snapshot());
            }
        } finally {
            try {
                await sql.end();
            } finally {
                if (runLock && locked) await unlink(runLock);
            }
        }
    }
}

run().catch(error => {
    console.error(benchmarkFailureCode(error));
    process.exitCode = 1;
});
