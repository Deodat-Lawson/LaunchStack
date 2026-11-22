/** Run retrieval from the verified public corpus. This entry point has no evaluator import. */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import postgres from "postgres";
import { sql as statement } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { configureSecretBox } from "@launchstack/store/crypto";
import { resolveChatModel } from "@launchstack/llm";
import { resolveDocumentDigestProvider } from "../src/server/vantage/document-digest-provider";
import { explorationDocumentHandle } from "../src/server/vantage/weekly-review-topic-exploration";
import type { TopicSelectionProviders } from "../src/server/vantage/weekly-review-topic-run";
import {
    WeeklyReviewConflict,
    type WeeklyReviewDatabase,
    type WeeklyReviewQuery,
} from "../src/server/vantage/weekly-review-types";
import {
    AZURE_LUNA_DEPLOYMENT,
    AZURE_LUNA_OUTPUT_LIMIT,
    AZURE_LUNA_RESERVATION_PER_MILLION,
    planAzureLive,
} from "./vantage-benchmark-azure-plan";
import { createAzureResponsesAgentPort } from "./vantage-benchmark-azure-port";
import { createBenchmarkMeter } from "./vantage-benchmark-meter";
import { runBenchmarkRetrieval } from "./vantage-benchmark-retrieval";
import {
    ingestLongDecisionsWorkspace,
    loadLongDecisionsWorkspace,
    LONG_DECISIONS_DATABASE,
} from "./vantage-long-decisions-ingest";

const CAP_BYTES = [16000, 32000, 80000] as const;
const LIMIT_USD = 5;
const FREE_ARMS = ["seeds-only", "seeds-windows"] as const;
const LIVE_ARMS = ["live", "live+backfill", "live-docs+windows"] as const;
const SPLITS = ["dev", "heldout"] as const;
type StableId = { documentId: string; versionId: string };
type ExploratoryAccess = StableId & { tool: "digest" | "read"; disclosed: boolean };

async function writeJson(path: string, value: unknown) {
    const temporary = path + "." + randomUUID() + ".tmp";
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx", flush: true });
    await rename(temporary, path);
}

function projectToolAccess(
    trace: unknown,
    byRef: Map<string, StableId>,
    byHandle: Map<string, StableId>
): ExploratoryAccess[] {
    if (!trace || typeof trace !== "object" || !("events" in trace) || !Array.isArray(trace.events))
        return [];
    return trace.events.flatMap(event => {
        if (event?.kind !== "tool") return [];
        const tool =
            event.name === "get_document_digest"
                ? "digest"
                : event.name === "read_document_excerpt"
                  ? "read"
                  : null;
        if (!tool) return [];
        const response = JSON.parse(event.content);
        const stable =
            byRef.get(response.ref) ??
            byHandle.get(response.handle) ??
            byRef.get(event.args?.ref) ??
            byHandle.get(event.args?.handle);
        if (!stable) {
            if (response.ref && !event.errorCode)
                throw new Error("long_decisions_unknown_result_source");
            return [];
        }
        const disclosed =
            !event.errorCode &&
            (tool === "digest"
                ? Boolean(response.ref ?? response.handle)
                : Boolean(response.ranges?.length));
        return [{ ...stable, tool, disclosed }];
    });
}

async function main() {
    const { values } = parseArgs({
        options: {
            cache: { type: "string" },
            "approve-live": { type: "boolean" },
            "preflight-live": { type: "boolean" },
            "ingest-only": { type: "boolean" },
            "local-fixture-lock": { type: "string" },
            "injected-smoke": { type: "boolean" },
        },
    });
    if (!values.cache) throw new Error("long_decisions_cache_required");
    const cache = resolve(values.cache);
    const lockPath = values["local-fixture-lock"];
    const smoke = values["injected-smoke"] === true;
    if (lockPath && (values["approve-live"] || values["preflight-live"]))
        throw new Error("long_decisions_live_requires_committed_lock");
    if (smoke && !lockPath) throw new Error("long_decisions_smoke_requires_local_fixture");
    const fixture = { cache, ...(lockPath ? { lockPath } : {}) };
    const { publicManifest: manifest } = await loadLongDecisionsWorkspace(fixture);
    const schedule = SPLITS.flatMap(split =>
        manifest.groups
            .filter(group => group.split === split)
            .flatMap(group => CAP_BYTES.map(capBytes => ({ split, group, capBytes })))
    );
    const mayCallLive = values["approve-live"] === true;
    const azure = mayCallLive || values["preflight-live"] ? planAzureLive() : undefined;
    const rate = AZURE_LUNA_RESERVATION_PER_MILLION;
    // Cold digests reserve at least one input token per byte plus framing and full output.
    // Exploration starts at 1.5 times the p90 exposure of the earlier pilot.
    const coldDigestExposure = manifest.documents
        .filter(
            document =>
                document.visibility === "actor_readable" &&
                !manifest.fixedSources.some(fixed => fixed.documentId === document.id)
        )
        .flatMap(document => document.versions)
        .reduce(
            (sum, version) =>
                sum +
                ((version.bytes + 4096) * rate.input + AZURE_LUNA_OUTPUT_LIMIT * rate.output) / 1e6,
            0
        );
    const explorationUnitUsd = 0.0521793 * 1.5;
    const projectedUsd = coldDigestExposure + schedule.length * explorationUnitUsd;
    if (azure) {
        console.log(
            JSON.stringify({
                routes: azure.routes,
                coldDigestExposure,
                paidExplorations: schedule.length,
                projectedUsd,
                limitUsd: LIMIT_USD,
            })
        );
        if (projectedUsd > LIMIT_USD) throw new Error("long_decisions_projected_budget_exceeded");
    }
    if (values["preflight-live"]) return;
    const workspace = await ingestLongDecisionsWorkspace(fixture);
    if (values["ingest-only"]) {
        console.log(
            JSON.stringify({
                workspaceId: workspace.workspaceId,
                documents: workspace.documents.length,
            })
        );
        return;
    }
    const capture = resolve(
        cache,
        mayCallLive ? "comparison" : smoke ? "injected-smoke" : "free-check"
    );
    await mkdir(capture);
    const byRef = new Map<string, StableId>();
    const byHandle = new Map<string, StableId>();
    const byVersion = new Map<string, StableId>();
    for (const document of workspace.documents)
        for (const version of document.versions) {
            const ref = "doc:" + document.documentId + "@" + version.versionId;
            const stable = { documentId: document.stableId, versionId: version.stableId };
            byRef.set(ref, stable);
            byHandle.set(explorationDocumentHandle({ ref }), stable);
            byVersion.set(version.versionId, stable);
        }
    const denied = new Set(manifest.actors[0]!.deniedDocumentIds);
    const allowed = ({ documentId }: StableId) => !denied.has(documentId);
    const stableVersion = (versionId: string) => {
        const stable = byVersion.get(versionId);
        if (!stable) throw new Error("long_decisions_unknown_result_source");
        return stable;
    };
    const originalFetch = globalThis.fetch;
    const meter =
        mayCallLive && azure
            ? createBenchmarkMeter({
                  contextTokens: 1_000_000,
                  limitUsd: LIMIT_USD,
                  modelId: AZURE_LUNA_DEPLOYMENT,
                  endpointUrl: azure.endpoint.replace(/\/$/, "") + "/chat/completions",
                  pricingSource: azure.rateSource,
                  pricingScope: "Upper Azure Standard list rates, no cache discount",
                  promptUsdPerToken: rate.input / 1e6,
                  cachedPromptUsdPerToken: rate.input / 1e6,
                  cacheWriteUsdPerToken: rate.input / 1e6,
                  completionUsdPerToken: rate.output / 1e6,
                  maxOutputTokens: AZURE_LUNA_OUTPUT_LIMIT,
                  timeoutMs: 150_000,
                  transportReliability: "scoped-retry-v1",
                  persist: snapshot => writeJson(resolve(capture, "usage-ledger.json"), snapshot),
              })
            : undefined;
    const meteredFetch = meter?.wrapFetch(originalFetch);
    const providers: TopicSelectionProviders | undefined =
        azure && meteredFetch
            ? {
                  digest: resolveDocumentDigestProvider(options =>
                      resolveChatModel({ ...options, config: azure.config, streaming: false })
                  ),
                  exploration(documents) {
                      if (
                          documents.some(doc => {
                              const stable = byRef.get(doc.ref);
                              return !stable || !allowed(stable);
                          })
                      )
                          throw new WeeklyReviewConflict("long_decisions_restricted_catalogue");
                      return createAzureResponsesAgentPort({
                          endpoint: azure.endpoint,
                          apiKey: azure.apiKey,
                          deployment: AZURE_LUNA_DEPLOYMENT,
                          reasoningEffort: "high",
                          operatorInstructions: azure.config.endpoint.systemInstructions,
                          fetch: meteredFetch,
                      });
                  },
              }
            : undefined;
    configureSecretBox({ key: randomBytes(32).toString("base64") });
    const sql = postgres(LONG_DECISIONS_DATABASE, { max: 8 });
    const db = drizzle(sql);
    const database: WeeklyReviewDatabase = {
        transaction(work) {
            return db.transaction(tx => {
                const query: WeeklyReviewQuery = async (queryText, args = []) => {
                    const parts = queryText
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
    const createActor = async () => {
        const userId = randomUUID();
        const email = "long-decisions-" + userId + "@example.test";
        await sql.begin(async tx => {
            await tx`INSERT INTO pdr_ai_v2_auth_user(id,name,email,created_at,updated_at)
                VALUES (${userId},'Northstar reviewer',${email},now(),now())`;
            const [actor] =
                await tx`INSERT INTO pdr_ai_v2_users(name,email,"userId",company_id,role,status)
                VALUES ('Northstar reviewer',${email},${userId},${workspace.workspaceId},'employer','active') RETURNING id`;
            if (!actor) throw new Error("long_decisions_actor_insert_failed");
            await tx`INSERT INTO pdr_ai_v2_user_company_memberships(user_id,company_id,role,status)
                VALUES (${actor.id},${workspace.workspaceId},'owner','active')`;
        });
        return async () => {
            const [membership] = await sql`SELECT m.role FROM pdr_ai_v2_users u
                JOIN pdr_ai_v2_user_company_memberships m ON m.user_id=u.id
                WHERE u."userId"=${userId} AND m.company_id=${workspace.workspaceId}
                  AND m.status='active' AND u.status='active'`;
            if (membership?.role !== "owner") throw new Error("long_decisions_actor_revoked");
            return {
                companyId: workspace.workspaceId,
                userId,
                role: "owner" as const,
                canRead: true,
                canMutate: true,
                documentScope: workspace.documentScope,
            };
        };
    };
    await writeJson(resolve(capture, "method.json"), {
        specSha256: manifest.specSha256,
        caps: CAP_BYTES,
        arms: [...FREE_ARMS, ...LIVE_ARMS],
        schedule: schedule.map(({ split, group, capBytes }) => ({
            split,
            groupId: group.id,
            capBytes,
        })),
        projection: azure ? { projectedUsd, limitUsd: LIMIT_USD, routes: azure.routes } : null,
    });
    if (meter && meteredFetch) {
        await writeJson(resolve(capture, "usage-ledger.json"), meter.snapshot());
        globalThis.fetch = meteredFetch;
    }
    let completed = 0;
    let liveCases = 0;
    let exposureAfterWarmup = 0;
    const runJob = async (
        job: (typeof schedule)[number],
        arm: (typeof FREE_ARMS)[number] | "live"
    ) => {
        const { split, group, capBytes } = job;
        const week = manifest.weeks.find(week => week.id === group.weekId);
        if (!week) throw new Error("long_decisions_unknown_reporting_week");
        const loadActor = await createActor();
        const execute = () =>
            runBenchmarkRetrieval({
                arm:
                    arm === "live"
                        ? smoke
                            ? "configured-live-dry-run"
                            : "configured-live"
                        : arm === "seeds-only"
                          ? "seeds"
                          : arm,
                request: {
                    groupId: group.id,
                    enterprise: manifest.company.name,
                    workspaceId: workspace.workspaceId,
                    topics: group.topics,
                },
                asOf: week.cutoff,
                week: week.weekStart,
                loadActor,
                database,
                databaseUrl: LONG_DECISIONS_DATABASE,
                sweep: {
                    cohort: split === "heldout" ? "heldout" : "exploratory",
                    evidenceCapBytes: capBytes,
                    protocol: "long-decisions",
                },
                ...(arm === "live" && providers ? { providers } : {}),
            });
        const result =
            arm === "live" && meter
                ? await meter.withWork("sweep-" + String(liveCases + 1).padStart(3, "0"), execute)
                : await execute();
        const [record] = result.runId
            ? await sql`SELECT trace,digest_ids FROM pdr_ai_v2_vantage_weekly_review_run_manifests
                WHERE run_id=${result.runId}::uuid`
            : [];
        const explored = projectToolAccess(record?.trace, byRef, byHandle);
        const offered = (result.offered ?? []).map(item => stableVersion(item.versionId));
        const digestIds: string[] = record?.digest_ids ?? [];
        const storedDigestIds = digestIds.filter(id => /^\d+$/.test(id));
        const digests = storedDigestIds.length
            ? await sql`SELECT version_id::text FROM pdr_ai_v2_document_version_digests
                WHERE company_id=${workspace.workspaceId} AND id=ANY(${storedDigestIds}::bigint[])`
            : [];
        const ephemeralVersions = digestIds.flatMap(id => {
            const match = smoke ? /^ephemeral:(\d+):[a-f0-9]{64}$/.exec(id) : null;
            return match?.[1] ? [match[1]] : [];
        });
        if (digests.length + ephemeralVersions.length !== new Set(digestIds).size)
            throw new Error("long_decisions_unknown_digest_source");
        const digestAccess = [...digests.map(row => row.version_id), ...ephemeralVersions].map(
            versionId => ({
                ...stableVersion(versionId),
                tool: "digest" as const,
                disclosed: true,
            })
        );
        const captureBase = {
            groupId: group.id,
            split,
            weekId: group.weekId,
            capBytes,
            offered,
            explored: [...digestAccess, ...explored],
            provenance:
                arm === "live"
                    ? {
                          kind: smoke ? "injected" : "live",
                          executionId: result.runId ?? randomUUID(),
                      }
                    : { kind: "deterministic" },
        };
        const rows = !("selected" in result)
            ? (arm === "live" ? LIVE_ARMS : [arm]).map(variant => ({
                  ...captureBase,
                  arm: variant,
                  status: "failed",
                  failure: result.failure,
                  selected: [],
              }))
            : (arm === "live"
                  ? [
                        {
                            arm: "live",
                            data: "pairedLive" in result ? result.pairedLive : undefined,
                        },
                        {
                            arm: "live+backfill",
                            data: "pairedBackfill" in result ? result.pairedBackfill : undefined,
                        },
                        { arm: "live-docs+windows", data: result },
                    ]
                  : [{ arm, data: result }]
              ).map(variant => {
                  if (!variant.data?.selected)
                      throw new Error("long_decisions_comparison_snapshot_missing");
                  return {
                      ...captureBase,
                      arm: variant.arm,
                      status: "degradation" in result ? "degraded" : "completed",
                      selected: variant.data.selected.map(source => ({
                          ...stableVersion(source.versionId),
                          text: source.text,
                      })),
                  };
              });
        await writeJson(resolve(capture, [group.id, capBytes, arm].join("-") + ".json"), {
            rows,
            result,
            trace: record?.trace ?? null,
        });
        if (
            rows.some(row =>
                [
                    ...row.offered,
                    ...row.selected,
                    ...row.explored.filter(access => access.disclosed),
                ].some(id => !allowed(id))
            )
        )
            throw new Error("long_decisions_restricted_source_disclosed");
        completed++;
        console.log(
            JSON.stringify({
                completed,
                split,
                group: group.id,
                capBytes,
                arm,
                status: rows[0]?.status,
                failure: result.failure,
                exposureUsd: meter?.snapshot().projectedTotalUsd,
            })
        );
        return rows;
    };
    try {
        if (smoke) {
            const job = schedule.find(job => job.split === "dev" && job.capBytes === 80000);
            if (!job) throw new Error("long_decisions_smoke_job_missing");
            if ((await runJob(job, "live")).some(row => row.status === "failed"))
                throw new Error("long_decisions_smoke_freeze_failed");
            return;
        }
        for (const split of SPLITS) {
            const jobs = schedule.filter(job => job.split === split);
            const rows: unknown[] = [];
            for (const job of jobs)
                for (const arm of FREE_ARMS) rows.push(...(await runJob(job, arm)));
            await writeJson(resolve(capture, split + "-rows.json"), rows);
            if (!meter) continue;
            for (const job of jobs) {
                meter.assertCanDispatch();
                const exposure = meter.snapshot().projectedTotalUsd;
                const observedUsd =
                    liveCases > 3 ? ((exposure - exposureAfterWarmup) / (liveCases - 1)) * 1.5 : 0;
                const predicted =
                    exposure +
                    (liveCases === 0 ? coldDigestExposure : 0) +
                    (schedule.length - liveCases) * Math.max(explorationUnitUsd, observedUsd);
                if (predicted > LIMIT_USD)
                    throw new Error("long_decisions_projected_budget_exceeded");
                rows.push(...(await runJob(job, "live")));
                await meter.drainPending();
                if (liveCases === 0) exposureAfterWarmup = meter.snapshot().projectedTotalUsd;
                liveCases++;
                await writeJson(resolve(capture, split + "-rows.json"), rows);
            }
        }
    } finally {
        globalThis.fetch = originalFetch;
        await meter?.drainPending();
        await sql.end();
    }
}

main().catch(error => {
    const safe =
        error instanceof Error && /^(long_decisions|benchmark)_[a-z_]+$/.test(error.message);
    console.error(safe ? error.message : "long_decisions_run_failed");
    process.exitCode = 1;
});
