/** External-cache runner. Input contains only questions and fixture workspace IDs. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
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
import {
    sweepForecast,
    sweepSchedule,
    BENCHMARK_MAX_CONCURRENCY,
    type SweepStep,
} from "./vantage-benchmark-sweep";
import {
    HELDOUT_GROUPS_SHA256,
    PRIOR_SWEEP_CAPTURE_SHA256,
    PRIOR_SWEEP_LEDGER_SHA256,
    RELIABILITY_FREE_ARMS,
    RELIABILITY_SWEEP_LIMIT_USD,
    reliabilitySweepSchedule,
} from "./vantage-benchmark-reliability";
import type {
    WeeklyReviewDatabase,
    WeeklyReviewQuery,
} from "../src/server/vantage/weekly-review-types";
import {
    assertBenchmarkDatabaseUrl,
    BENCHMARK_FREE_ARMS,
    benchmarkFailureCode,
    BenchmarkGroupSchema,
    BenchmarkQuestionSchema,
    type BenchmarkGroup,
    type BenchmarkQuestion,
    runBenchmarkRetrieval,
    type BenchmarkArm,
} from "./vantage-benchmark-retrieval";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const fixtureDatabase = "vantage_rag_benchmark_20261121";
const revision = "39071af3f4dd25e59f5c59a6f9b6e8e99cd643b3";
const freeArms = ["baseline", "seeds", "scripted"] as const;
const armSchema = z.enum([
    "free",
    ...BENCHMARK_FREE_ARMS,
    "configured-live-dry-run",
    "configured-live",
]);
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
type BenchmarkRequest = BenchmarkQuestion | BenchmarkGroup;
const requestId = (request: BenchmarkRequest) =>
    "groupId" in request ? request.groupId : request.caseId;
const topicCount = (requests: readonly BenchmarkRequest[]) =>
    requests.reduce((sum, request) => sum + ("topics" in request ? request.topics.length : 1), 0);
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
    requests: readonly BenchmarkRequest[]
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
            result.caseId !== requestId(request) ||
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

async function loadSweepCheckpoint(
    cache: string,
    outputName: string,
    captureDir: string,
    schedule: readonly SweepStep[]
) {
    if ((await realpath(captureDir)) !== captureDir)
        throw new Error("benchmark_live_capture_directory_mismatch");
    const read = async (root: string, name: string): Promise<unknown> =>
        JSON.parse(await readFile(await cacheFile(root, name), "utf8"));
    const status = z
        .object({
            complete: z.literal(false),
            completed: z
                .number()
                .int()
                .positive()
                .max(schedule.length - 1),
            expected: z.literal(schedule.length),
            stopReason: z.literal("usage_unresolved"),
        })
        .parse(await read(captureDir, "sweep-status.json"));
    const rowSchema = z
        .object({
            workId: z.string().regex(/^sweep-[0-9]{3}$/),
            runId: z.string().uuid().optional(),
            caseId: z.string(),
            arm: z.enum(["configured-live", "configured-live+backfill"]),
            cohort: z.enum(["exploratory", "heldout"]),
            status: z.enum(["ok", "failed"]),
            retrievalLimits: z.object({ sharedEvidenceBytes: z.number() }).passthrough(),
        })
        .passthrough();
    const rows = z
        .array(rowSchema)
        .length(status.completed * 2)
        .parse(await read(cache, outputName));
    const priorLedger = (await read(captureDir, "usage-ledger.json")) as BenchmarkMeterSnapshot;
    const warmUp = warmUpSchema.parse(await read(captureDir, "warm-up.json"));
    const prefix = schedule.slice(0, status.completed);
    const workIds = new Set(prefix.map(step => step.workId));
    if (
        priorLedger.hold !== "usage_unresolved" ||
        !Array.isArray(priorLedger.records) ||
        priorLedger.records.some(row => !row.workId || !workIds.has(row.workId)) ||
        warmUp.documents !== warmUp.groundedDigests ||
        warmUp.ledgerEnd !== 0
    )
        throw new Error("benchmark_sweep_checkpoint_not_resumable");
    for (const [index, step] of prefix.entries()) {
        const first = rows[index * 2]!;
        const second = rows[index * 2 + 1]!;
        if (
            first.arm !== "configured-live" ||
            second.arm !== "configured-live+backfill" ||
            first.runId !== second.runId ||
            second.backfillOfRunId !== first.runId ||
            [first, second].some(
                row =>
                    row.workId !== step.workId ||
                    row.caseId !== step.request.groupId ||
                    row.cohort !== step.cohort ||
                    row.retrievalLimits.sharedEvidenceBytes !== step.evidenceCapBytes
            )
        )
            throw new Error("benchmark_sweep_checkpoint_request_mismatch");
        const saved = z
            .object({
                workId: z.literal(step.workId),
                primary: rowSchema,
                backfill: rowSchema,
            })
            .parse(await read(captureDir, step.workId + ".json"));
        if (
            JSON.stringify(saved.primary) !== JSON.stringify(first) ||
            JSON.stringify(saved.backfill) !== JSON.stringify(second)
        )
            throw new Error("benchmark_sweep_checkpoint_case_mismatch");
    }
    return { completed: status.completed, rows, priorLedger, warmUp };
}

async function run() {
    const { values } = parseArgs({
        options: {
            cache: { type: "string" },
            requests: { type: "string" },
            grouped: { type: "boolean" },
            "heldout-groups": { type: "string" },
            "heldout-reliability": { type: "boolean" },
            "failure-audit": { type: "string" },
            concurrency: { type: "string", default: "1" },
            "free-proof": { type: "string" },
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
    const grouped = Boolean(values.grouped);
    const reliability = Boolean(values["heldout-reliability"]);
    const sweep = reliability || Boolean(values["heldout-groups"]);
    const concurrency = z.coerce
        .number()
        .int()
        .min(1)
        .max(BENCHMARK_MAX_CONCURRENCY)
        .parse(values.concurrency);
    const liveLimit = reliability ? RELIABILITY_SWEEP_LIMIT_USD : AZURE_LIVE_LIMIT;
    const sweepFreeArms = reliability ? RELIABILITY_FREE_ARMS : (["seeds", "scripted"] as const);
    const warmWorkspace =
        values["warm-workspace"] === undefined
            ? undefined
            : identifier.parse(values["warm-workspace"]);
    if (preflight && (!executeLive || values["approve-live"]))
        throw new Error("benchmark_preflight_requires_configured_live_without_approval_flag");
    if (
        !values.cache ||
        (grouped && (!values.requests || warmWorkspace)) ||
        (!preflight && (!values.output || (!values.requests && !warmWorkspace)))
    )
        throw new Error("benchmark_cache_requests_output_required");
    const outputName = localJson.parse(values.output ?? "preflight.json");
    const endToEnd = z.coerce.number().int().min(0).max(2).parse(values["end-to-end"]);
    const resumeLive = Boolean(values["resume-live"]);
    if (
        (!preflight && executeLive !== Boolean(values["approve-live"])) ||
        (resumeLive && (!executeLive || warmWorkspace || preflight || reliability)) ||
        (!sweep && concurrency !== 1) ||
        (reliability && (values["heldout-groups"] || (executeLive && !values["failure-audit"]))) ||
        (warmWorkspace && !executeLive) ||
        (executeLive && endToEnd !== 0) ||
        (sweep &&
            (!grouped ||
                endToEnd !== 0 ||
                (!executeLive && arm !== "free") ||
                (executeLive && !preflight && !values["free-proof"])))
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
    const requests: BenchmarkRequest[] = [];
    if (!warmWorkspace && (!preflight || grouped)) {
        const requestText = await readFile(await cacheFile(cache, values.requests!), "utf8");
        const parsed: unknown = JSON.parse(requestText);
        if (grouped) {
            if (
                reliability &&
                createHash("sha256").update(requestText).digest("hex") !== HELDOUT_GROUPS_SHA256
            )
                throw new Error("benchmark_heldout_roster_invalid");
            const groups = z.array(BenchmarkGroupSchema).min(1).max(100).parse(parsed);
            const pool = z
                .array(BenchmarkQuestionSchema)
                .length(100)
                .parse(
                    JSON.parse(
                        await readFile(
                            await cacheFile(
                                cache,
                                reliability ? "heldout100-requests.json" : "sample100-requests.json"
                            ),
                            "utf8"
                        )
                    )
                );
            const byCase = new Map(pool.map(question => [question.caseId, question]));
            if (
                byCase.size !== pool.length ||
                groups.some(group =>
                    group.topics.some(topic => {
                        const original = byCase.get(topic.caseId);
                        return (
                            original?.enterprise !== group.enterprise ||
                            original?.workspaceId !== group.workspaceId ||
                            original?.question !== topic.question
                        );
                    })
                )
            )
                throw new Error("benchmark_group_member_outside_enterprise_pool");
            const memberships = groups.flatMap(group =>
                group.topics.map(topic => group.topics.length + ":" + topic.caseId)
            );
            if (new Set(memberships).size !== memberships.length)
                throw new Error("duplicate_benchmark_group_member_in_size");
            if (
                (executeLive || reliability) &&
                (groups.filter(group => group.topics.length === 3).length !== 30 ||
                    groups.filter(group => group.topics.length === 5).length !== 20)
            )
                throw new Error("configured_live_requires_the_50_group_sample");
            requests.push(...groups);
            console.log(
                JSON.stringify({
                    groupCount: groups.length,
                    topicPositions: topicCount(groups),
                    requestsSha256: createHash("sha256").update(requestText, "utf8").digest("hex"),
                })
            );
        } else {
            const questions = z.array(BenchmarkQuestionSchema).min(1).max(100).parse(parsed);
            if (executeLive && questions.length !== 100)
                throw new Error("configured_live_requires_the_100_case_sample");
            requests.push(...questions);
        }
    }
    if (new Set(requests.map(requestId)).size !== requests.length)
        throw new Error("duplicate_benchmark_case");
    const sweepSteps = reliability
        ? await (async () => {
              const groups = z.array(BenchmarkGroupSchema).length(50).parse(requests);
              if (!executeLive) return reliabilitySweepSchedule(groups);
              const oldCapture = await readFile(
                  await cacheFile(cache, "budget-sweep-live.json"),
                  "utf8"
              );
              const oldDirectory = resolve(cache, "budget-sweep-live.evidence");
              if ((await realpath(oldDirectory)) !== oldDirectory)
                  throw new Error("benchmark_reliability_archive_mismatch");
              const oldLedger = await readFile(
                  await cacheFile(oldDirectory, "usage-ledger.json"),
                  "utf8"
              );
              if (
                  createHash("sha256").update(oldCapture).digest("hex") !==
                      PRIOR_SWEEP_CAPTURE_SHA256 ||
                  createHash("sha256").update(oldLedger).digest("hex") !== PRIOR_SWEEP_LEDGER_SHA256
              )
                  throw new Error("benchmark_reliability_archive_mismatch");
              const audit = JSON.parse(
                  await readFile(await cacheFile(cache, values["failure-audit"]!), "utf8")
              );
              return reliabilitySweepSchedule(groups, { audit, results: JSON.parse(oldCapture) });
          })()
        : sweep
          ? await (async () => {
                const heldoutText = await readFile(
                    await cacheFile(cache, values["heldout-groups"]!),
                    "utf8"
                );
                const heldout = z
                    .array(BenchmarkGroupSchema)
                    .length(50)
                    .parse(JSON.parse(heldoutText));
                const pool = z
                    .array(BenchmarkQuestionSchema)
                    .length(100)
                    .parse(
                        JSON.parse(
                            await readFile(
                                await cacheFile(cache, "heldout100-requests.json"),
                                "utf8"
                            )
                        )
                    );
                const sourceByCase = new Map(pool.map(row => [row.caseId, row]));
                const bySize = heldout.flatMap(group =>
                    group.topics.map(topic => group.topics.length + ":" + topic.caseId)
                );
                const exploratory = z.array(BenchmarkGroupSchema).length(50).parse(requests);
                if (
                    sourceByCase.size !== 100 ||
                    new Set(bySize).size !== bySize.length ||
                    new Set(heldout.map(row => row.groupId)).size !== heldout.length ||
                    heldout.filter(row => row.topics.length === 3).length !== 30 ||
                    exploratory.filter(row => row.topics.length === 3).length !== 30 ||
                    heldout.some(group =>
                        group.topics.some(topic => {
                            const source = sourceByCase.get(topic.caseId);
                            return (
                                source?.question !== topic.question ||
                                source?.enterprise !== group.enterprise ||
                                source?.workspaceId !== group.workspaceId
                            );
                        })
                    )
                )
                    throw new Error("benchmark_heldout_roster_invalid");
                console.log(
                    JSON.stringify({
                        heldoutGroupCount: heldout.length,
                        heldoutRequestsSha256: createHash("sha256")
                            .update(heldoutText, "utf8")
                            .digest("hex"),
                    })
                );
                return sweepSchedule(exploratory, heldout);
            })()
          : [];
    if (sweep && executeLive && !preflight) {
        const proofSteps = reliability
            ? reliabilitySweepSchedule(z.array(BenchmarkGroupSchema).length(50).parse(requests))
            : sweepSteps;
        const proof = z
            .array(
                z.object({
                    cohort: z.enum(["exploratory", "heldout"]),
                    caseId: z.string(),
                    arm: z.enum(sweepFreeArms),
                    retrievalLimits: z.object({ sharedEvidenceBytes: z.number() }),
                    accounting: z.object({ paidModelCalls: z.literal(0) }),
                })
            )
            .length(proofSteps.length * sweepFreeArms.length)
            .parse(
                JSON.parse(await readFile(await cacheFile(cache, values["free-proof"]!), "utf8"))
            );
        const observed = new Set(
            proof.map(row =>
                [row.cohort, row.caseId, row.retrievalLimits.sharedEvidenceBytes, row.arm].join(":")
            )
        );
        if (
            observed.size !== proof.length ||
            proofSteps.some(step =>
                sweepFreeArms.some(
                    arm =>
                        !observed.has(
                            [step.cohort, step.request.groupId, step.evidenceCapBytes, arm].join(
                                ":"
                            )
                        )
                )
            )
        )
            throw new Error("benchmark_sweep_free_coverage_required");
    }
    const allowed = new Map(manifest.enterprises.map(item => [item.enterprise, item.workspaceId]));
    if (
        allowed.size !== 5 ||
        new Set(allowed.values()).size !== 5 ||
        manifest.documents.some(
            document => ![...allowed.values()].includes(document.workspaceId)
        ) ||
        new Set(manifest.documents.map(document => document.versionId)).size !==
            manifest.documents.length ||
        [...requests, ...sweepSteps.map(step => step.request)].some(
            request => allowed.get(request.enterprise) !== request.workspaceId
        )
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
        captureDir && resumeLive && !sweep
            ? await loadLiveCheckpoint(cache, outputName, captureDir, requests)
            : undefined;
    const sweepCheckpoint =
        captureDir && resumeLive && sweep
            ? await loadSweepCheckpoint(cache, outputName, captureDir, sweepSteps)
            : undefined;
    if (live) {
        const inspection = postgres(manifest.databaseUrl, { max: 1 });
        try {
            await assertFixtureDatabase(inspection, selectedWorkspaceIds);
            const missing = await missingDigestDocuments(inspection, digestDocuments);
            if (sweep && missing.length)
                throw new Error("benchmark_resume_requires_intact_digest_cache");
            const sweepPrefix = sweepSteps.slice(0, sweepCheckpoint?.completed ?? 0);
            const forecast = sweep
                ? sweepForecast(
                      sweepSteps.slice(sweepPrefix.length),
                      sweepPrefix,
                      sweepCheckpoint?.priorLedger
                  )
                : projectAzureLive({
                      remainingCases: warmWorkspace
                          ? 0
                          : (grouped ? requests.length : 100) - (checkpoint?.prefix.length ?? 0),
                      ...(grouped
                          ? {
                                remainingTopics: topicCount(
                                    requests.slice(checkpoint?.prefix.length ?? 0)
                                ),
                            }
                          : {}),
                      missingDigestBytes: missing.map(document => document.bytes),
                      currentExposureUsd: checkpoint?.priorLedger.projectedTotalUsd ?? 0,
                  });
            console.log(
                JSON.stringify(
                    {
                        routes: live.routes,
                        rateSource: live.rateSource,
                        forecast,
                        approvedUsd: liveLimit,
                        concurrency,
                        ...(reliability
                            ? {
                                  newEightKb: sweepSteps.filter(step => !step.replacesWorkId)
                                      .length,
                                  transportReplacements: sweepSteps.filter(
                                      step => step.replacesWorkId
                                  ).length,
                              }
                            : {}),
                    },
                    null,
                    2
                )
            );
            if (forecast.projectedUsd > liveLimit)
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
                  limitUsd: liveLimit,
                  ...(!resumeLive ? { transportReliability: "scoped-retry-v1" as const } : {}),
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
                  ...(checkpoint || sweepCheckpoint
                      ? { priorLedger: checkpoint?.priorLedger ?? sweepCheckpoint?.priorLedger }
                      : {}),
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
    if (sweep && executeLive) {
        let queued: Promise<unknown> = Promise.resolve();
        const transaction = database.transaction.bind(database);
        database.transaction = work => {
            const next = queued.then(() => transaction(work));
            queued = next.catch(() => undefined);
            return next;
        };
    }
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
        if (sweepCheckpoint && captureDir) {
            const current = await loadSweepCheckpoint(cache, outputName, captureDir, sweepSteps);
            if (
                current.completed !== sweepCheckpoint.completed ||
                JSON.stringify(current.priorLedger) !== JSON.stringify(sweepCheckpoint.priorLedger)
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
        } else if (sweepCheckpoint && meter) {
            if ((await missingDigestDocuments(sql, digestDocuments)).length)
                throw new Error("benchmark_resume_requires_intact_digest_cache");
            await meter.clearSweepTransportHold(
                sweepSteps.slice(0, sweepCheckpoint.completed).map(step => step.workId)
            );
            console.log("Resuming after saved sweep job " + sweepCheckpoint.completed);
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
                            if (reliability)
                                throw new Error("benchmark_digest_missing_after_warm_up");
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
        const createOwner = async (workspaceId: string) => {
            const subject = randomUUID();
            const email = `benchmark-${subject}@example.test`;
            await sql.begin(async tx => {
                await tx`INSERT INTO pdr_ai_v2_auth_user(id,name,email,created_at,updated_at)
                    VALUES (${subject},'Benchmark owner',${email},now(),now())`;
                const [owner] =
                    await tx`INSERT INTO pdr_ai_v2_users(name,email,"userId",company_id,role,status)
                    VALUES ('Benchmark owner',${email},${subject},${workspaceId},'employer','active') RETURNING id`;
                if (!owner) throw new Error("benchmark_owner_insert_failed");
                await tx`INSERT INTO pdr_ai_v2_user_company_memberships(user_id,company_id,role,status)
                    VALUES (${owner.id},${workspaceId},'owner','active')`;
            });
            return subject;
        };
        if (sweep) {
            const runStep = async (
                step: (typeof sweepSteps)[number],
                currentArm: BenchmarkArm,
                subject: string
            ) =>
                runBenchmarkRetrieval({
                    database,
                    databaseUrl: manifest.databaseUrl,
                    loadActor: () => loadOwner(step.request.workspaceId, subject),
                    request: step.request,
                    arm: currentArm,
                    week: manifest.week,
                    asOf: manifest.asOf,
                    sweep: {
                        cohort: step.cohort,
                        evidenceCapBytes: step.evidenceCapBytes,
                        ...(reliability ? { protocol: "heldout-reliability" as const } : {}),
                    },
                    ...(providers ? { providers } : {}),
                });
            const results: object[] = [...(sweepCheckpoint?.rows ?? [])];
            if (!meter || !captureDir) {
                for (const step of sweepSteps) {
                    for (const arm of sweepFreeArms) {
                        results.push(
                            await runStep(step, arm, await createOwner(step.request.workspaceId))
                        );
                    }
                    if (results.length % 50 === 0) console.log("Free sweep rows " + results.length);
                }
                await writeFile(output, JSON.stringify(results) + "\n", { flag: "wx" });
                console.log("Captured " + results.length + " free sweep rows.");
                return;
            }
            const completed = sweepSteps.slice(0, sweepCheckpoint?.completed ?? 0);
            const localTimeouts = new Set<string>();
            let stopReason: string | null = null;
            for (let offset = completed.length; offset < sweepSteps.length; offset += concurrency) {
                const before = meter.snapshot();
                const projection = sweepForecast(sweepSteps.slice(offset), completed, before);
                if (projection.projectedUsd > liveLimit) {
                    stopReason = "projected_budget_exceeded";
                    console.log(JSON.stringify({ liveStop: stopReason, projection }));
                    break;
                }
                const wave = [];
                for (const step of sweepSteps.slice(offset, offset + concurrency)) {
                    wave.push({ step, subject: await createOwner(step.request.workspaceId) });
                }
                const settled = await Promise.allSettled(
                    wave.map(({ step, subject }) =>
                        meter.withWork(step.workId, () => runStep(step, "configured-live", subject))
                    )
                );
                await meter.drainPending();
                for (const [index, outcome] of settled.entries()) {
                    const job = wave[index]!;
                    if (outcome.status === "rejected") {
                        stopReason ??= "benchmark_sweep_execution_failed";
                        const failed = {
                            workId: job.step.workId,
                            groupId: job.step.request.groupId,
                            cohort: job.step.cohort,
                            evidenceCapBytes: job.step.evidenceCapBytes,
                            failure: benchmarkFailureCode(outcome.reason),
                        };
                        await replaceLocalJson(
                            resolve(captureDir, job.step.workId + "-failed.json"),
                            failed
                        );
                        console.log(JSON.stringify(failed));
                        continue;
                    }
                    const result = outcome.value;
                    const { pairedBackfill, ...primary } =
                        "pairedBackfill" in result
                            ? result
                            : { ...result, pairedBackfill: undefined };
                    const backfill = {
                        ...primary,
                        arm: "configured-live+backfill",
                        backfillOfRunId: primary.runId,
                        accounting: {
                            ...primary.accounting,
                            paidModelCalls: 0,
                            digestProviderCalls: 0,
                            explorationResponses: 0,
                        },
                        ...(primary.status === "ok" && pairedBackfill
                            ? pairedBackfill
                            : {
                                  status: "failed",
                                  failure: primary.failure ?? "benchmark_backfill_failed",
                                  selected: undefined,
                                  snapshot: undefined,
                                  frozenBytes: undefined,
                                  topicAttribution: undefined,
                              }),
                    };
                    if (primary.failure === caseDeadlineCode) localTimeouts.add(job.step.workId);
                    const [stored] = primary.runId
                        ? await sql`SELECT trace,digest_ids,snapshot_commitment
                            FROM pdr_ai_v2_vantage_weekly_review_run_manifests
                            WHERE run_id=${primary.runId}::uuid AND company_id=${job.step.request.workspaceId}::bigint
                              AND owner_id=${job.subject}`
                        : [];
                    const link = {
                        workId: job.step.workId,
                        ...(job.step.replacesWorkId
                            ? { replacesWorkId: job.step.replacesWorkId }
                            : {}),
                    };
                    const labelledPrimary = { ...primary, ...link };
                    const labelledBackfill = { ...backfill, ...link };
                    await replaceLocalJson(resolve(captureDir, job.step.workId + ".json"), {
                        workId: job.step.workId,
                        primary: labelledPrimary,
                        backfill: labelledBackfill,
                        trace: stored?.trace ?? null,
                        digestIds: stored?.digest_ids ?? [],
                        snapshotCommitment: stored?.snapshot_commitment ?? null,
                    });
                    completed.push(job.step);
                    results.push(labelledPrimary, labelledBackfill);
                }
                const state = meter.snapshot();
                const unresolved = state.records.filter(
                    row =>
                        row.status === "unknown" &&
                        !row.continuedAfterCaseDeadline &&
                        !row.continuedAfterTransportFailure
                );
                if (
                    state.hold === "usage_unresolved" &&
                    unresolved.length > 0 &&
                    unresolved.every(row => row.workId && localTimeouts.has(row.workId))
                ) {
                    await meter.clearCaseDeadlineHold({ terminalCode: caseDeadlineCode });
                } else if (
                    state.hold === "usage_unresolved" &&
                    unresolved.length > 0 &&
                    unresolved.every(
                        row =>
                            row.workId &&
                            row.httpStatus === undefined &&
                            completed.some(step => step.workId === row.workId)
                    )
                ) {
                    await meter.clearSweepTransportHold(completed.map(step => step.workId));
                } else if (state.hold) {
                    stopReason ??= state.hold;
                }
                if (reliability) await replaceLocalJson(output, results);
                console.log(
                    JSON.stringify({
                        sweepCompleted: completed.length,
                        sweepExpected: sweepSteps.length,
                        cohort: wave[0]?.step.cohort,
                        conservativeExposureUsd: state.projectedTotalUsd,
                        stopReason,
                    })
                );
                if (stopReason) break;
            }
            await replaceLocalJson(output, results);
            await replaceLocalJson(resolve(captureDir, "sweep-status.json"), {
                complete: completed.length === sweepSteps.length && !stopReason,
                completed: completed.length,
                expected: sweepSteps.length,
                concurrency,
                approvedUsd: liveLimit,
                stopReason,
                forecast: sweepForecast(
                    sweepSteps.filter(step => !completed.includes(step)),
                    completed,
                    meter.snapshot()
                ),
            });
            console.log("Captured " + results.length + " live and paired backfill sweep rows.");
            return;
        }
        const jobs: {
            index: number;
            request: BenchmarkRequest;
            arm: BenchmarkArm;
            subject: string;
        }[] = [];
        for (const [index, request] of requests.entries()) {
            if (index < (checkpoint?.prefix.length ?? 0)) continue;
            for (const currentArm of arms) {
                const subject = await createOwner(request.workspaceId);
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
                    ...(grouped
                        ? {
                              remainingTopics: topicCount(requests.slice(results.length)),
                              completedTopics: topicCount(requests.slice(0, results.length)),
                          }
                        : {}),
                    currentExposureUsd: exposure.projectedTotalUsd,
                    completedExplorationCases: results.length,
                    completedExplorationExposureUsd: Math.max(
                        0,
                        exposure.projectedTotalUsd - warmExposureUsd
                    ),
                });
                if (forecast.projectedUsd > liveLimit) {
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
