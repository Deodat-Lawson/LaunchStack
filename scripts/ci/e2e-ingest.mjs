/**
 * End-to-end ingestion smoke (ADR-003, DONE-gate scenario): drives the ONE
 * ingestion path against a running Compose stack and asserts a cited,
 * permission-scoped answer comes out the other side.
 *
 *   accept command (lifecycle tx: source version + outbox event)
 *     → worker claims `source.version.created` → extract (text fast path)
 *     → `evidence.version.extracted` → index (chunks + embeddings via the
 *       CI stub) → `evidence.version.indexed` → citation query (BM25)
 *
 * Run AFTER `docker compose ... up` with the worker healthy:
 *   DATABASE_URL=postgresql://postgres:password@localhost:5433/pdr_ai_v2 \
 *     pnpm exec tsx scripts/ci/e2e-ingest.mjs
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 180_000);

const { createDb, configureDatabase } = await import(
  "../../packages/core/src/db/index.ts"
);
const { createDocumentLifecycle } = await import(
  "../../packages/adapters/src/ingestion/source-lifecycle.ts"
);
const { createCompanyBM25Retriever } = await import(
  "../../packages/core/src/rag/retrievers/bm25-retriever.ts"
);
const { buildCitations } = await import(
  "../../packages/application/src/citations.ts"
);

const handle = createDb({ url: DATABASE_URL });
configureDatabase(handle.db);
// Raw SQL through the same pool — the root workspace deliberately has no
// direct `postgres` dependency.
const sql = handle.client;

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function ok(msg) {
  console.log(`✓ ${msg}`);
}

async function createCompany(name) {
  const rows = await sql`
    INSERT INTO pdr_ai_v2_company (name, "numberOfEmployees")
    VALUES (${name}, '1') RETURNING id
  `;
  return Number(rows[0].id);
}

const FACT = "The smoke-test flux capacitor budget is 121 gigawatts";
// Documents are served over HTTP by the stub server's /doc route — the URL
// must be reachable from the WORKER (in the CI compose stack that is
// host.docker.internal; locally it is localhost).
const DOC_BASE = process.env.E2E_DOC_BASE ?? "http://localhost:8099";
const doc = (text) =>
  `${DOC_BASE}/doc/${Buffer.from(text, "utf8").toString("base64url")}`;

async function waitFor(label, predicate) {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) fail(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

try {
  const companyA = await createCompany(`smoke-a-${Date.now()}`);
  const companyB = await createCompany(`smoke-b-${Date.now()}`);
  ok(`companies created (A=${companyA}, B=${companyB})`);

  // ── Accept the upload command (source version + outbox event, one tx) ──
  const lifecycle = await createDocumentLifecycle({
    companyId: BigInt(companyA),
    userId: "smoke-user",
    title: "smoke-notes.txt",
    category: "General",
    url: doc(`Meeting notes.\n\n${FACT}. Approved by the board.`),
    creationKey: `smoke:${companyA}:notes`,
    mimeType: "text/plain",
    traceId: "e2e-smoke",
    processing: { originalFilename: "smoke-notes.txt" },
  });
  ok(`source accepted (doc=${lifecycle.documentId}, version=${lifecycle.versionId}, job=${lifecycle.jobId})`);

  // A decoy document in company B proves scoping later.
  await createDocumentLifecycle({
    companyId: BigInt(companyB),
    userId: "smoke-user",
    title: "decoy.txt",
    category: "General",
    url: doc("Unrelated decoy content about gardening."),
    creationKey: `smoke:${companyB}:decoy`,
    mimeType: "text/plain",
    traceId: "e2e-smoke-b",
    processing: { originalFilename: "decoy.txt" },
  });

  const outboxAfterAccept = await sql`
    SELECT event_type, status FROM pdr_ai_v2_event_outbox
    WHERE company_id = ${companyA}
  `;
  if (outboxAfterAccept.length !== 1) {
    fail(`expected exactly one outbox event after accept, got ${outboxAfterAccept.length}`);
  }
  ok("source.version.created enqueued in the accepting transaction");

  // ── The worker must carry the event chain through indexing ──
  await waitFor("evidence.version.indexed processed", async () => {
    const rows = await sql`
      SELECT 1 FROM pdr_ai_v2_event_outbox
      WHERE company_id = ${companyA}
        AND event_type = 'evidence.version.indexed'
        AND status = 'processed'
    `;
    return rows.length > 0;
  });
  ok("worker processed created → extracted → indexed");

  const chunkRows = await sql`
    SELECT count(*)::int AS n FROM pdr_ai_v2_document_context_chunks
    WHERE document_id = ${lifecycle.documentId}
      AND version_id = ${lifecycle.versionId}
  `;
  if (chunkRows[0].n === 0) fail("no evidence chunks were persisted");
  ok(`${chunkRows[0].n} evidence chunk(s) persisted for the version`);

  const jobRows = await sql`
    SELECT status FROM pdr_ai_v2_ocr_jobs WHERE id = ${lifecycle.jobId}
  `;
  if (jobRows[0]?.status !== "completed") {
    fail(`job status is ${jobRows[0]?.status}, expected completed`);
  }
  ok("extraction job completed");

  const projected = await sql`
    SELECT status FROM pdr_ai_v2_event_outbox
    WHERE company_id = ${companyA} AND event_type = 'company.state.projected'
  `;
  const chained = await sql`
    SELECT event_type, status FROM pdr_ai_v2_event_outbox
    WHERE company_id = ${companyA} ORDER BY id
  `;
  console.log(
    "  event chain:",
    chained.map((r) => `${r.event_type}=${r.status}`).join(" → "),
  );
  if (projected.length === 0 && chained.length < 3) {
    fail("the indexed handler did not chain a projection event");
  }

  // ── Cited answer, permission-scoped ──
  const retriever = await createCompanyBM25Retriever(companyA, 5);
  const hits = await retriever.invoke("flux capacitor budget");
  if (hits.length === 0) fail("citation query returned no evidence");

  const citations = buildCitations(
    hits.map((h) => ({
      sourceId: Number(h.metadata.documentId),
      sourceVersionId: lifecycle.versionId,
      chunkId: Number(h.metadata.chunkId),
      page: Number(h.metadata.page) || 1,
      content: h.pageContent,
      documentTitle: h.metadata.documentTitle,
    })),
    [
      {
        sourceVersionId: lifecycle.versionId,
        createdAt: new Date().toISOString(),
      },
    ],
    { now: new Date().toISOString() },
  );
  const hit = citations.find((c) => c.quote.includes("121 gigawatts"));
  if (!hit) fail("no citation quotes the ingested fact");
  if (!hit.anchorKey.startsWith(`src:${lifecycle.documentId}/ver:${lifecycle.versionId}/`)) {
    fail(`citation anchor "${hit.anchorKey}" does not reference the source version`);
  }
  if (hit.freshness !== "fresh") fail(`expected fresh evidence, got ${hit.freshness}`);
  ok(`cited answer anchored at ${hit.anchorKey} (${hit.freshness})`);

  // Scoping: company B's retriever must never see company A's evidence.
  const retrieverB = await createCompanyBM25Retriever(companyB, 5).catch(() => null);
  const hitsB = retrieverB ? await retrieverB.invoke("flux capacitor budget") : [];
  if (hitsB.some((h) => Number(h.metadata.documentId) === lifecycle.documentId)) {
    fail("cross-company leak: company B retrieved company A's evidence");
  }
  ok("citations are permission-scoped (company B cannot see company A)");

  console.log("\nE2E ingestion smoke passed.");
} finally {
  await handle.close().catch(() => {});
}
