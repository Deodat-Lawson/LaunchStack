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
import {
    prewarmTopicDigests,
    type TopicSelectionProviders,
} from "../src/server/vantage/weekly-review-topic-run";
import { resolveDocumentDigestProvider } from "../src/server/vantage/document-digest-provider";
import { createAzureResponsesAgentPort } from "./vantage-benchmark-azure-port";
import {
    AZURE_LIVE_LIMIT,
    AZURE_LUNA_DEPLOYMENT,
    AZURE_LUNA_OUTPUT_LIMIT,
    AZURE_LUNA_RESERVATION_PER_MILLION,
    planAzureLive,
    projectAzureLive,
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
const identifier = z.string().regex(/^[1-9]\d*$/);
const workspace = z.object({
    enterprise: z.string(),
    workspaceId: identifier,
    seedOwnerId: z.string().regex(/^rag-benchmark-seed-[1-9]\d*$/),
});
const digestDocument = z.object({
    workspaceId: identifier,
    documentId: identifier,
    versionId: identifier,
    canonicalHash: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().positive(),
});
type DigestDocument = z.infer<typeof digestDocument>;
type BenchmarkSql = ReturnType<typeof postgres>;
const manifestSchema = z.object({
    databaseUrl: z.string(),
    revision: z.literal(revision),
    week: z.literal("2026-11-09"),
    asOf: z.literal("2026-11-16T00:00:00Z"),
    enterprises: z.array(workspace).length(5),
    documents: z.array(digestDocument).length(236),
});
const localJson = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/);
const caseDeadlineCode = "topic_exploration_failed:timeout";
const warmUpSchema = z.object({
    workspaceIds: z.array(identifier).min(1).max(5),
    documents: z.number().int().positive(),
    groundedDigests: z.number().int().nonnegative(),
    generatedProviderCalls: z.number().int().nonnegative(),
    cacheHits: z.number().int().nonnegative(),
    elapsedMs: z.number().nonnegative(),
    ledgerStart: z.literal(0),
    ledgerEnd: z.number().int().nonnegative(),
});
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

async function assertFixtureDatabase(sql: BenchmarkSql, workspaces: string[]) {
    const [identity] = await sql`SELECT current_database() AS database_name`;
    if (identity?.database_name !== fixtureDatabase)
        throw new Error("benchmark_database_identity_changed");
    const policies = await sql`SELECT company_id::text FROM pdr_ai_v2_vantage_weekly_review_policy
        WHERE company_id=ANY(${workspaces}::bigint[])`;
    if (policies.length !== workspaces.length)
        throw new Error("benchmark_fixture_policies_missing");
}

async function missingDigestDocuments(sql: BenchmarkSql, documents: DigestDocument[]) {
    const versions = documents.map(document => document.versionId);
    const rows =
        await sql`SELECT company_id::text AS workspace_id,document_id::text,version_id::text,content_hash
        FROM pdr_ai_v2_document_version_digests
        WHERE version_id=ANY(${versions}::bigint[]) AND format_version='doc-digest/1'`;
    const present = new Set(
        rows.map(row =>
            [row.workspace_id, row.document_id, row.version_id, row.content_hash].join(":")
        )
    );
    return documents.filter(
        document =>
            !present.has(
                [
                    document.workspaceId,
                    document.documentId,
                    document.versionId,
                    document.canonicalHash,
                ].join(":")
            )
    );
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
    const warmUp = warmUpSchema.parse(
        JSON.parse(await readFile(await cacheFile(captureDir, "warm-up.json"), "utf8"))
    );
    if (
        warmUp.documents !== warmUp.groundedDigests ||
        warmUp.ledgerEnd > priorLedger.records.length
    )
        throw new Error("benchmark_live_checkpoint_warm_up_mismatch");
    let end = warmUp.ledgerEnd;
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
    return { prefix, priorLedger, warmUp };
}

async function run() {
    const { values } = parseArgs({
        options: {
            cache: { type: "string" },
            requests: { type: "string" },
            output: { type: "string" },
            arm: { type: "string", default: "free" },
            "end-to-end": { type: "string", default: "0" },
            "warm-workspace": { type: "string" },
            "approve-live": { type: "boolean" },
            "preflight-live": { type: "boolean" },
            "resume-live": { type: "boolean" },
        },
    });
    const arm = armSchema.parse(values.arm);
    const executeLive = arm === "configured-live";
    const preflight = Boolean(values["preflight-live"]);
    const warmWorkspace =
        values["warm-workspace"] === undefined
            ? undefined
            : identifier.parse(values["warm-workspace"]);
    if (preflight && (!executeLive || values["approve-live"]))
        throw new Error("benchmark_preflight_requires_configured_live_without_approval_flag");
    if (!values.cache || (!preflight && (!values.output || (!values.requests && !warmWorkspace))))
        throw new Error("benchmark_cache_requests_output_required");
    const outputName = localJson.parse(values.output ?? "preflight.json");
    const endToEnd = z.coerce.number().int().min(0).max(2).parse(values["end-to-end"]);
    const resumeLive = Boolean(values["resume-live"]);
    if (
        (!preflight && executeLive !== Boolean(values["approve-live"])) ||
        (resumeLive && (!executeLive || warmWorkspace || preflight)) ||
        (warmWorkspace && !executeLive) ||
        (executeLive && endToEnd !== 0)
    )
        throw new Error("configured_live_requires_explicit_approval_and_freeze_only");
    const cache = await validateExternalCache(values.cache);
    const output = resolve(cache, outputName);
    if (!resumeLive && !preflight) {
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
    const requests =
        warmWorkspace || preflight
            ? []
            : z
                  .array(BenchmarkQuestionSchema)
                  .min(1)
                  .max(100)
                  .parse(
                      JSON.parse(await readFile(await cacheFile(cache, values.requests!), "utf8"))
                  );
    if (executeLive && !warmWorkspace && !preflight && requests.length !== 100)
        throw new Error("configured_live_requires_the_100_case_sample");
    if (new Set(requests.map(item => item.caseId)).size !== requests.length)
        throw new Error("duplicate_benchmark_case");
    const allowed = new Map(manifest.enterprises.map(item => [item.enterprise, item.workspaceId]));
    if (
        allowed.size !== 5 ||
        new Set(allowed.values()).size !== 5 ||
        manifest.documents.some(
            document => ![...allowed.values()].includes(document.workspaceId)
        ) ||
        new Set(manifest.documents.map(document => document.versionId)).size !==
            manifest.documents.length ||
        requests.some(request => allowed.get(request.enterprise) !== request.workspaceId)
    )
        throw new Error("benchmark_workspace_manifest_mismatch");
    assertBenchmarkDatabaseUrl(manifest.databaseUrl);
    const selectedWorkspaces = manifest.enterprises.filter(
        entry => !warmWorkspace || entry.workspaceId === warmWorkspace
    );
    if (!selectedWorkspaces.length) throw new Error("benchmark_warm_workspace_not_owned");
    const selectedWorkspaceIds = selectedWorkspaces.map(entry => entry.workspaceId);
    const digestDocuments = manifest.documents.filter(document =>
        selectedWorkspaceIds.includes(document.workspaceId)
    );
    const live = executeLive ? planAzureLive() : undefined;
    const captureDir = live ? output.replace(/\.json$/, ".evidence") : undefined;
    const checkpoint =
        captureDir && resumeLive
            ? await loadLiveCheckpoint(cache, outputName, captureDir, requests)
            : undefined;
    if (live) {
        const inspection = postgres(manifest.databaseUrl, { max: 1 });
        try {
            await assertFixtureDatabase(inspection, selectedWorkspaceIds);
            const missing = await missingDigestDocuments(inspection, digestDocuments);
            const forecast = projectAzureLive({
                remainingCases: warmWorkspace ? 0 : 100 - (checkpoint?.prefix.length ?? 0),
                missingDigestBytes: missing.map(document => document.bytes),
                currentExposureUsd: checkpoint?.priorLedger.projectedTotalUsd ?? 0,
            });
            console.log(
                JSON.stringify(
                    { routes: live.routes, rateSource: live.rateSource, forecast },
                    null,
                    2
                )
            );
            if (forecast.projectedUsd > AZURE_LIVE_LIMIT)
                throw new Error("benchmark_projected_budget_exceeded");
        } finally {
            await inspection.end();
        }
        if (preflight) return;
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
                  pricingSource: live.rateSource,
                  pricingScope:
                      "upper published Azure Standard rates, no cache discount, up to EU long-context cache writes",
                  promptUsdPerToken: AZURE_LUNA_RESERVATION_PER_MILLION.input / 1e6,
                  cachedPromptUsdPerToken: AZURE_LUNA_RESERVATION_PER_MILLION.input / 1e6,
                  cacheWriteUsdPerToken: AZURE_LUNA_RESERVATION_PER_MILLION.input / 1e6,
                  completionUsdPerToken: AZURE_LUNA_RESERVATION_PER_MILLION.output / 1e6,
                  contextTokens: 1_000_000,
                  maxOutputTokens: AZURE_LUNA_OUTPUT_LIMIT,
                  timeoutMs: 150_000,
                  ...(checkpoint ? { priorLedger: checkpoint.priorLedger } : {}),
                  persist: snapshot =>
                      (ledgerWrites = ledgerWrites.then(() =>
                          replaceLocalJson(resolve(captureDir, "usage-ledger.json"), snapshot)
                      )),
              })
            : undefined;
    const meteredFetch = meter?.wrapFetch(originalFetch);
    const azureDigest = live
        ? resolveDocumentDigestProvider(options =>
              resolveChatModel({ ...options, config: live.config, streaming: false })
          )
        : undefined;
    const providers: TopicSelectionProviders | undefined =
        live && meteredFetch
            ? {
                  digest: async () => {
                      throw new Error("benchmark_digest_missing_after_warm_up");
                  },
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
    const query: WeeklyReviewQuery = (text, args) =>
        database.transaction(runQuery => runQuery(text, args));
    const loadOwner = async (workspaceId: string, subject: string) => {
        const [row] = await sql`SELECT u."userId" AS subject, m.company_id::text, m.role
            FROM pdr_ai_v2_users u JOIN pdr_ai_v2_user_company_memberships m ON m.user_id=u.id
            WHERE u."userId"=${subject} AND m.company_id=${workspaceId} AND m.status='active' AND u.status='active'`;
        if (!row || row.role !== "owner") throw new Error("benchmark_owner_revoked");
        return {
            companyId: String(row.company_id),
            userId: String(row.subject),
            role: "owner" as const,
            canRead: true,
            canMutate: true,
            canConfigure: true,
            documentScope: { kind: "everything" as const },
        };
    };
    const epoch = async (id: string) => {
        const [row] = await sql`SELECT version::text FROM pdr_ai_v2_vantage_weekly_review_epochs
            WHERE company_id=${id}::bigint`;
        return row?.version ?? null;
    };
    const arms: readonly BenchmarkArm[] = arm === "free" ? freeArms : [arm];
    const dumpDigests = async () => {
        if (!captureDir) return;
        const digests =
            await sql`SELECT id::text,company_id::text,document_id::text,version_id::text,
            content_hash,format_version,headline,items FROM pdr_ai_v2_document_version_digests
            WHERE company_id=ANY(${selectedWorkspaceIds}::bigint[]) ORDER BY company_id,version_id,id`;
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
            const current = await loadLiveCheckpoint(cache, outputName, captureDir, requests);
            if (
                current.prefix.length !== checkpoint.prefix.length ||
                JSON.stringify(current.priorLedger) !== JSON.stringify(checkpoint.priorLedger)
            )
                throw new Error("benchmark_live_checkpoint_changed");
        }
        if (meteredFetch) globalThis.fetch = meteredFetch;
        await assertFixtureDatabase(sql, selectedWorkspaceIds);
        startedLive = Boolean(live);
        let warmUp = checkpoint?.warmUp;
        if (checkpoint && meter) {
            if ((await missingDigestDocuments(sql, digestDocuments)).length)
                throw new Error("benchmark_resume_requires_intact_digest_cache");
            await meter.clearCaseDeadlineHold({ terminalCode: caseDeadlineCode });
            console.log("Resuming after checkpoint case " + checkpoint.prefix.length);
        } else if (azureDigest && meter && captureDir) {
            const warmStart = performance.now();
            let generatedProviderCalls = 0;
            let groundedDigests = 0;
            let warmError: Error | undefined;
            try {
                for (const workspace of selectedWorkspaces) {
                    const actor = await loadOwner(workspace.workspaceId, workspace.seedOwnerId);
                    const authorityEpoch = await epoch(workspace.workspaceId);
                    const candidates = digestDocuments.filter(
                        doc => doc.workspaceId === workspace.workspaceId
                    );
                    const ids = new Set(candidates.map(doc => doc.documentId));
                    const prepared = await prewarmTopicDigests({
                        actor,
                        versionIds: candidates.map(doc => doc.versionId),
                        query,
                        provider: input => {
                            generatedProviderCalls++;
                            return azureDigest(input);
                        },
                        authorizeDocument: async document => {
                            if (!ids.has(String(document.id))) return false;
                            const current = await loadOwner(
                                workspace.workspaceId,
                                workspace.seedOwnerId
                            );
                            return (
                                current.canMutate &&
                                (await epoch(workspace.workspaceId)) === authorityEpoch
                            );
                        },
                    });
                    groundedDigests += prepared.digests.size;
                    if (prepared.digests.size !== candidates.length)
                        throw new Error("benchmark_digest_warm_up_incomplete");
                }
            } catch (error) {
                warmError =
                    error instanceof Error
                        ? error
                        : new Error("benchmark_digest_warm_up_incomplete");
            }
            await meter.drainPending();
            const missing = await missingDigestDocuments(sql, digestDocuments);
            const ledger = meter.snapshot();
            warmUp = {
                workspaceIds: selectedWorkspaceIds,
                documents: digestDocuments.length,
                groundedDigests,
                generatedProviderCalls,
                cacheHits: Math.max(0, groundedDigests - generatedProviderCalls),
                elapsedMs: performance.now() - warmStart,
                ledgerStart: 0,
                ledgerEnd: ledger.records.length,
            };
            await replaceLocalJson(resolve(captureDir, "warm-up.json"), warmUp);
            await dumpDigests();
            console.log(
                JSON.stringify({
                    digestWarmUp: warmUp,
                    spendUsd: ledger.projectedTotalUsd,
                    hold: ledger.hold,
                })
            );
            if (warmError) throw warmError;
            if (missing.length || ledger.hold)
                throw new Error("benchmark_digest_warm_up_incomplete");
            if (warmWorkspace) return;
        }
        const warmExposureUsd =
            meter
                ?.snapshot()
                .records.slice(0, warmUp?.ledgerEnd ?? 0)
                .reduce((sum, row) => sum + (row.settledListRateUsd ?? row.projectedUsd), 0) ?? 0;
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
            const loadActor = () => loadOwner(id, job.subject);
            const exposure = meter?.snapshot();
            if (exposure) {
                const forecast = projectAzureLive({
                    remainingCases: requests.length - results.length,
                    currentExposureUsd: exposure.projectedTotalUsd,
                    completedExplorationCases: results.length,
                    completedExplorationExposureUsd: Math.max(
                        0,
                        exposure.projectedTotalUsd - warmExposureUsd
                    ),
                });
                if (forecast.projectedUsd > AZURE_LIVE_LIMIT) {
                    console.log(
                        JSON.stringify({ liveStop: "projected_budget_exceeded", forecast })
                    );
                    break;
                }
            }
            const ledgerStart = exposure?.records.length ?? 0;
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
