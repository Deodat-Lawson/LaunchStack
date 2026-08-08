import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, rename, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { ZodError } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { eq } from "drizzle-orm";
import { company } from "@launchstack/core/db/schema";
import { founderWeeklyReviewDispatches, founderWeeklyReviewRuns } from "~/server/db/schema";
import { FounderWeeklyReviewRepository, FounderWeeklyReviewWorkerService, FounderWeeklyReviewV2PayloadSchema, generateFounderWeeklyReview, type FounderWeeklyReviewStructuredGenerator } from "@launchstack/features/founder-weekly-review";
import { createFounderWeeklyReviewDispatchService } from "~/server/founder-weekly-review/dispatch-service";
import { renderFounderWeeklyReviewMarkdown } from "~/server/founder-weekly-review/markdown";
import { syntheticFounderWeeklyReviewFixtures } from "./founder-weekly-review-synthetic-fixtures";

const require = createRequire(import.meta.url);
const { createFounderWeeklyReviewTestDatabase } = require("../__tests__/founderWeeklyReview/testDb") as typeof import("../__tests__/founderWeeklyReview/testDb");

function canonicalizeJson(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot canonicalize non-finite number.");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalizeJson((value as Record<string, unknown>)[key])]));
  }
  throw new Error("Cannot canonicalize unsupported JSON value.");
}

function digestJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalizeJson(value)), "utf8").digest("hex");
}

async function writeAtomically(path: string, content: string) {
  try { await access(path); throw new Error("Refusing to overwrite an existing export."); } catch (error) { if (!(error instanceof Error) || !error.message.includes("ENOENT")) { if (error instanceof Error && error.message.includes("overwrite")) throw error; } }
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

function markdownFor(run: { reportingPeriod: { start: string; end: string }; modelMetadata: { provider?: string; model?: string } | null; reviewPayload: any; evidenceSnapshot: { items: Array<{ sourceId: string; sourceType: string; title: string; sourceTimestamp?: string }> } }) {
  const labels: Record<string, string> = { whatChanged: "Other Meaningful Changes", whatShipped: "Shipped This Period", whatCustomersSaid: "Customer Signals", currentBlockers: "Risks & Blockers", nextPriorities: "Priorities for the Next Period" };
  const none: Record<string, string> = { whatChanged: "No other evidence-backed changes were identified during this reporting period.", whatShipped: "No completed product releases were identified during this reporting period.", whatCustomersSaid: "No customer feedback was available for this reporting period.", currentBlockers: "No evidence-backed blockers were identified during this reporting period.", nextPriorities: "No evidence-backed priorities were identified for the next reporting period." };
  const reference = new Map<string, number>(); const source = new Map(run.evidenceSnapshot.items.map((item) => [item.sourceId, item])); const references: string[] = [];
  const cite = (ids: string[] = []) => ids.map((id) => { let n = reference.get(id); if (!n) { n = reference.size + 1; reference.set(id, n); const item = source.get(id); references.push(`[${n}] ${item?.title ?? item?.sourceType ?? "Evidence"}`); } return `[${n}]`; }).join("");
  const period = `${new Date(`${run.reportingPeriod.start}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric" })}–${new Date(`${run.reportingPeriod.end}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", year: "numeric" })}`;
  const shippedTexts = new Set((run.reviewPayload.sections.whatShipped?.items ?? []).map((item: any) => String(item.text ?? "").trim().replace(/\s+/g, " ")));
  const lines = ["# Founder Weekly Review", "", `**Reporting period:** ${period}`, "", "## Key Outcomes", ""];
  for (const key of ["whatShipped", "whatChanged", "whatCustomersSaid", "currentBlockers", "nextPriorities"]) { const section = run.reviewPayload.sections[key]; lines.push(`## ${labels[key]!}`); if (section?.state === "no_evidence") lines.push(none[key]!); else { const items = (section?.items ?? []).filter((item: any) => key !== "whatChanged" || !shippedTexts.has(String(item.text ?? "").trim().replace(/\s+/g, " "))); if (!items.length) lines.push(none[key]!); else items.forEach((item: any, index: number) => lines.push(key === "nextPriorities" ? `${index + 1}. ${item.text}${cite(item.sourceIds)}` : `- ${item.text}${cite(item.sourceIds)}`)); } lines.push(""); }
  if (references.length) lines.push("## Evidence References", "", ...references, "");
  lines.push("---", "", `*Generated with ${run.modelMetadata?.model ?? "the configured model"}*`); return lines.join("\n");
}

if (process.env.SYNTHETIC_FWR_LOCAL !== "1") throw new Error("Refusing synthetic baseline: set SYNTHETIC_FWR_LOCAL=1.");
const deterministicMode = (process.argv[2]?.startsWith("negative-") ?? false) || process.argv[2] === "retry-snapshot-immutability";
if (process.env.NODE_ENV === "production") throw new Error("Refusing synthetic baseline in production.");
const url = process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
if (!/^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(url)) throw new Error("Refusing non-local database.");

/**
 * The harness talks to one OpenAI-compatible endpoint, the same contract the
 * application's chat configuration assumes. Whether that is a local Ollama, a
 * hosted Gemini-compatible endpoint or anything else is a matter of these three
 * variables — the harness carries no provider-specific code.
 */
const SYNTHETIC_BASE_URL = (process.env.SYNTHETIC_FWR_BASE_URL ?? "http://127.0.0.1:11434/v1").replace(/\/+$/, "");
const SYNTHETIC_MODEL = process.env.SYNTHETIC_FWR_MODEL ?? "llama3.1:8b";
const SYNTHETIC_API_KEY = process.env.SYNTHETIC_FWR_API_KEY ?? "not-needed";
if (!deterministicMode && !/^https?:\/\//i.test(SYNTHETIC_BASE_URL)) {
  throw new Error("Refusing synthetic baseline: SYNTHETIC_FWR_BASE_URL must be an http(s) URL.");
}

async function generateWithConfiguredEndpoint<TSchema extends import("zod").ZodType>(input: { system?: string; prompt: string; schema: TSchema; schemaName?: string }) {
  // json_object plus the schema in the system message: the widest subset every
  // OpenAI-compatible server honours. Strict json_schema is not universal.
  const schemaGuide = JSON.stringify(zodToJsonSchema(input.schema, input.schemaName ?? "founder_weekly_review"));
  console.log(JSON.stringify({ stage: "endpoint_request_constructed", result: "pass" }));
  const response = await fetch(`${SYNTHETIC_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SYNTHETIC_API_KEY}` },
    body: JSON.stringify({
      model: SYNTHETIC_MODEL,
      temperature: 0,
      stream: false,
      messages: [
        { role: "system", content: `${input.system ?? ""}\nReturn one JSON object only. Its complete required structural schema is: ${schemaGuide}` },
        { role: "user", content: input.prompt },
      ],
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  console.log(JSON.stringify({ stage: "endpoint_http_response", result: response.ok ? "pass" : "fail", httpStatus: response.status }));
  if (!response.ok) throw new Error(`endpoint_http_error:${response.status}`);
  const body = await response.json() as { model?: string; usage?: Record<string, string | number | boolean | null>; choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content?.trim()) throw new Error("endpoint_missing_content");
  console.log(JSON.stringify({ stage: "endpoint_content_extracted", result: "pass" }));
  let parsed: unknown;
  try { parsed = JSON.parse(content); console.log(JSON.stringify({ stage: "endpoint_json_parsed", result: "pass" })); }
  catch { throw new Error("endpoint_json_parse_failed"); }
  try {
    const object = input.schema.parse(parsed);
    console.log(JSON.stringify({ stage: "review_schema_valid", result: "pass" }));
    return {
      object,
      metadata: {
        provider: SYNTHETIC_BASE_URL,
        model: body.model ?? SYNTHETIC_MODEL,
        capability: "founderWeeklyReview",
        temperature: 0,
        ...(body.choices?.[0]?.finish_reason ? { finishReason: body.choices[0].finish_reason } : {}),
        ...(body.usage ? { usage: body.usage } : {}),
      },
    };
  }
  catch (error) { const issues = error instanceof ZodError ? error.issues.map((issue) => ({ path: issue.path, code: issue.code, ...("expected" in issue ? { expected: issue.expected } : {}), ...("received" in issue ? { received: issue.received } : {}) })) : []; console.log(JSON.stringify({ stage: "review_schema_valid", result: "fail", topLevelKeys: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed as object) : [], issues })); throw new Error("review_schema_invalid"); }
}

const fixtureName = process.argv[2] ?? "partial";
const isNegativeUnknownCitation = fixtureName === "negative-unknown-citation";
const isNegativeFounderContextCustomer = fixtureName === "negative-founder-context-customer";
const isDeterministicNegative = isNegativeUnknownCitation || isNegativeFounderContextCustomer;
const isRetrySnapshotImmutability = fixtureName === "retry-snapshot-immutability";
const snapshot = fixtureName === "negative-founder-context-customer" ? syntheticFounderWeeklyReviewFixtures.partial : (fixtureName.startsWith("negative-") || isRetrySnapshotImmutability) ? syntheticFounderWeeklyReviewFixtures.full : syntheticFounderWeeklyReviewFixtures[fixtureName as keyof typeof syntheticFounderWeeklyReviewFixtures];
if (!snapshot) throw new Error("Fixture must be partial, full, empty, negative-unknown-citation, negative-founder-context-customer, or retry-snapshot-immutability.");
const testDb = await createFounderWeeklyReviewTestDatabase();
try {
  await testDb.db.insert(company).values({ id: 3, name: "Synthetic FWR", numberOfEmployees: "1" });
  const actor = { companyId: 3n, userId: 1n, externalUserId: "synthetic-owner", role: "owner" as const, workspaceTimezone: "UTC" };
  const requestKey = `synthetic-${fixtureName}-${randomUUID()}`;
  const dispatchService = createFounderWeeklyReviewDispatchService(testDb.db);
  const { run, dispatch } = await dispatchService.createRunWithDispatch({ actor, requestKey, reportingPeriod: snapshot.reportingPeriod, evidenceSnapshot: snapshot });
  const event = { runId: dispatch.runId, companyId: dispatch.companyId.toString(), generationJobId: dispatch.generationJobId, generationClaimId: dispatch.generationClaimId };
  const worker = new FounderWeeklyReviewWorkerService(new FounderWeeklyReviewRepository(testDb.db));
  const claimed = await worker.claimQueuedRun({ companyId: BigInt(event.companyId), runId: event.runId, generationJobId: event.generationJobId, generationClaimId: event.generationClaimId });
  let generated: Awaited<ReturnType<typeof generateFounderWeeklyReview>> | null = null;
  try {
    const none = { state: "no_evidence" as const, noEvidence: { code: "none", message: "No evidence", cta: "Add evidence" } };
    const validPayload = FounderWeeklyReviewV2PayloadSchema.parse({ schemaVersion: "founder-weekly-review/v2", sections: { whatChanged: { state: "evidence", items: [{ kind: "observed_fact", text: "Release evidence.", sourceIds: ["synthetic:doc:release"], confidence: 0.8 }] }, whatShipped: none, whatCustomersSaid: { state: "evidence", items: [{ kind: "observed_fact", text: "Customer signal.", sourceIds: ["synthetic:feedback:export"], confidence: 0.8 }] }, currentBlockers: none, nextPriorities: none } });
    const payload = structuredClone(validPayload);
    if (isNegativeUnknownCitation || isRetrySnapshotImmutability) payload.sections.whatChanged = { state: "evidence", items: [{ kind: "observed_fact", text: "Release evidence.", sourceIds: ["synthetic:missing:unknown-citation"], confidence: 0.8 }] };
    if (isNegativeFounderContextCustomer) payload.sections.whatCustomersSaid = { state: "evidence", items: [{ kind: "observed_fact", text: "Customer signal.", sourceIds: ["synthetic:context:priority"], confidence: 0.8 }] };
    if (!claimed.evidenceSnapshot) throw new Error("Synthetic baseline requires a persisted evidence snapshot.");
    // The deterministic arm returns a fixed payload rather than something
    // inferred from the caller's schema, so it cannot satisfy the generic
    // signature without a cast.
    const deterministicGenerate = (async () => ({
      object: payload,
      metadata: { provider: "synthetic", model: "deterministic", capability: "founderWeeklyReview", temperature: 0 },
    })) as unknown as FounderWeeklyReviewStructuredGenerator;
    generated = await generateFounderWeeklyReview({
      evidenceSnapshot: claimed.evidenceSnapshot,
      generate: (isDeterministicNegative || isRetrySnapshotImmutability) ? deterministicGenerate : generateWithConfiguredEndpoint,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_generation_failure";
    const failureKind = message.includes("absent from the evidence snapshot") ? "citation_validation_failed" : message.includes("must never be presented as customer feedback") ? "source_semantic_validation_failed" : ["ollama_http_error", "ollama_missing_content", "ollama_json_parse_failed", "review_schema_invalid"].find((kind) => message.startsWith(kind)) ?? "unknown_generation_failure";
    const failed = await worker.markGenerationFailed({ companyId: BigInt(event.companyId), runId: event.runId, generationJobId: event.generationJobId, generationClaimId: event.generationClaimId }, { errorCode: "generation_failed", errorMessage: "Synthetic baseline provider generation failed." });
    const readBack = await new FounderWeeklyReviewRepository(testDb.db).getByCompanyAndRunId(3n, failed.id);
    const unchanged = readBack ? digestJson(readBack.evidenceSnapshot) === digestJson(snapshot) : false;
    const citation = failureKind === "citation_validation_failed" ? "failed" : failureKind === "source_semantic_validation_failed" ? "passed" : "not_reached";
    const semantic = failureKind === "source_semantic_validation_failed" ? "failed" : "not_reached";
    if (isRetrySnapshotImmutability) {
      if (!readBack || failureKind !== "citation_validation_failed" || readBack.status !== "failed" || readBack.retryCount !== 0 || readBack.errorCode !== "generation_failed" || readBack.reviewPayload || !unchanged) throw new Error("Retry baseline precondition failed.");
      const before = readBack;
      const retryRequestKey = `synthetic-retry-${randomUUID()}`;
      const firstRetry = await dispatchService.retryRunWithDispatch({ actor, runId: before.id, requestKey: retryRequestKey });
      const afterFirstRetry = await new FounderWeeklyReviewRepository(testDb.db).getByCompanyAndRunId(actor.companyId, before.id);
      let secondRetryBehavior: "idempotent_queued_return" | "lifecycle_conflict";
      let secondRetry: Awaited<ReturnType<typeof dispatchService.retryRunWithDispatch>> | null = null;
      try {
        secondRetry = await dispatchService.retryRunWithDispatch({ actor, runId: before.id, requestKey: retryRequestKey });
        secondRetryBehavior = "idempotent_queued_return";
      } catch {
        secondRetryBehavior = "lifecycle_conflict";
      }
      const afterSecondRetry = await new FounderWeeklyReviewRepository(testDb.db).getByCompanyAndRunId(actor.companyId, before.id);
      const allRuns = await new FounderWeeklyReviewRepository(testDb.db).listByCompany(actor.companyId);
      const matchingRuns = allRuns.filter((candidate) => candidate.requestKey === before.requestKey);
      const retryDispatches = (await testDb.db.select().from(founderWeeklyReviewDispatches)).filter((candidate) => candidate.runId === before.id && candidate.operationType === "retry");
      const retryClaim = await worker.claimQueuedRun({ companyId: actor.companyId, runId: firstRetry.run.id, generationJobId: firstRetry.dispatch.generationJobId, generationClaimId: firstRetry.dispatch.generationClaimId });
      const afterClaim = await new FounderWeeklyReviewRepository(testDb.db).getByCompanyAndRunId(actor.companyId, before.id);
      const sameIdentity = Boolean(afterFirstRetry && afterSecondRetry && afterClaim) && before.id === afterFirstRetry!.id && before.id === afterSecondRetry!.id && before.id === afterClaim!.id;
      const snapshotUnchanged = Boolean(afterFirstRetry && afterSecondRetry && afterClaim) && digestJson(before.evidenceSnapshot) === digestJson(afterFirstRetry!.evidenceSnapshot) && digestJson(before.evidenceSnapshot) === digestJson(afterSecondRetry!.evidenceSnapshot) && digestJson(before.evidenceSnapshot) === digestJson(afterClaim!.evidenceSnapshot);
      const requestKeyUnchanged = Boolean(afterClaim) && before.requestKey === afterClaim!.requestKey;
      const companyUnchanged = Boolean(afterClaim) && before.companyId === afterClaim!.companyId;
      const periodUnchanged = Boolean(afterClaim) && before.reportingPeriod.start === afterClaim!.reportingPeriod.start && before.reportingPeriod.end === afterClaim!.reportingPeriod.end;
      const schemaVersionsUnchanged = Boolean(afterClaim) && before.evidenceSchemaVersion === afterClaim!.evidenceSchemaVersion && before.reviewSchemaVersion === afterClaim!.reviewSchemaVersion;
      const reviewPayloadAbsent = !afterClaim?.reviewPayload;
      const retryCounts = [before.retryCount, afterFirstRetry?.retryCount, afterSecondRetry?.retryCount];
      const retryDispatchCreated = firstRetry.dispatch.operationType === "retry" && retryDispatches.length === 1 && (!secondRetry || secondRetry.dispatch.id === firstRetry.dispatch.id);
      console.log(JSON.stringify({ fixture: fixtureName, runId: before.id, lifecycle: [run.status, claimed.status, failed.status, firstRetry.run.status, retryClaim.status], retryCounts, sameRow: sameIdentity, matchingRunRowCount: matchingRuns.length, snapshotUnchanged, requestKeyUnchanged, companyUnchanged, periodUnchanged, schemaVersionsUnchanged, reviewPayloadAbsent, duplicateRetryBehavior: secondRetryBehavior, outboxBehavior: retryDispatchCreated ? "creates_one_retry_dispatch_and_reuses_it_for_duplicate_request_key" : "unexpected_retry_dispatch_state", postRetryClaimSucceeded: retryClaim.status === "generating", externalProviderCalled: false }));
      if (!sameIdentity || matchingRuns.length !== 1 || afterFirstRetry?.retryCount !== 1 || afterSecondRetry?.retryCount !== 1 || afterClaim?.retryCount !== 1 || !snapshotUnchanged || !requestKeyUnchanged || !companyUnchanged || !periodUnchanged || !schemaVersionsUnchanged || !reviewPayloadAbsent || !retryDispatchCreated || retryClaim.status !== "generating") throw new Error("Retry snapshot immutability invariant failed.");
    } else {
      console.log(JSON.stringify({ fixture: fixtureName, runId: failed.id, lifecycle: [run.status, claimed.status, failed.status], canonicalSchemaValidation: "passed", citationValidation: citation, sourceSemanticValidation: semantic, firstFailingBoundary: failureKind, finalStatus: readBack?.status, errorCode: readBack?.errorCode, draftPersisted: Boolean(readBack?.reviewPayload), draftRetrievable: Boolean(readBack?.reviewPayload), snapshotUnchanged: unchanged }));
      if (!isDeterministicNegative || !readBack || failureKind !== (isNegativeUnknownCitation ? "citation_validation_failed" : "source_semantic_validation_failed") || readBack.status !== "failed" || readBack.errorCode !== "generation_failed" || readBack.reviewPayload || !unchanged) throw new Error("Negative safety invariant failed.");
    }
  }
  if (!isDeterministicNegative && !isRetrySnapshotImmutability) {
  const saved = await worker.saveGeneratedDraft({ companyId: BigInt(event.companyId), runId: event.runId, generationJobId: event.generationJobId, generationClaimId: event.generationClaimId }, generated!.reviewPayload, generated!.modelMetadata);
  const [persisted] = await testDb.db.select().from(founderWeeklyReviewRuns).where(eq(founderWeeklyReviewRuns.id, saved.id));
  const [persistedDispatch] = await testDb.db.select().from(founderWeeklyReviewDispatches).where(eq(founderWeeklyReviewDispatches.id, dispatch.id));
  if (!persisted || !persistedDispatch) throw new Error("Synthetic baseline persistence verification failed.");
  const ids = new Set(snapshot.items.map((item) => item.sourceId));
  for (const section of Object.values(saved.reviewPayload!.sections)) if (section.state === "evidence") for (const item of section.items) for (const id of item.sourceIds) if (!ids.has(id)) throw new Error("Persisted citation is not in snapshot.");
  const customerSection = saved.reviewPayload!.sections.whatCustomersSaid;
  const readBack = await new FounderWeeklyReviewRepository(testDb.db).getByCompanyAndRunId(3n, saved.id);
  if (!readBack?.reviewPayload || readBack.status !== "draft") throw new Error("Validated draft read-back failed.");
  const shouldExport = process.env.SYNTHETIC_FWR_EXPORT_REPORT === "1";
  const shouldPrint = process.env.FWR_PRINT_REPORT === "1";
  if (shouldExport || shouldPrint) {
    if (!readBack.evidenceSnapshot) throw new Error("Validated draft has no evidence snapshot.");
    const renderedMarkdown = renderFounderWeeklyReviewMarkdown(readBack as typeof readBack & { evidenceSnapshot: NonNullable<typeof readBack.evidenceSnapshot> });
    if (shouldPrint) {
      console.log("===== FOUNDER WEEKLY REVIEW =====");
      console.log(renderedMarkdown);
      console.log("===== END FOUNDER WEEKLY REVIEW =====");
    }
    if (shouldExport) {
    const directory = resolve(process.cwd(), process.env.SYNTHETIC_FWR_EXPORT_DIR ?? ".artifacts/founder-weekly-review");
    await mkdir(directory, { recursive: true });
    const fileId = saved.id.replace(/[^A-Za-z0-9_-]/g, "_");
    const envelope = { runId: readBack.id, status: readBack.status, provider: readBack.modelMetadata?.provider, model: readBack.modelMetadata?.model, periodStart: readBack.reportingPeriod.start, periodEnd: readBack.reportingPeriod.end, review: readBack.reviewPayload };
    const markdownPath = resolve(directory, `${fileId}.md`); const jsonPath = resolve(directory, `${fileId}.json`);
    await writeAtomically(markdownPath, renderedMarkdown); await writeAtomically(jsonPath, JSON.stringify(envelope, null, 2));
    console.log(JSON.stringify({ runId: readBack.id, status: readBack.status, markdownPath, jsonPath, filesWritten: true }));
    }
  }
  console.log(JSON.stringify({ label: "Synthetic-evidence integration baseline", fixture: fixtureName, runId: saved.id, lifecycle: [run.status, claimed.status, saved.status], event, provider: generated!.modelMetadata.provider, model: generated!.modelMetadata.model, snapshotUnchanged: digestJson(persisted.evidenceSnapshot) === digestJson(snapshot), outbox: { status: persistedDispatch.status, hasEvidence: false }, customerSection: "state" in customerSection ? customerSection.state : "legacy", draftReturnedByRepository: saved.status === "draft" }));
  }
} finally { await testDb.close(); }
