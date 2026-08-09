import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, mkdir, rename, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { company, document, documentContextChunks, documentStructure, documentVersions } from "@launchstack/core/db/schema";
import { founderWeeklyReviewDispatches, founderWeeklyReviewRuns } from "~/server/db/schema";
import { FounderWeeklyReviewEvidenceService, FounderWeeklyReviewEvidenceSnapshotSchema, FounderWeeklyReviewRepository, FounderWeeklyReviewWorkerService, generateFounderWeeklyReview, validateFounderWeeklyReviewV2Citations } from "@launchstack/features/founder-weekly-review";
import { FounderWeeklyReviewDocumentVersionStore } from "~/server/founder-weekly-review/document-version-chunks";
import { StrictCurrentWorkspaceDocumentStore } from "~/server/founder-weekly-review/workspace-document-store";
import { createFounderWeeklyReviewDispatchService } from "~/server/founder-weekly-review/dispatch-service";
import { generateFounderWeeklyReviewStructured } from "~/server/founder-weekly-review/generation-adapter";
import { renderFounderWeeklyReviewMarkdown } from "~/server/founder-weekly-review/markdown";
import { founderWeeklyReviewRealisticExportRoot, parseFounderWeeklyReviewRealisticEvidenceMode } from "~/server/founder-weekly-review/realistic-e2e-mode";

const require = createRequire(import.meta.url);
const { createFounderWeeklyReviewTestDatabase } = require("../__tests__/founderWeeklyReview/testDb") as typeof import("../__tests__/founderWeeklyReview/testDb");
const fixturePath = resolve(process.cwd(), "test-fixtures/founder-weekly-review/realistic-company/seed.json");
type Fixture = { reportingPeriod: { start: string; end: string }; workspaceTimezone: string; founderContext: string; documents: Array<{ title: string; category: string; changelog: string; timestamp: string; chunks?: string[] }> };
type EvidenceMode = ReturnType<typeof parseFounderWeeklyReviewRealisticEvidenceMode>;
type ComputedTexts = { before: string; after: string; v3: string; bHistorical: string; nullVersion: string; foreign: string; unrelated: string };
type ArtifactPaths = { evidence: string; report: string; markdown: string; summary: string };

function canonicalize(value: unknown): unknown { if (value === null || ["string", "boolean"].includes(typeof value)) return value; if (typeof value === "number" && Number.isFinite(value)) return value; if (Array.isArray(value)) return value.map(canonicalize); if (typeof value === "object") return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalize((value as Record<string, unknown>)[key])])); throw new Error("Cannot canonicalize snapshot."); }
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex"); }
async function writeAtomic(path: string, body: string) { try { await access(path); throw new Error("Refusing to overwrite export."); } catch (error) { if (error instanceof Error && error.message.includes("overwrite")) throw error; } const temp = `${path}.${randomUUID()}.tmp`; await writeFile(temp, body, "utf8"); await rename(temp, path); }
const vector = (index: number) => Array.from({ length: 1536 }, (_, i) => i === index ? 1 : 0);
const vectorSql = (index: number) => sql`${JSON.stringify(vector(index))}::vector(1536)`;

function assertComputedSnapshot(snapshot: unknown, ids: Record<string, bigint | number>, texts: ComputedTexts) {
  const parsed = FounderWeeklyReviewEvidenceSnapshotSchema.parse(snapshot);
  const items = parsed.items;
  const changes = items.filter((item) => item.sourceType === "document_change");
  const workspace = items.filter((item) => item.sourceType === "workspace_document");
  const feedback = items.filter((item) => item.sourceType === "customer_feedback");
  const founder = items.filter((item) => item.sourceType === "founder_context");
  const change = changes.find((item) => item.metadata.previousVersionId === ids.a1 && item.metadata.currentVersionId === ids.a2);
  const workspaceItem = workspace.find((item) => item.metadata.documentId === String(ids.b));
  if (!change || !workspaceItem || !feedback.length || founder.length !== 1) throw new Error("Computed snapshot is missing required evidence types.");
  if (change.metadata.previousChunkId === null || change.metadata.currentChunkId === null || !change.excerpt.includes(texts.before) || !change.excerpt.includes(texts.after) || change.sourceTimestamp !== "2026-02-20T10:00:00.000Z" || change.excerpt.includes(texts.v3) || change.excerpt.startsWith("Version ")) throw new Error("Computed document-change assertions failed.");
  if (workspaceItem.metadata.documentVersionId !== String(ids.b2) || workspaceItem.metadata.chunkId !== ids.bCurrentChunk || workspaceItem.metadata.retrievalReason !== "founder_context_relevance" || typeof workspaceItem.metadata.similarityScore !== "number" || "sourceTimestamp" in workspaceItem) throw new Error("Strict workspace-document assertions failed.");
  if (items.some((item) => [texts.v3, texts.bHistorical, texts.nullVersion, texts.foreign, texts.unrelated].some((value) => item.excerpt.includes(value)))) throw new Error("Computed control evidence leaked into the snapshot.");
  if (new Set(items.map((item) => item.sourceId)).size !== items.length) throw new Error("Computed snapshot contains duplicate source IDs.");
  return { parsed, counts: Object.fromEntries(["document_change", "workspace_document", "customer_feedback", "founder_context"].map((type) => [type, items.filter((item) => item.sourceType === type).length])) };
}
function assertComputedReport(payload: any, snapshot: ReturnType<typeof FounderWeeklyReviewEvidenceSnapshotSchema.parse>) {
  validateFounderWeeklyReviewV2Citations(payload, snapshot);
  const sourceTypeById = new Map(snapshot.items.map((item) => [item.sourceId, item.sourceType]));
  const citedTypes = (section: any) => section.state === "evidence" ? section.items.flatMap((item: any) => item.sourceIds.map((id: string) => sourceTypeById.get(id))) : [];
  const changed = payload.sections.whatChanged;
  if (changed.state !== "evidence" || !citedTypes(changed).includes("document_change")) throw new Error("Generated report did not cite the computed document change in whatChanged.");
  const shipped = payload.sections.whatShipped;
  if (shipped.state === "evidence" && citedTypes(shipped).length > 0 && citedTypes(shipped).every((type: unknown) => type === "workspace_document")) throw new Error("Generated report used workspace evidence alone for whatShipped.");
  if (citedTypes(payload.sections.whatCustomersSaid).some((type: unknown) => type !== "customer_feedback")) throw new Error("Generated report violated customer-feedback source semantics.");
  if (payload.sections.currentBlockers.state === "evidence" && !citedTypes(payload.sections.currentBlockers).includes("workspace_document")) throw new Error("Generated report did not use current workspace context for blockers.");
}

if (process.env.SYNTHETIC_FWR_LOCAL !== "1" || process.env.NODE_ENV === "production") throw new Error("Refusing realistic E2E outside explicit local mode.");
const localUrl = process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
if (!/^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(localUrl)) throw new Error("Refusing non-local database.");

const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const mode = parseFounderWeeklyReviewRealisticEvidenceMode(process.env.FWR_EVIDENCE_MODE);
const testDb = await createFounderWeeklyReviewTestDatabase();
try {
  const [target] = await testDb.db.insert(company).values({ name: "Northstar Analytics", numberOfEmployees: "24" }).returning();
  const [other] = await testDb.db.insert(company).values({ name: "Other Company", numberOfEmployees: "4" }).returning();
  const actor = { externalUserId: "realistic-owner", internalUserId: 1n, companyId: BigInt(target!.id), role: "owner" };
  let collector: FounderWeeklyReviewEvidenceService;
  let computedIds: Record<string, bigint | number> | undefined;
  const texts: ComputedTexts = { before: "Product owns retry telemetry.", after: "Platform owns retry telemetry and recovery monitoring.", v3: "v3 future-only operational note", bHistorical: "historical workspace reliability text", nullVersion: "null-version workspace reliability text", foreign: "foreign workspace reliability text", unrelated: "unrelated current cafeteria menu" };

  if (mode === "legacy") {
    for (const entry of fixture.documents) { const [doc] = await testDb.db.insert(document).values({ companyId: BigInt(target!.id), url: `local://${entry.title}`, category: entry.category, title: entry.title }).returning(); const [version] = await testDb.db.insert(documentVersions).values({ documentId: BigInt(doc!.id), versionNumber: 1, url: `local://${entry.title}/v1`, mimeType: "text/plain", uploadedBy: "seed", changelog: entry.changelog, createdAt: new Date(entry.timestamp) }).returning(); for (const [index, content] of (entry.chunks ?? []).entries()) await testDb.db.insert(documentContextChunks).values({ documentId: BigInt(doc!.id), versionId: BigInt(version!.id), content, tokenCount: content.split(/\s+/).length, charCount: content.length, pageNumber: index + 1 }); }
    const [outsideDoc] = await testDb.db.insert(document).values({ companyId: BigInt(target!.id), url: "local://outside", category: "Product", title: "Outside period" }).returning(); await testDb.db.insert(documentVersions).values({ documentId: BigInt(outsideDoc!.id), versionNumber: 1, url: "local://outside/v1", mimeType: "text/plain", uploadedBy: "seed", changelog: "Outside-period control.", createdAt: new Date("2026-03-01T00:00:00.000Z") });
    collector = new FounderWeeklyReviewEvidenceService(testDb.db, () => new Date("2026-03-01T00:00:00.000Z"), { kind: "legacy" });
  } else {
    const [a] = await testDb.db.insert(document).values({ companyId: actor.companyId, url: "local://release-ownership", category: "Product", title: "Retry ownership" }).returning();
    const [b] = await testDb.db.insert(document).values({ companyId: actor.companyId, url: "local://onboarding", category: "Planning", title: "Onboarding reliability" }).returning();
    const [feedbackDoc] = await testDb.db.insert(document).values({ companyId: actor.companyId, url: "local://feedback", category: "Customer Feedback", title: "Customer Interviews" }).returning();
    const [unrelated] = await testDb.db.insert(document).values({ companyId: actor.companyId, url: "local://unrelated", category: "Product", title: "Unrelated" }).returning();
    const [foreign] = await testDb.db.insert(document).values({ companyId: BigInt(other!.id), url: "local://foreign", category: "Planning", title: "Foreign" }).returning();
    const [a1] = await testDb.db.insert(documentVersions).values({ documentId: BigInt(a!.id), versionNumber: 1, url: "local://a/v1", mimeType: "text/plain", changelog: "Initial ownership.", createdAt: new Date("2026-02-10T10:00:00.000Z") }).returning();
    const [a2] = await testDb.db.insert(documentVersions).values({ documentId: BigInt(a!.id), versionNumber: 2, url: "local://a/v2", mimeType: "text/plain", changelog: "Platform ownership was updated.", createdAt: new Date("2026-02-20T10:00:00.000Z") }).returning();
    const [a3] = await testDb.db.insert(documentVersions).values({ documentId: BigInt(a!.id), versionNumber: 3, url: "local://a/v3", mimeType: "text/plain", createdAt: new Date("2026-03-02T10:00:00.000Z") }).returning();
    const [b1] = await testDb.db.insert(documentVersions).values({ documentId: BigInt(b!.id), versionNumber: 1, url: "local://b/v1", mimeType: "text/plain", createdAt: new Date("2026-02-01T10:00:00.000Z") }).returning();
    const [b2] = await testDb.db.insert(documentVersions).values({ documentId: BigInt(b!.id), versionNumber: 2, url: "local://b/v2", mimeType: "text/plain", createdAt: new Date("2026-03-02T10:00:00.000Z") }).returning();
    const [feedbackVersion] = await testDb.db.insert(documentVersions).values({ documentId: BigInt(feedbackDoc!.id), versionNumber: 1, url: "local://feedback/v1", mimeType: "text/plain", createdAt: new Date("2026-02-22T12:00:00.000Z") }).returning();
    const [unrelatedVersion] = await testDb.db.insert(documentVersions).values({ documentId: BigInt(unrelated!.id), versionNumber: 1, url: "local://unrelated/v1", mimeType: "text/plain", createdAt: new Date("2026-03-02T10:00:00.000Z") }).returning();
    const [foreignVersion] = await testDb.db.insert(documentVersions).values({ documentId: BigInt(foreign!.id), versionNumber: 1, url: "local://foreign/v1", mimeType: "text/plain", createdAt: new Date("2026-03-02T10:00:00.000Z") }).returning();
    const [s1] = await testDb.db.insert(documentStructure).values({ documentId: BigInt(a!.id), versionId: BigInt(a1!.id), ordering: 1, title: "Retry ownership", path: "1" }).returning();
    const [s2] = await testDb.db.insert(documentStructure).values({ documentId: BigInt(a!.id), versionId: BigInt(a2!.id), ordering: 1, title: "Retry ownership", path: "1" }).returning();
    await testDb.db.update(document).set({ currentVersionId: BigInt(a3!.id) }).where(eq(document.id, a!.id));
    await testDb.db.update(document).set({ currentVersionId: BigInt(b2!.id) }).where(eq(document.id, b!.id));
    await testDb.db.update(document).set({ currentVersionId: BigInt(unrelatedVersion!.id) }).where(eq(document.id, unrelated!.id));
    await testDb.db.update(document).set({ currentVersionId: BigInt(foreignVersion!.id) }).where(eq(document.id, foreign!.id));
    const inserted = await testDb.db.insert(documentContextChunks).values([
      { documentId: BigInt(a!.id), versionId: BigInt(a1!.id), structureId: BigInt(s1!.id), content: texts.before, contentHash: "a".repeat(64), tokenCount: 4, charCount: texts.before.length, pageNumber: 1, lineStart: 1, lineEnd: 1 },
      { documentId: BigInt(a!.id), versionId: BigInt(a2!.id), structureId: BigInt(s2!.id), content: texts.after, contentHash: "b".repeat(64), tokenCount: 7, charCount: texts.after.length, pageNumber: 1, lineStart: 1, lineEnd: 1 },
      { documentId: BigInt(a!.id), versionId: BigInt(a3!.id), content: texts.v3, contentHash: "c".repeat(64), tokenCount: 4, charCount: texts.v3.length },
      { documentId: BigInt(b!.id), versionId: BigInt(b1!.id), content: texts.bHistorical, contentHash: "d".repeat(64), tokenCount: 4, charCount: texts.bHistorical.length, embedding: vectorSql(0) },
      { documentId: BigInt(b!.id), versionId: BigInt(b2!.id), content: "Onboarding reliability and retry monitoring are blocking enterprise expansion.", contentHash: "e".repeat(64), tokenCount: 8, charCount: 72, embedding: vectorSql(0) },
      { documentId: BigInt(b!.id), versionId: null, content: texts.nullVersion, contentHash: "f".repeat(64), tokenCount: 4, charCount: texts.nullVersion.length, embedding: vectorSql(0) },
      { documentId: BigInt(feedbackDoc!.id), versionId: BigInt(feedbackVersion!.id), content: "Enterprise buyers need reliable onboarding recovery before expansion.", contentHash: "1".repeat(64), tokenCount: 8, charCount: 67 },
      { documentId: BigInt(unrelated!.id), versionId: BigInt(unrelatedVersion!.id), content: texts.unrelated, contentHash: "2".repeat(64), tokenCount: 4, charCount: texts.unrelated.length },
      { documentId: BigInt(foreign!.id), versionId: BigInt(foreignVersion!.id), content: texts.foreign, contentHash: "3".repeat(64), tokenCount: 4, charCount: texts.foreign.length, embedding: vectorSql(0) },
    ]).returning();
    const bCurrentChunk = inserted.find((chunk) => chunk.documentId === BigInt(b!.id) && chunk.versionId === BigInt(b2!.id))!;
    computedIds = { a: BigInt(a!.id), a1: a1!.id, a2: a2!.id, a3: a3!.id, b: BigInt(b!.id), b2: BigInt(b2!.id), bCurrentChunk: bCurrentChunk.id };
    collector = new FounderWeeklyReviewEvidenceService(testDb.db, () => new Date("2026-03-03T00:00:00.000Z"), { kind: "computed", store: new FounderWeeklyReviewDocumentVersionStore(testDb.db) }, new StrictCurrentWorkspaceDocumentStore(testDb.db, { embedQuery: async () => vector(0) }));
  }

  const dispatchService = createFounderWeeklyReviewDispatchService(testDb.db);
  const created = await dispatchService.createRunWithDispatch({ actor, requestKey: `realistic-${mode}-${randomUUID()}`, reportingPeriod: fixture.reportingPeriod, collectionInput: { workspaceTimezone: fixture.workspaceTimezone, founderContext: mode === "computed" ? "Assess whether onboarding reliability and retry monitoring are blocking enterprise expansion." : fixture.founderContext, actorExternalUserId: actor.externalUserId } });
  if (created.run.evidenceSnapshot) throw new Error("Workflow run unexpectedly has an initial snapshot.");
  const worker = new FounderWeeklyReviewWorkerService(new FounderWeeklyReviewRepository(testDb.db)); const collectionContext = { companyId: actor.companyId, runId: created.run.id, collectionClaimId: created.dispatch.generationClaimId };
  const collecting = await worker.claimEvidenceCollection(collectionContext);
  const input = { companyId: actor.companyId, reportingPeriod: fixture.reportingPeriod, workspaceTimezone: fixture.workspaceTimezone, founderContext: mode === "computed" ? "Assess whether onboarding reliability and retry monitoring are blocking enterprise expansion." : fixture.founderContext, actor: { externalUserId: actor.externalUserId }, requestKey: created.run.requestKey };
  const snapshot = await collector.collectFounderWeeklyReviewEvidence(input); const repeated = await collector.collectFounderWeeklyReviewEvidence(input);
  if (JSON.stringify(snapshot.items) !== JSON.stringify(repeated.items) || JSON.stringify(snapshot.sourceWarnings) !== JSON.stringify(repeated.sourceWarnings)) throw new Error("Evidence collection was not deterministic.");
  const beforeDigest = digest(snapshot); const attached = await worker.attachEvidenceSnapshotIfAbsent(collectionContext, snapshot); const afterDigest = digest(attached.evidenceSnapshot);
  const checked = mode === "computed" ? assertComputedSnapshot(attached.evidenceSnapshot, computedIds!, texts) : { parsed: attached.evidenceSnapshot!, counts: Object.fromEntries(["document_change", "customer_feedback", "founder_context"].map((type) => [type, attached.evidenceSnapshot!.items.filter((item) => item.sourceType === type).length])) };
  if (attached.status !== "queued" || beforeDigest !== afterDigest || !checked.counts.document_change || !checked.counts.customer_feedback || checked.counts.founder_context !== 1) throw new Error("Realistic collector assertions failed.");
  const generationContext = { companyId: actor.companyId, runId: attached.id, generationJobId: created.dispatch.generationJobId, generationClaimId: created.dispatch.generationClaimId }; const generating = await worker.claimQueuedRun(generationContext); if (!generating.evidenceSnapshot) throw new Error("Generation began without snapshot.");
  let generationCalls = 0;
  const generated = await generateFounderWeeklyReview({ evidenceSnapshot: generating.evidenceSnapshot, generate: async (request) => { generationCalls++; return generateFounderWeeklyReviewStructured(request); } });
  validateFounderWeeklyReviewV2Citations(generated.reviewPayload as never, generating.evidenceSnapshot);
  const saved = await worker.saveGeneratedDraft(generationContext, generated.reviewPayload, generated.modelMetadata); const readBack = await new FounderWeeklyReviewRepository(testDb.db).getByCompanyAndRunId(actor.companyId, saved.id); if (!readBack?.reviewPayload || readBack.status !== "draft" || !readBack.evidenceSnapshot || digest(readBack.evidenceSnapshot) !== beforeDigest) throw new Error("Validated draft read-back or snapshot immutability failed.");
  if (mode === "computed") assertComputedReport(readBack.reviewPayload, readBack.evidenceSnapshot);
  const rendered = renderFounderWeeklyReviewMarkdown(readBack);
  const dispatchRows = await testDb.db.select().from(founderWeeklyReviewDispatches).where(eq(founderWeeklyReviewDispatches.runId, saved.id)); const runRows = await testDb.db.select().from(founderWeeklyReviewRuns).where(eq(founderWeeklyReviewRuns.id, saved.id));
  let artifactPaths: ArtifactPaths | null = null;
  if (process.env.SYNTHETIC_FWR_EXPORT_REPORT === "1") { const exportRoot = founderWeeklyReviewRealisticExportRoot(mode, process.env.SYNTHETIC_FWR_EXPORT_DIR); const directory = resolve(process.cwd(), exportRoot, saved.id); await mkdir(directory, { recursive: true }); artifactPaths = { evidence: resolve(directory, "evidence.json"), report: resolve(directory, "report.json"), markdown: resolve(directory, "report.md"), summary: resolve(directory, "run-summary.json") }; await writeAtomic(artifactPaths.evidence, JSON.stringify(readBack.evidenceSnapshot, null, 2)); await writeAtomic(artifactPaths.report, JSON.stringify({ runId: readBack.id, status: readBack.status, provider: readBack.modelMetadata?.provider, model: readBack.modelMetadata?.model, reportingPeriod: readBack.reportingPeriod, review: readBack.reviewPayload }, null, 2)); await writeAtomic(artifactPaths.markdown, rendered); await writeAtomic(artifactPaths.summary, JSON.stringify({ runId: saved.id, scenario: "realistic-company", mode, provider: generated.modelMetadata.provider, model: generated.modelMetadata.model, lifecycle: [created.run.status, collecting.status, attached.status, generating.status, saved.status], evidenceCounts: checked.counts, warningCodes: readBack.evidenceSnapshot.sourceWarnings.map((warning) => warning.code), repairCount: generationCalls - 1, retryCount: saved.retryCount, validation: { canonicalSchema: true, citations: true, sourceSemantics: true }, snapshotDigestBefore: beforeDigest, snapshotDigestAfter: digest(readBack.evidenceSnapshot), artifactPaths }, null, 2)); }
  if (process.env.FWR_PRINT_REPORT === "1") { console.log("===== FOUNDER WEEKLY REVIEW ====="); console.log(rendered); console.log("===== END FOUNDER WEEKLY REVIEW ====="); }
  console.log(JSON.stringify({ runId: saved.id, mode, lifecycle: [created.run.status, collecting.status, attached.status, generating.status, saved.status], evidenceCounts: checked.counts, warningCodes: readBack.evidenceSnapshot.sourceWarnings.map((warning) => warning.code), snapshotDigestUnchanged: beforeDigest === digest(readBack.evidenceSnapshot), validation: { canonicalSchema: true, citations: true, sourceSemantics: true }, provider: generated.modelMetadata.provider, model: generated.modelMetadata.model, repairCount: generationCalls - 1, dispatchCount: dispatchRows.length, runRowCount: runRows.length, artifactPaths }));
} finally { await testDb.close(); }
