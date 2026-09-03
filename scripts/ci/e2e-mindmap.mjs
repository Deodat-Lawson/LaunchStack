/**
 * End-to-end: a mindmap becomes a citable source, and stays one.
 *
 * Drives the same path the publish route takes against a running Compose
 * stack (ADR-003 outbox → worker → extract → index), then asks the questions
 * a person would ask and checks the answer cites the map:
 *
 *   mindmap row → outline (what the route renders) → document lifecycle with
 *   the `kind: "mindmap"` marker → worker indexes it → company-scope
 *   ensemble search (BM25 + vector, real embeddings) finds the map's chunk
 *   for label and question queries → the citation quotes the node label
 *   → the marker survived OCR completion (the viewer renders it as a map)
 *   → the map is edited and re-published as a *version* of the same document
 *   → search reflects the new content under the same document id, and the
 *     old wording no longer surfaces.
 *
 * Run AFTER `docker compose ... up` with the worker healthy and a document
 * stub serving /doc (scripts/ci/fake-embeddings-server.mjs does):
 *
 *   node scripts/ci/fake-embeddings-server.mjs 8099 &
 *   DATABASE_URL=postgresql://postgres:password@localhost:5433/pdr_ai_v2 \
 *   E2E_DOC_BASE=http://host.docker.internal:8099 \
 *     pnpm exec tsx scripts/ci/e2e-mindmap.mjs
 *
 * Embeddings for the query side come from EMBEDDING_API_KEY / OPENAI_API_KEY
 * (apps/web/.env is read when the variables are not set). Without a key the
 * query side falls back to BM25 only and says so.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

// apps/web/.env stands in for the shell when running by hand.
{
  const file = join(repoRoot, "apps", "web", ".env");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!match) continue;
      const [, key, raw] = match;
      if (process.env[key]) continue;
      const value = raw.trim().replace(/^["'](.*)["']$/, "$1");
      if (value) process.env[key] = value;
    }
  }
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 240_000);
const DOC_BASE = process.env.E2E_DOC_BASE ?? "http://localhost:8099";
const EMBEDDING_KEY = process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || "";

const { createDb, configureDatabase } = await import("../../packages/store/src/db/index.ts");
const { createDocumentLifecycle, createDocumentVersionLifecycle } = await import(
  "../../packages/orchestration/src/source-lifecycle/lifecycle.ts"
);
const { companyEnsembleSearch } = await import(
  "../../packages/retrieval/src/algorithms/ensemble/ensemble.ts"
);
const { createCompanyBM25Retriever } = await import(
  "../../packages/retrieval/src/algorithms/bm25/bm25.ts"
);
const { buildCitations } = await import(
  "../../packages/retrieval/src/tools/citation-builder/citation-builder.ts"
);
const { configureCompanyEmbeddingDefaults, configureEmbeddingIndexRegistry } = await import(
  "../../packages/llm/src/embeddings/index.ts"
);
const { toMarkdownOutline, parseDoc } = await import(
  "../../apps/web/src/app/employer/documents/_mindmap/model/serialize.ts"
);
const { createDoc, createEdge, createNode, createPage } = await import(
  "../../apps/web/src/app/employer/documents/_mindmap/model/factory.ts"
);
const { mindmapDocumentMarker, mindmapIdOf } = await import(
  "../../apps/web/src/lib/mindmap-document.ts"
);

const handle = createDb({ url: DATABASE_URL });
configureDatabase(handle.db);
const sql = handle.client;

if (EMBEDDING_KEY) {
  configureEmbeddingIndexRegistry({ defaultIndexKey: process.env.EMBEDDING_INDEX });
  configureCompanyEmbeddingDefaults({
    embeddingIndexKey: process.env.EMBEDDING_INDEX,
    openAIApiKey: EMBEDDING_KEY,
    openAIBaseUrl: process.env.EMBEDDING_API_BASE_URL || "https://api.openai.com/v1",
  });
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}
function ok(msg) {
  console.log(`✓ ${msg}`);
}
// Register each body with the stub and hand the pipeline a short URL: the
// document table's url column is varchar(256), and an outline is longer than
// that even before base64. The stub is reached at DOC_BASE from the worker
// and at DOC_STUB_LOCAL from here.
const DOC_STUB_LOCAL = process.env.E2E_DOC_STUB_LOCAL ?? "http://localhost:8099";
async function doc(text, contentType = "text/plain; charset=utf-8") {
  const res = await fetch(`${DOC_STUB_LOCAL}/docs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, contentType }),
  });
  if (!res.ok) fail(`document stub refused a registration: ${res.status}`);
  const { path } = await res.json();
  return `${DOC_BASE}${path}`;
}

async function waitFor(label, predicate) {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) fail(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** A mind-shaped document from a nested label tree, the way the editor would build it. */
function treeDoc(title, tree) {
  const page = createPage("Page 1");
  const nodes = [];
  const edges = page.edges;
  let y = 0;
  const walk = (label, children, depth, parent) => {
    const node = createNode({
      shape: depth === 0 ? "mind-root" : "mind-branch",
      x: depth * 260,
      y: (y += 70),
      w: 200,
      h: 56,
      text: label,
    });
    nodes.push(node);
    if (parent) {
      edges.push(
        createEdge({
          from: { nodeId: parent.id, port: "e" },
          to: { nodeId: node.id, port: "w" },
        }),
      );
    }
    for (const [child, grandchildren] of Object.entries(children ?? {})) {
      walk(child, grandchildren, depth + 1, node);
    }
  };
  for (const [root, children] of Object.entries(tree)) walk(root, children, 0);
  return createDoc(title, [{ ...page, nodes, edges }]);
}

const STAMP = Date.now().toString(36);
const TITLE = `Q3 launch plan ${STAMP}`;
const V1 = treeDoc(TITLE, {
  [TITLE]: {
    Infrastructure: {
      "Postgres 16 with read replicas": null,
      "Redis for session cache": null,
      "Blue-green deploys on Kubernetes": null,
    },
    Billing: {
      "Stripe subscriptions": null,
      "Usage metering per workspace": null,
    },
    Risks: {
      "SOC 2 audit slips": null,
      [`Hiring a second SRE by October ${STAMP}`]: null,
    },
  },
});

async function createCompany(name) {
  const rows = await sql`
    INSERT INTO pdr_ai_v2_company (name, "numberOfEmployees")
    VALUES (${name}, '1') RETURNING id
  `;
  return Number(rows[0].id);
}

async function createMindmapRow(companyId, document, revision) {
  const rows = await sql`
    INSERT INTO pdr_ai_v2_mindmaps
      (company_id, created_by_user_id, title, folder, doc, doc_version, revision, node_count, edge_count, search_text)
    VALUES
      (${companyId}, 'e2e-user', ${document.title}, 'Strategy', ${JSON.stringify(document)}::jsonb, 1,
       ${revision}, ${document.pages[0].nodes.length}, ${document.pages[0].edges.length},
       ${document.pages[0].nodes.map((n) => n.text).join(" · ")})
    RETURNING id
  `;
  return Number(rows[0].id);
}

async function waitIndexed(companyId, documentId, versionId, jobId) {
  await waitFor(`document ${documentId} v${versionId} indexed (job ${jobId})`, async () => {
    const job = await sql`SELECT status FROM pdr_ai_v2_ocr_jobs WHERE id = ${jobId}`;
    if (job[0]?.status === "failed") fail(`job ${jobId} failed`);
    if (job[0]?.status !== "completed") return false;
    const rows = await sql`
      SELECT 1 FROM pdr_ai_v2_document_context_chunks
      WHERE document_id = ${documentId} AND version_id = ${versionId}
      LIMIT 1
    `;
    return rows.length > 0;
  });
  const current = await sql`
    SELECT current_version_id FROM pdr_ai_v2_document WHERE id = ${documentId}
  `;
  if (Number(current[0]?.current_version_id) !== versionId) {
    fail(`document ${documentId} current_version_id is ${current[0]?.current_version_id}, expected ${versionId}`);
  }
}

/** Company-scope search the way the workspace asks: ensemble when embeddings are configured. */
async function search(companyId, query) {
  if (EMBEDDING_KEY) {
    return companyEnsembleSearch(query, { companyId, topK: 5 });
  }
  const retriever = await createCompanyBM25Retriever(companyId, 5);
  const hits = await retriever.invoke(query);
  return hits.map((h) => ({ pageContent: h.pageContent, metadata: h.metadata }));
}

try {
  const companyId = await createCompany(`mindmap-e2e-${STAMP}`);
  const decoyCompany = await createCompany(`mindmap-e2e-decoy-${STAMP}`);
  ok(`companies created (map=${companyId}, decoy=${decoyCompany})`);

  // ── The map, and a prose decoy in the same workspace that shares its words ──
  const mindmapId = await createMindmapRow(companyId, V1, 1);
  ok(`mindmap row ${mindmapId} created (revision 1)`);

  const decoy = await createDocumentLifecycle({
    companyId: BigInt(companyId),
    userId: "e2e-user",
    title: "Engineering handbook",
    category: "General",
    url: await doc(
      "We deploy on Kubernetes with blue-green rollouts and keep Postgres as the system of record. " +
        "Redis fronts the session store. Interviews follow a structured loop. The platform team " +
        "renews certificates and reviews alert routing every quarter.",
    ),
    creationKey: `mindmap-e2e:${companyId}:decoy`,
    mimeType: "text/plain",
    traceId: "e2e-mindmap-decoy",
    processing: { originalFilename: "handbook.txt" },
  });

  // ── Publish, exactly as the route does: server-rendered outline, marker, stable key ──
  const outline1 = toMarkdownOutline(parseDoc(V1, TITLE), { sections: true });
  const marker1 = mindmapDocumentMarker({ mindmapId, revision: 1 });
  const published = await createDocumentLifecycle({
    companyId: BigInt(companyId),
    userId: "e2e-user",
    title: TITLE,
    category: "Strategy",
    url: await doc(outline1, "text/markdown; charset=utf-8"),
    creationKey: `mindmap:${mindmapId}`,
    mimeType: "text/markdown",
    ocrEnabled: true,
    ocrProcessed: false,
    ocrMetadata: { ...marker1 },
    traceId: "e2e-mindmap-publish",
    processing: { originalFilename: `${TITLE}.md` },
  });
  ok(`published as document ${published.documentId} v${published.versionId} (job ${published.jobId})`);

  await waitIndexed(companyId, decoy.documentId, decoy.versionId, decoy.jobId);
  await waitIndexed(companyId, published.documentId, published.versionId, published.jobId);
  ok("worker indexed the map and the decoy");

  // ── The marker survived OCR completion ──
  const row = await sql`SELECT ocr_metadata FROM pdr_ai_v2_document WHERE id = ${published.documentId}`;
  const meta = row[0]?.ocr_metadata;
  if (mindmapIdOf(meta) !== mindmapId) {
    fail(`ocr_metadata lost the mindmap marker after indexing: ${JSON.stringify(meta)}`);
  }
  if (typeof meta.totalChunks !== "number") {
    fail(`ocr_metadata did not gain the processor's keys: ${JSON.stringify(meta)}`);
  }
  ok(`document row still says kind=mindmap (mindmapId ${mindmapIdOf(meta)}) beside the processor's keys`);

  // ── Chunks carry the branch, not just the map ──
  const chunkRows = await sql`
    SELECT content FROM pdr_ai_v2_document_context_chunks
    WHERE document_id = ${published.documentId} AND version_id = ${published.versionId}
  `;
  const joined = chunkRows.map((r) => r.content).join("\n");
  for (const label of ["Postgres 16 with read replicas", "Stripe subscriptions", "SOC 2 audit slips"]) {
    if (!joined.includes(label)) fail(`indexed chunks do not contain "${label}"`);
  }
  ok(`${chunkRows.length} chunk(s) hold every node label`);

  // ── Questions a person would ask, answered by the map ──
  const queries = [
    { q: "Postgres 16 with read replicas", label: "Postgres 16 with read replicas" },
    { q: "What database does the Q3 launch plan use?", label: "Postgres" },
    { q: "How is billing handled in the launch plan?", label: "Stripe" },
    { q: "What are the risks for the launch?", label: "SOC 2" },
  ];
  console.log(`  query side: ${EMBEDDING_KEY ? "BM25 + vector ensemble (real embeddings)" : "BM25 only (no embeddings key)"}`);
  // A map is several chunks once it has sections. What the product needs is
  // that the *map* is the top document and the chunk holding the answer is
  // among the results; which of the map's own chunks the fused ranking puts
  // first is reported, not asserted — BM25 ties between sibling chunks that
  // all name the map let RRF reorder them by a hair.
  let firsts = 0;
  let exactFirsts = 0;
  for (const { q, label } of queries) {
    const hits = await search(companyId, q);
    if (hits.length === 0) fail(`"${q}" returned nothing`);
    const topDoc = Number(hits[0].metadata?.documentId);
    const mapHits = hits.filter((h) => Number(h.metadata?.documentId) === published.documentId);
    if (mapHits.length === 0) fail(`"${q}": the map is not in the top ${hits.length}`);
    const answering = mapHits.find((h) => h.pageContent.includes(label));
    if (!answering) {
      fail(`"${q}": none of the map's ${mapHits.length} hit(s) contain "${label}"`);
    }
    const first = topDoc === published.documentId;
    const exact = hits[0] === answering;
    if (first) firsts += 1;
    if (exact) exactFirsts += 1;
    console.log(
      `  ${first ? "1st" : "not 1st"}  "${q}" → doc ${topDoc}; answering chunk at rank ${hits.indexOf(answering) + 1}`,
    );
  }
  if (firsts < queries.length - 1) fail(`the map came first for only ${firsts}/${queries.length} queries`);
  ok(`the map came first for ${firsts}/${queries.length} queries; the answering chunk was first for ${exactFirsts}/${queries.length}`);

  // ── Citation quotes the node label and anchors on the map's version ──
  const hits = await search(companyId, "Postgres 16 with read replicas");
  const citations = buildCitations(
    hits.map((h) => ({
      sourceId: Number(h.metadata.documentId),
      sourceVersionId: Number(h.metadata.versionId ?? published.versionId),
      chunkId: Number(h.metadata.chunkId ?? h.metadata.parentChunkId ?? 0) || undefined,
      page: Number(h.metadata.page ?? h.metadata.pageNumber) || 1,
      content: h.pageContent,
      documentTitle: h.metadata.documentTitle,
    })),
    [{ sourceVersionId: published.versionId, createdAt: new Date().toISOString() }],
    { now: new Date().toISOString() },
  );
  const cited = citations.find((c) => c.quote.includes("Postgres 16 with read replicas"));
  if (!cited) fail("no citation quotes the node label");
  if (!cited.anchorKey.startsWith(`src:${published.documentId}/ver:${published.versionId}/`)) {
    fail(`citation anchor "${cited.anchorKey}" does not reference the map's version`);
  }
  ok(`citation anchored at ${cited.anchorKey}`);

  // ── Re-publish after an edit: a version of the same document ──
  const V2 = treeDoc(TITLE, {
    [TITLE]: {
      Infrastructure: {
        "CockroachDB with regional replicas": null,
        "Redis for session cache": null,
      },
      Billing: { "Stripe subscriptions": null, "Annual prepay discount": null },
      Risks: { "SOC 2 audit slips": null },
    },
  });
  await sql`
    UPDATE pdr_ai_v2_mindmaps SET doc = ${JSON.stringify(V2)}::jsonb, revision = 2 WHERE id = ${mindmapId}
  `;
  const outline2 = toMarkdownOutline(parseDoc(V2, TITLE), { sections: true });
  const version = await createDocumentVersionLifecycle({
    documentId: published.documentId,
    companyId: BigInt(companyId),
    userId: "e2e-user",
    title: TITLE,
    category: "Strategy",
    url: await doc(outline2, "text/markdown; charset=utf-8"),
    creationKey: `mindmap:${mindmapId}:r2`,
    mimeType: "text/markdown",
    changelog: "Published revision 2",
    originalFilename: `${TITLE}.md`,
  });
  if (version.document.id !== published.documentId) {
    fail(`re-publish created document ${version.document.id}, expected ${published.documentId}`);
  }
  ok(`re-published as v${version.version.versionNumber} of document ${published.documentId}`);
  await waitIndexed(companyId, published.documentId, version.versionId, version.jobId);

  const docCount = await sql`
    SELECT count(*)::int AS n FROM pdr_ai_v2_document WHERE company_id = ${companyId} AND title = ${TITLE}
  `;
  if (docCount[0].n !== 1) fail(`expected one document for the map, found ${docCount[0].n}`);
  ok("still exactly one document for the map");

  const after = await search(companyId, "Which database does the launch plan use now?");
  const afterMap = after.find((h) => Number(h.metadata?.documentId) === published.documentId);
  if (!afterMap) fail("after re-publish the map is not retrieved");
  if (!afterMap.pageContent.includes("CockroachDB")) {
    fail(`after re-publish the map's hit is stale: ${afterMap.pageContent.slice(0, 120)}`);
  }
  if (after.some((h) => h.pageContent.includes("Postgres 16 with read replicas"))) {
    fail("the old revision's wording still surfaces after re-publish");
  }
  ok("search reflects the new revision under the same document, old wording gone");

  // ── Scoping: the other company sees nothing of it ──
  const other = await search(decoyCompany, "Postgres 16 with read replicas").catch(() => []);
  if (other.some((h) => Number(h.metadata?.documentId) === published.documentId)) {
    fail("cross-company leak: another company retrieved the map");
  }
  ok("the map is invisible to another company");

  console.log("\nMindmap end-to-end passed.");
} finally {
  await handle.close().catch(() => {});
}
