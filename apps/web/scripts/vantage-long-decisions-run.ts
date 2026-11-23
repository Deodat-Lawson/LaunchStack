/** Run retrieval from the verified public corpus. This entry point has no evaluator import. */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile, readFile, readdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import postgres from "postgres";
import { sql as statement } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { configureSecretBox } from "@launchstack/store/crypto";
import { resolveChatModel } from "@launchstack/llm";
import { resolveDocumentDigestProvider } from "../src/server/vantage/document-digest-provider";
import { explorationDocumentHandle } from "../src/server/vantage/weekly-review-topic-exploration";
import {
    prewarmTopicDigests,
    type TopicSelectionProviders,
} from "../src/server/vantage/weekly-review-topic-run";
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
import { createBenchmarkMeter, type BenchmarkMeterSnapshot } from "./vantage-benchmark-meter";
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
    // Windows readers can briefly hold the destination open. Retry the atomic
    // replace before the meter can dispatch against a new reservation.
    for (let attempt = 0; ; attempt++) {
        try {
            await rename(temporary, path);
            return;
        } catch (error) {
            if (
                attempt === 5 ||
                !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")
            )
                throw error;
            await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 100));
        }
    }
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
            "spec-version": { type: "string", default: "v1" },
            resume: { type: "boolean" },
            "resume-warmup": { type: "boolean" },
            "preflight-live": { type: "boolean" },
            "ingest-only": { type: "boolean" },
            "local-fixture-lock": { type: "string" },
            "injected-smoke": { type: "boolean" },
        },
    });
    if (!values.cache) throw new Error("long_decisions_cache_required");
    const cache = resolve(values.cache);
    const revision = values["spec-version"];
    if (revision !== "v1" && revision !== "v2") throw new Error("long_decisions_revision_invalid");
    const resumeRun = values.resume === true;
    if (
        resumeRun &&
        (revision !== "v2" ||
            !values["approve-live"] ||
            values["resume-warmup"] ||
            values["preflight-live"] ||
            values["ingest-only"] ||
            values["injected-smoke"] ||
            values["local-fixture-lock"])
    )
        throw new Error("long_decisions_resume_denied");
    const lockPath = values["local-fixture-lock"];
    const smoke = values["injected-smoke"] === true;
    const resumeWarmup = values["resume-warmup"] === true;
    if (
        resumeWarmup &&
        (!values["approve-live"] ||
            values["preflight-live"] ||
            values["ingest-only"] ||
            smoke ||
            lockPath)
    )
        throw new Error("long_decisions_warmup_resume_denied");
    if (lockPath && (values["approve-live"] || values["preflight-live"]))
        throw new Error("long_decisions_live_requires_committed_lock");
    if (smoke && !lockPath) throw new Error("long_decisions_smoke_requires_local_fixture");
    const fixture: Parameters<typeof loadLongDecisionsWorkspace>[0] = {
        cache,
        revision,
        ...(lockPath ? { lockPath } : {}),
    };
    const { publicManifest: manifest } = await loadLongDecisionsWorkspace(fixture);
    const schedule = SPLITS.flatMap(split =>
        manifest.groups
            .filter(group => group.split === split)
            .flatMap(group => CAP_BYTES.map(capBytes => ({ split, group, capBytes })))
    );
    if (
        revision === "v2" &&
        (schedule.length !== 54 ||
            manifest.groups.length !== 18 ||
            [...manifest.weeks.map(week => Date.parse(week.cutoff))]
                .sort((a, b) => a - b)
                .join(",") !==
                ["2026-10-12T00:00:00Z", "2026-10-19T00:00:00Z", "2026-10-26T00:00:00Z"]
                    .map(Date.parse)
                    .join(","))
    )
        throw new Error("long_decisions_revision_schedule_invalid");
    const mayCallLive = values["approve-live"] === true;
    const azure = mayCallLive || values["preflight-live"] ? planAzureLive() : undefined;
    const rate = AZURE_LUNA_RESERVATION_PER_MILLION;
    // v1 preserves its original full-reserve forecast; v2 uses the completed v1
    // native-usage ledger's nearest-rank p90 across24 explorers/44 long digests.
    // Forecasts use observed list-rate expense; dispatch still reserves full byte ceilings.
    const reference = {
        explorationP90Usd: 0.0262098,
        explorationSamples: 24,
        digestP90Usd: 0.0029991,
        digestSamples: 44,
        padding: 1.5,
        catalogueScale: 50 / 44,
        maxBodyBytes: 30700,
    };
    const bodyScale = Math.max(
        1,
        ...manifest.documents.flatMap(document =>
            document.versions.map(version => version.bytes / reference.maxBodyBytes)
        )
    );
    const digestForecast = (bytes: number) =>
        reference.digestP90Usd * reference.padding * Math.max(1, bytes / reference.maxBodyBytes);
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
                (revision === "v2"
                    ? digestForecast(version.bytes)
                    : ((version.bytes + 4096) * rate.input +
                          AZURE_LUNA_OUTPUT_LIMIT * rate.output) /
                      1e6),
            0
        );
    const explorationUnitUsd =
        revision === "v2"
            ? reference.explorationP90Usd * reference.padding * reference.catalogueScale * bodyScale
            : 0.0521793 * 1.5;
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
        (mayCallLive ? "comparison" : smoke ? "injected-smoke" : "free-check") +
            (revision === "v2" ? "-v2" : "")
    );
    if (!resumeWarmup && !resumeRun) await mkdir(capture);
    const method = {
        ...(revision === "v2"
            ? {
                  revision,
                  liveConcurrency: 1,
                  warmup: "actual_free_catalogue_union_per_split",
                  cutoffs: manifest.weeks.map(week => ({ id: week.id, asOf: week.cutoff })),
                  forecastReference: {
                      ...reference,
                      bodyScale,
                      explorationUnitUsd,
                      coldDigestExposure,
                  },
              }
            : {}),
        specSha256: manifest.specSha256,
        caps: CAP_BYTES,
        arms: [...FREE_ARMS, ...LIVE_ARMS],
        schedule: schedule.map(({ split, group, capBytes }) => ({
            split,
            groupId: group.id,
            capBytes,
        })),
        projection: azure ? { projectedUsd, limitUsd: LIMIT_USD, routes: azure.routes } : null,
    };
    let priorLedger: BenchmarkMeterSnapshot | undefined;
    let priorDevRows: unknown[] = [];
    const resumedCaptures = new Map<
        string,
        { rows: { status: string }[]; result: { offered?: { versionId: string }[] } }
    >();
    const jobFile = (job: (typeof schedule)[number], arm: string) =>
        [job.group.id, job.capBytes, arm].join("-") + ".json";
    if (resumeRun) {
        const savedMethod = JSON.parse(await readFile(resolve(capture, "method.json"), "utf8"));
        if (JSON.stringify(savedMethod) !== JSON.stringify(method))
            throw new Error("long_decisions_warmup_method_mismatch");
        const names = new Set(await readdir(capture));
        const allowed = new Set([
            "method.json",
            "usage-ledger.json",
            "dev-rows.json",
            "heldout-rows.json",
            "warmup-diagnostics.json",
            "digest-warmup-dev.json",
            "digest-warmup-heldout.json",
            "progress.json",
        ]);
        const completedWork = new Set<string>();
        let missing = false;
        for (const split of SPLITS) {
            const jobs = schedule.filter(job => job.split === split);
            const expected: {
                job: (typeof jobs)[number];
                arm: (typeof FREE_ARMS)[number] | "live";
            }[] = [
                ...jobs.flatMap(job => FREE_ARMS.map(arm => ({ job, arm }))),
                ...jobs.map(job => ({ job, arm: "live" as const })),
            ];
            for (const { job, arm } of expected) {
                const name = jobFile(job, arm);
                allowed.add(name);
                if (!names.has(name)) {
                    missing = true;
                    continue;
                }
                if (missing) throw new Error("long_decisions_resume_prefix_invalid");
                const saved = JSON.parse(await readFile(resolve(capture, name), "utf8"));
                const week = manifest.weeks.find(week => week.id === job.group.weekId)!;
                const arms = arm === "live" ? LIVE_ARMS : [arm];
                if (
                    !Array.isArray(saved.rows) ||
                    saved.rows.length !== arms.length ||
                    saved.rows.some(
                        (row: Record<string, unknown>, i: number) =>
                            row.groupId !== job.group.id ||
                            row.split !== split ||
                            row.weekId !== job.group.weekId ||
                            row.asOf !== week.cutoff ||
                            row.capBytes !== job.capBytes ||
                            row.arm !== arms[i] ||
                            !["completed", "degraded", "failed"].includes(String(row.status)) ||
                            !Array.isArray(row.selected)
                    ) ||
                    !saved.result
                )
                    throw new Error("long_decisions_resume_capture_invalid");
                resumedCaptures.set(name, saved);
                if (arm === "live")
                    completedWork.add(
                        "sweep-" + String(schedule.indexOf(job) + 1).padStart(3, "0")
                    );
            }
        }
        if ([...names].some(name => !allowed.has(name)))
            throw new Error("long_decisions_resume_capture_invalid");
        priorLedger = JSON.parse(await readFile(resolve(capture, "usage-ledger.json"), "utf8"));
        if (
            !priorLedger ||
            !Array.isArray(priorLedger.records) ||
            priorLedger.records.some(
                row =>
                    ["sent", "reserved"].includes(row.status) ||
                    (row.workId !== undefined && !completedWork.has(row.workId)) ||
                    (row.route === "exploration" && row.workId === undefined)
            ) ||
            !([null, "usage_unresolved"] as unknown[]).includes(priorLedger.hold)
        )
            throw new Error("long_decisions_resume_uncaptured_dispatch");
        if (
            coldDigestExposure +
                (schedule.length - completedWork.size) * explorationUnitUsd +
                priorLedger.projectedTotalUsd >
            LIMIT_USD
        )
            throw new Error("long_decisions_projected_budget_exceeded");
    }
    if (resumeWarmup) {
        const savedMethod = JSON.parse(await readFile(resolve(capture, "method.json"), "utf8"));
        if (JSON.stringify(savedMethod) !== JSON.stringify(method))
            throw new Error("long_decisions_warmup_method_mismatch");
        const rows: unknown = JSON.parse(await readFile(resolve(capture, "dev-rows.json"), "utf8"));
        const jobs = schedule.filter(job => job.split === "dev");
        const allowedFiles = new Set([
            "method.json",
            "usage-ledger.json",
            "dev-rows.json",
            "warmup-diagnostics.json",
        ]);
        const expectedRows: unknown[] = [];
        for (const job of jobs)
            for (const arm of FREE_ARMS) {
                const file = [job.group.id, job.capBytes, arm].join("-") + ".json";
                allowedFiles.add(file);
                const saved = JSON.parse(await readFile(resolve(capture, file), "utf8"));
                if (!Array.isArray(saved.rows) || saved.rows.length !== 1)
                    throw new Error("long_decisions_warmup_dev_capture_invalid");
                const row = saved.rows[0];
                if (
                    row.groupId !== job.group.id ||
                    row.split !== "dev" ||
                    row.weekId !== job.group.weekId ||
                    row.capBytes !== job.capBytes ||
                    row.arm !== arm ||
                    row.status !== "completed" ||
                    row.provenance?.kind !== "deterministic" ||
                    !Array.isArray(row.selected) ||
                    saved.result?.status !== "ok"
                )
                    throw new Error("long_decisions_warmup_dev_capture_invalid");
                expectedRows.push(row);
            }
        if (
            expectedRows.length !== (revision === "v2" ? jobs.length * FREE_ARMS.length : 24) ||
            !Array.isArray(rows) ||
            JSON.stringify(rows) !== JSON.stringify(expectedRows) ||
            (await readdir(capture)).some(name => !allowedFiles.has(name))
        )
            throw new Error("long_decisions_warmup_resume_denied");
        priorDevRows = rows;
        priorLedger = JSON.parse(
            await readFile(resolve(capture, "usage-ledger.json"), "utf8")
        ) as BenchmarkMeterSnapshot;
        if (
            !Array.isArray(priorLedger.records) ||
            priorLedger.records.length === 0 ||
            priorLedger.records.some(
                row =>
                    row.route !== "digest" ||
                    row.workId !== undefined ||
                    !["settled", "unknown"].includes(row.status)
            ) ||
            (priorLedger.hold !== null && priorLedger.hold !== "usage_unresolved") ||
            (priorLedger.hold === null &&
                priorLedger.records.some(
                    row =>
                        row.status === "unknown" &&
                        !row.continuedAfterGenerationNoHttp &&
                        !row.continuedAfterCaseDeadline &&
                        !row.continuedAfterTransportFailure &&
                        !row.scopedTransportFailure
                ))
        )
            throw new Error("long_decisions_warmup_ledger_invalid");
        if (projectedUsd + priorLedger.projectedTotalUsd > LIMIT_USD)
            throw new Error("long_decisions_projected_budget_exceeded");
    }
    const completedLiveKeys = new Set(
        schedule
            .filter(job => resumedCaptures.has(jobFile(job, "live")))
            .map(job => jobFile(job, "live"))
    );
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
    const numericVersionByStable = new Map(
        [...byVersion].map(([id, stable]) => [stable.versionId, id])
    );
    const cacheCoveredVersions = new Set<string>();
    const observedSplitCatalogues = new Set<string>();
    const futureInventory = new Map<string, Set<string>>();
    for (const split of SPLITS) {
        const needed = new Set<string>();
        for (const job of schedule.filter(job => job.split === split)) {
            const cutoff = manifest.weeks.find(week => week.id === job.group.weekId)!.cutoff;
            for (const document of manifest.documents) {
                if (
                    document.visibility !== "actor_readable" ||
                    manifest.fixedSources.some(fixed => fixed.documentId === document.id)
                )
                    continue;
                const latest = document.versions
                    .filter(version => Date.parse(version.publishedAt) <= Date.parse(cutoff))
                    .at(-1);
                if (latest) {
                    const numeric = numericVersionByStable.get(latest.id);
                    if (!numeric) throw new Error("long_decisions_digest_inventory_invalid");
                    needed.add(numeric);
                }
            }
        }
        futureInventory.set(split, needed);
    }
    if (revision === "v2" && resumeRun)
        for (const split of SPLITS) {
            try {
                const audit = JSON.parse(
                    await readFile(resolve(capture, `digest-warmup-${split}.json`), "utf8")
                );
                if (
                    audit.schemaVersion !== "long-decisions-warmup/2" ||
                    audit.specSha256 !== manifest.specSha256 ||
                    audit.split !== split ||
                    !Array.isArray(audit.versions) ||
                    !Array.isArray(audit.digestIds) ||
                    audit.digestIds.length !== audit.versions.length
                )
                    throw new Error("long_decisions_warmup_binding_invalid");
                for (const version of audit.versions) {
                    const numeric = numericVersionByStable.get(version.versionId);
                    if (
                        !numeric ||
                        byVersion.get(numeric)!.documentId !== version.documentId ||
                        !allowed(version)
                    )
                        throw new Error("long_decisions_warmup_binding_invalid");
                    cacheCoveredVersions.add(numeric);
                }
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
        }
    const originalFetch = globalThis.fetch;
    const causeCode = (error: unknown): string => {
        const candidate = error as {
            name?: string;
            code?: unknown;
            cause?: { code?: unknown; name?: string };
        };
        const code = candidate?.cause?.code ?? candidate?.code ?? candidate?.name;
        return typeof code === "string" &&
            [
                "ECONNRESET",
                "ECONNREFUSED",
                "ETIMEDOUT",
                "ENOTFOUND",
                "EAI_AGAIN",
                "UND_ERR_SOCKET",
                "UND_ERR_CONNECT_TIMEOUT",
                "UND_ERR_HEADERS_TIMEOUT",
                "UND_ERR_BODY_TIMEOUT",
                "AbortError",
                "TimeoutError",
            ].includes(code)
            ? code
            : "transport_failure";
    };
    const diagnostics: unknown[] = [];
    if (resumeWarmup || resumeRun) {
        try {
            const saved = JSON.parse(
                await readFile(resolve(capture, "warmup-diagnostics.json"), "utf8")
            );
            if (!Array.isArray(saved)) throw new Error("long_decisions_warmup_diagnostics_invalid");
            diagnostics.push(...saved);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
    }
    const saveDiagnostic = async (value: unknown) => {
        diagnostics.push(value);
        console.log(JSON.stringify(value));
        await writeJson(resolve(capture, "warmup-diagnostics.json"), diagnostics);
    };
    const diagnosedFetch: typeof fetch = async (input, init) => {
        try {
            return await originalFetch(input, init);
        } catch (error) {
            const url = new URL(
                typeof input === "string" ? input : input instanceof URL ? input.href : input.url
            );
            await saveDiagnostic({
                kind: "fetch_transport_failure",
                route: url.pathname.endsWith("/responses") ? "exploration" : "digest",
                causeCode: causeCode(error),
            });
            throw error;
        }
    };
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
                  allowGenerationTransportRecovery: true,
                  ...(priorLedger ? { priorLedger } : {}),
                  persist: snapshot => writeJson(resolve(capture, "usage-ledger.json"), snapshot),
              })
            : undefined;
    const meteredFetch = meter?.wrapFetch(diagnosedFetch);
    const digestProvider = azure
        ? resolveDocumentDigestProvider(options =>
              resolveChatModel({ ...options, config: azure.config, streaming: false })
          )
        : undefined;
    const providers: TopicSelectionProviders | undefined =
        azure && meteredFetch
            ? {
                  digest: async () => {
                      throw new Error("benchmark_digest_missing_after_warm_up");
                  },
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
    const freeCatalogueVersions = new Map<string, Set<string>>(
        SPLITS.map(split => [split, new Set<string>()])
    );
    const recordFreeCatalogue = (split: string, result: { offered?: { versionId: string }[] }) => {
        for (const offered of result.offered ?? []) {
            if (!byVersion.has(offered.versionId))
                throw new Error("long_decisions_unknown_result_source");
            freeCatalogueVersions.get(split)!.add(offered.versionId);
        }
    };
    const remainingProjection = (additionalColdUsd = 0) => {
        const state = meter?.snapshot();
        const byWork = new Map<string, number>();
        for (const row of state?.records ?? [])
            if (row.workId && row.status !== "released")
                byWork.set(
                    row.workId,
                    (byWork.get(row.workId) ?? 0) + (row.settledListRateUsd ?? row.projectedUsd)
                );
        const observed = schedule
            .flatMap((job, index) =>
                completedLiveKeys.has(jobFile(job, "live"))
                    ? [byWork.get("sweep-" + String(index + 1).padStart(3, "0")) ?? 0]
                    : []
            )
            .sort((a, b) => a - b);
        const observedUnit =
            observed.length >= 3
                ? observed[Math.ceil(observed.length * 0.9) - 1]! * reference.padding
                : 0;
        const coldVersions = new Set<string>();
        for (const split of SPLITS) {
            if (
                schedule
                    .filter(job => job.split === split)
                    .every(job => completedLiveKeys.has(jobFile(job, "live")))
            )
                continue;
            const inventory = observedSplitCatalogues.has(split)
                ? freeCatalogueVersions.get(split)!
                : futureInventory.get(split)!;
            for (const version of inventory)
                if (!cacheCoveredVersions.has(version)) coldVersions.add(version);
        }
        const inventoryColdUsd = [...coldVersions].reduce((sum, id) => {
            const stable = stableVersion(id);
            const version = manifest.documents
                .flatMap(document => document.versions)
                .find(version => version.id === stable.versionId)!;
            return sum + digestForecast(version.bytes);
        }, 0);
        return (
            (state?.projectedTotalUsd ?? 0) +
            Math.max(inventoryColdUsd, additionalColdUsd) +
            (schedule.length - completedLiveKeys.size) * Math.max(explorationUnitUsd, observedUnit)
        );
    };
    const warmOfferedDigests = async (split: (typeof SPLITS)[number]) => {
        if (!digestProvider || !meter) throw new Error("long_decisions_live_provider_missing");
        // This unauthenticated HEAD warms the same process's connection path; never a model call.
        let connected = false;
        for (let attempt = 1; attempt <= 4; attempt++) {
            const started = performance.now();
            try {
                const response = await originalFetch(
                    azure!.endpoint.replace(/\/$/, "") + "/models",
                    {
                        method: "HEAD",
                        headers: {},
                        credentials: "omit",
                        redirect: "error",
                        signal: AbortSignal.timeout(4000),
                    }
                );
                await saveDiagnostic({
                    kind: "connectivity",
                    attempt,
                    httpStatus: response.status,
                    durationMs: performance.now() - started,
                });
                await response.body?.cancel();
                connected = true;
                break;
            } catch (error) {
                await saveDiagnostic({
                    kind: "connectivity",
                    attempt,
                    causeCode: causeCode(error),
                    durationMs: performance.now() - started,
                });
            }
        }
        if (!connected) throw new Error("long_decisions_connectivity_failed");
        const recoverNoHttp = async (expectedNewIds?: Set<string>) => {
            await meter.drainPending();
            const state = meter.snapshot();
            const unknown = state.records.filter(
                row =>
                    row.status === "unknown" &&
                    !row.continuedAfterGenerationNoHttp &&
                    !row.continuedAfterCaseDeadline &&
                    !row.continuedAfterTransportFailure &&
                    !row.scopedTransportFailure
            );
            if (
                state.hold !== "usage_unresolved" ||
                unknown.length === 0 ||
                unknown.some(
                    row =>
                        row.route !== "digest" ||
                        row.httpStatus !== undefined ||
                        row.workId !== undefined ||
                        row.failure !== "usage_unresolved" ||
                        row.settledListRateUsd !== undefined ||
                        row.scopedTransportFailure
                ) ||
                (expectedNewIds &&
                    (unknown.length !== expectedNewIds.size ||
                        unknown.some(row => !expectedNewIds.has(row.id))))
            )
                throw new Error("long_decisions_warmup_recovery_denied");
            await meter.clearGenerationTransportHold(unknown.length);
            await saveDiagnostic({
                kind: "warmup_transport_recovered",
                requests: unknown.length,
                heldExposureUsd: meter.snapshot().reservedUsd,
            });
        };
        if ((resumeWarmup || resumeRun) && meter.snapshot().hold === "usage_unresolved")
            await recoverNoHttp();
        const fixedIds = new Set(manifest.fixedSources.map(source => source.documentId));
        const eligible = new Set<string>();
        for (const { group } of revision === "v2" ? [] : schedule) {
            const cutoff = manifest.weeks.find(week => week.id === group.weekId)?.cutoff;
            if (!cutoff) throw new Error("long_decisions_unknown_reporting_week");
            for (const document of manifest.documents) {
                if (document.visibility !== "actor_readable" || fixedIds.has(document.id)) continue;
                const version = document.versions
                    .filter(item => Date.parse(item.publishedAt) < Date.parse(cutoff))
                    .at(-1);
                if (version) eligible.add(version.id);
            }
        }
        const versionIds =
            revision === "v2"
                ? [...freeCatalogueVersions.get(split)!]
                : [...byVersion]
                      .filter(([, stable]) => eligible.has(stable.versionId))
                      .map(([id]) => id);
        if (
            (revision !== "v2" && versionIds.length !== eligible.size) ||
            (revision === "v2" && versionIds.length === 0)
        )
            throw new Error("long_decisions_digest_inventory_invalid");
        let completedWarmup = false;
        if (revision === "v2" && resumeRun) {
            try {
                const saved = JSON.parse(
                    await readFile(resolve(capture, `digest-warmup-${split}.json`), "utf8")
                );
                if (
                    JSON.stringify(saved.versions) !==
                        JSON.stringify(versionIds.map(stableVersion)) ||
                    !Array.isArray(saved.digestIds) ||
                    saved.digestIds.length !== versionIds.length
                )
                    throw new Error("long_decisions_warmup_binding_invalid");
                completedWarmup = true;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
        }
        const loadActor = await createActor();
        const actor = await loadActor();
        const canReadIds = new Set(workspace.readableDocumentIds);
        const currentEpoch = async () => {
            const [row] = await sql`SELECT version::text FROM pdr_ai_v2_vantage_weekly_review_epochs
                WHERE company_id=${workspace.workspaceId}::bigint`;
            return row?.version;
        };
        const epoch = await currentEpoch();
        const query: WeeklyReviewQuery = async (queryText, args) => {
            try {
                return await database.transaction(run => run(queryText, args));
            } catch (error) {
                const code =
                    (error as { code?: unknown; cause?: { code?: unknown } })?.cause?.code ??
                    (error as { code?: unknown })?.code;
                await saveDiagnostic({
                    kind: "digest_database_failure",
                    code: typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : "unknown",
                });
                throw error;
            }
        };
        const startedAt = Date.now();
        const digestIds: string[] = [];
        // Serial batches warm the initial connection and isolate every paid retry.
        for (const [versionIndex, versionId] of versionIds.entries()) {
            if (revision === "v2") {
                const coldRemaining = versionIds.slice(versionIndex).reduce((sum, id) => {
                    const stable = stableVersion(id);
                    const version = manifest.documents
                        .flatMap(document => document.versions)
                        .find(v => v.id === stable.versionId);
                    if (!version) throw new Error("long_decisions_unknown_result_source");
                    return sum + digestForecast(version.bytes);
                }, 0);
                if (remainingProjection(completedWarmup ? 0 : coldRemaining) > LIMIT_USD)
                    throw new Error("long_decisions_projected_budget_exceeded");
            }
            const batch = [versionId];
            for (let attempt = 0; attempt < 2; attempt++) {
                meter.assertCanDispatch();
                const before = meter.snapshot();
                try {
                    const ready = await prewarmTopicDigests({
                        actor,
                        versionIds: batch,
                        query,
                        provider: async input => {
                            if (completedWarmup)
                                throw new Error("long_decisions_warmup_cache_missing");
                            try {
                                return await digestProvider(input);
                            } catch (error) {
                                await saveDiagnostic({
                                    kind: "digest_provider_failure",
                                    causeCode: causeCode(error),
                                    syntaxError: error instanceof SyntaxError,
                                });
                                throw error;
                            }
                        },
                        authorizeDocument: async document =>
                            canReadIds.has(String(document.id)) &&
                            (await loadActor()).canMutate &&
                            (await currentEpoch()) === epoch,
                    });
                    if (ready.digests.size !== batch.length)
                        throw new Error("benchmark_digest_warm_up_incomplete");
                    digestIds.push(...ready.digestIds);
                    cacheCoveredVersions.add(versionId);
                    if (
                        revision === "v2" &&
                        ((versionIndex + 1) % 10 === 0 || versionIndex + 1 === versionIds.length)
                    )
                        await saveDiagnostic({
                            kind: "digest_progress",
                            split,
                            checkedVersions: versionIndex + 1,
                            requiredVersions: versionIds.length,
                            requests: meter.snapshot().records.length,
                            exposureUsd: meter.snapshot().projectedTotalUsd,
                        });
                    break;
                } catch (error) {
                    await saveDiagnostic({
                        kind: "digest_warmup_failure",
                        ...stableVersion(versionId),
                        code:
                            error instanceof WeeklyReviewConflict
                                ? error.code
                                : error instanceof Error &&
                                    /^benchmark_[a-z_]+$/.test(error.message)
                                  ? error.message
                                  : "unknown",
                    });
                    await meter.drainPending();
                    const state = meter.snapshot();
                    const oldIds = new Set(before.records.map(row => row.id));
                    const added = state.records.filter(row => !oldIds.has(row.id));
                    if (
                        attempt !== 0 ||
                        added.length !== 1 ||
                        added.some(
                            row =>
                                row.status !== "unknown" ||
                                row.httpStatus !== undefined ||
                                row.route !== "digest" ||
                                row.workId !== undefined
                        ) ||
                        state.hold !== "usage_unresolved"
                    )
                        throw error;
                    await recoverNoHttp(new Set(added.map(row => row.id)));
                }
            }
        }
        await meter.drainPending();
        const audit = {
            ...(revision === "v2"
                ? {
                      schemaVersion: "long-decisions-warmup/2",
                      specSha256: manifest.specSha256,
                      split,
                      source: "actual_free_catalogue_union",
                  }
                : {}),
            versions: versionIds.map(stableVersion),
            digestIds,
            elapsedMs: Date.now() - startedAt,
            exposureUsd: meter.snapshot().projectedTotalUsd,
        };
        await writeJson(
            resolve(
                capture,
                revision === "v2" ? `digest-warmup-${split}.json` : "digest-warmup.json"
            ),
            audit
        );
        console.log(
            JSON.stringify({
                digestWarmup: digestIds.length,
                exposureUsd: audit.exposureUsd,
                durationMs: audit.elapsedMs,
            })
        );
        return audit.exposureUsd;
    };
    const resumeLock = resolve(capture, "resume-warmup.lock");
    if (resumeWarmup || resumeRun || (revision === "v2" && mayCallLive))
        await writeFile(resumeLock, "", { flag: "wx" });
    try {
        if (
            (resumeWarmup || resumeRun) &&
            JSON.stringify(priorLedger) !==
                JSON.stringify(
                    JSON.parse(await readFile(resolve(capture, "usage-ledger.json"), "utf8"))
                )
        )
            throw new Error("long_decisions_warmup_ledger_changed");
        if (!resumeWarmup && !resumeRun) await writeJson(resolve(capture, "method.json"), method);
        if (meter && meteredFetch) {
            await writeJson(resolve(capture, "usage-ledger.json"), meter.snapshot());
            globalThis.fetch = meteredFetch;
        }
        let completed = resumeWarmup ? priorDevRows.length : 0;
        let liveCases = 0;
        let exposureAfterWarmup = 0;
        const runJob = async (
            job: (typeof schedule)[number],
            arm: (typeof FREE_ARMS)[number] | "live"
        ) => {
            const { split, group, capBytes } = job;
            const saved = resumedCaptures.get(jobFile(job, arm));
            if (saved) {
                if (arm !== "live") recordFreeCatalogue(split, saved.result);
                if (arm !== "live" && saved.rows.some(row => row.status === "failed"))
                    throw new Error("long_decisions_free_control_failed");
                completed++;
                return saved.rows;
            }
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
                    ? await meter.withWork(
                          "sweep-" + String(liveCases + 1).padStart(3, "0"),
                          execute
                      )
                    : await execute();
            const [record] = result.runId
                ? await sql`SELECT trace,digest_ids FROM pdr_ai_v2_vantage_weekly_review_run_manifests
                WHERE run_id=${result.runId}::uuid`
                : [];
            const explored = projectToolAccess(record?.trace, byRef, byHandle);
            const offered = (result.offered ?? []).map(item => stableVersion(item.versionId));
            if (arm !== "live") recordFreeCatalogue(split, result);
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
                ...(revision === "v2" ? { asOf: week.cutoff } : {}),
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
                                data:
                                    "pairedBackfill" in result ? result.pairedBackfill : undefined,
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
            await writeJson(resolve(capture, jobFile(job, arm)), {
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
            if (arm === "live") completedLiveKeys.add(jobFile(job, arm));
            if (revision === "v2")
                await writeJson(resolve(capture, "progress.json"), {
                    revision,
                    completed,
                    expectedJobs: schedule.length * (mayCallLive ? 3 : 2),
                    expectedRows: schedule.length * (mayCallLive ? 5 : 2),
                    split,
                    groupId: group.id,
                    capBytes,
                    arm,
                    exposureUsd: meter?.snapshot().projectedTotalUsd,
                });
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
            if (revision === "v2" && arm !== "live" && rows.some(row => row.status === "failed"))
                throw new Error("long_decisions_free_control_failed");
            return rows;
        };
        if (smoke) {
            const job = schedule.find(job => job.split === "dev" && job.capBytes === 80000);
            if (!job) throw new Error("long_decisions_smoke_job_missing");
            if ((await runJob(job, "live")).some(row => row.status === "failed"))
                throw new Error("long_decisions_smoke_freeze_failed");
            return;
        }
        for (const split of SPLITS) {
            const jobs = schedule.filter(job => job.split === split);
            const rows: unknown[] = resumeWarmup && split === "dev" ? [...priorDevRows] : [];
            if (!(resumeWarmup && split === "dev")) {
                for (const job of jobs)
                    for (const arm of FREE_ARMS) rows.push(...(await runJob(job, arm)));
                await writeJson(resolve(capture, split + "-rows.json"), rows);
            }
            observedSplitCatalogues.add(split);
            if (!meter) continue;
            if (
                (revision === "v2" || split === "dev") &&
                jobs.some(job => !completedLiveKeys.has(jobFile(job, "live")))
            )
                exposureAfterWarmup = await warmOfferedDigests(split);
            for (const job of jobs) {
                meter.assertCanDispatch();
                const exposure = meter.snapshot().projectedTotalUsd;
                const observedUsd =
                    liveCases > 3 ? ((exposure - exposureAfterWarmup) / liveCases) * 1.5 : 0;
                const predicted =
                    revision === "v2"
                        ? remainingProjection()
                        : exposure +
                          (schedule.length - liveCases) * Math.max(explorationUnitUsd, observedUsd);
                if (predicted > LIMIT_USD)
                    throw new Error("long_decisions_projected_budget_exceeded");
                rows.push(...(await runJob(job, "live")));
                await meter.drainPending();
                liveCases++;
                await writeJson(resolve(capture, split + "-rows.json"), rows);
            }
        }
    } finally {
        globalThis.fetch = originalFetch;
        await meter?.drainPending();
        await sql.end();
        if (resumeWarmup || resumeRun || (revision === "v2" && mayCallLive))
            await unlink(resumeLock);
    }
}

main().catch(error => {
    const safe =
        error instanceof Error && /^(long_decisions|benchmark)_[a-z_]+$/.test(error.message);
    console.error(safe ? error.message : "long_decisions_run_failed");
    process.exitCode = 1;
});
