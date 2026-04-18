/**
 * Integration boundary tests for the GraphRAG ingestion pipeline.
 * Tests gating logic and data flow across Steps F, F2, and G.
 *
 * Uses the real pipeline functions exported via __test__ from index.ts.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Mock neo4j-direct-writer-impl ───────────────────────────────────────────

const mockEnsureIndexes = jest.fn().mockResolvedValue(undefined);
const mockWriteEntities = jest.fn().mockResolvedValue(0);
const mockWriteRelationships = jest.fn().mockResolvedValue([]);
const mockWriteMentions = jest.fn().mockResolvedValue(0);
const mockWriteDocumentGraph = jest.fn().mockResolvedValue(undefined);
const mockResolveEntities = jest.fn().mockResolvedValue(undefined);

jest.mock("~/lib/graph/neo4j-direct-writer-impl", () => ({
  Neo4jDirectWriterImpl: jest.fn().mockImplementation(() => ({
    ensureIndexes: mockEnsureIndexes,
    writeEntities: mockWriteEntities,
    writeRelationships: mockWriteRelationships,
    writeMentions: mockWriteMentions,
    writeDocumentGraph: mockWriteDocumentGraph,
    deleteDocumentGraph: jest.fn().mockResolvedValue({}),
  })),
  resolveEntities: mockResolveEntities,
}));

// ─── Mock neo4j-client ───────────────────────────────────────────────────────

const mockIsNeo4jConfigured = jest.fn().mockReturnValue(true);
const mockCheckNeo4jHealth = jest.fn().mockResolvedValue(true);

jest.mock("~/lib/graph/neo4j-client", () => ({
  isNeo4jConfigured: mockIsNeo4jConfigured,
  checkNeo4jHealth: mockCheckNeo4jHealth,
}));

// ─── Mock DB (ocrJobs pipeline state) ────────────────────────────────────────

const pipelineStore: Record<string, Record<string, unknown>> = {};

jest.mock("~/server/db", () => ({
  db: {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockImplementation(async () => {
          return [{ ocrResult: pipelineStore["job1"] ?? null }];
        }),
      }),
    }),
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockImplementation((data: any) => {
        // Capture pipeline state writes
        if (data?.ocrResult) {
          pipelineStore["job1"] = { ...(pipelineStore["job1"] ?? {}), ...data.ocrResult };
        }
        return { where: jest.fn().mockResolvedValue([]) };
      }),
    }),
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SIDECAR_URL = "http://localhost:8000";
const JOB_ID = "job1";
const DOCUMENT_ID = 42;
const DOCUMENT_NAME = "test.pdf";
const COMPANY_ID = "company-123";

const STORED_SECTIONS = [
  { sectionId: 1, content: "Satya Nadella is the CEO of Microsoft." },
  { sectionId: 2, content: "Apple was founded by Steve Jobs." },
];

const ENHANCED_ENTITIES_RESPONSE = {
  results: [
    {
      text: "Satya Nadella is the CEO of Microsoft.",
      entities: [
        { text: "Satya Nadella", label: "PER", score: 0.99, embedding: new Array(768).fill(0.1) },
        { text: "Microsoft", label: "ORG", score: 0.98, embedding: new Array(768).fill(0.2) },
      ],
    },
    {
      text: "Apple was founded by Steve Jobs.",
      entities: [
        { text: "Apple", label: "ORG", score: 0.97, embedding: new Array(768).fill(0.3) },
        { text: "Steve Jobs", label: "PER", score: 0.96, embedding: new Array(768).fill(0.4) },
      ],
    },
  ],
  total_entities: 4,
};

// Response with an entity that appears in both chunks (for dedup testing)
const ENTITIES_WITH_DUPLICATE = {
  results: [
    {
      text: "Microsoft CEO Satya Nadella",
      entities: [
        { text: "Microsoft", label: "ORG", score: 0.98, embedding: new Array(768).fill(0.2) },
        { text: "Satya Nadella", label: "PER", score: 0.99, embedding: new Array(768).fill(0.1) },
      ],
    },
    {
      text: "Microsoft was founded in 1975.",
      entities: [
        { text: "Microsoft", label: "ORG", score: 0.95, embedding: new Array(768).fill(0.25) },
      ],
    },
  ],
  total_entities: 3,
};

const RELATIONSHIPS_RESPONSE = {
  results: [
    {
      text: "Satya Nadella is the CEO of Microsoft.",
      entities: [
        { name: "Satya Nadella", type: "PERSON" as const },
        { name: "Microsoft", type: "ORGANIZATION" as const },
      ],
      relationships: [
        { source: "Satya Nadella", target: "Microsoft", type: "CEO_OF", detail: "is the CEO of" },
      ],
      dropped_relationships: [],
    },
  ],
  total_entities: 2,
  total_relationships: 1,
  total_dropped: 0,
};

const noopRunStep = async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn();

// ─── Import real pipeline functions ──────────────────────────────────────────

import { __test__ } from "~/lib/tools/doc-ingestion/index";
const { maybeExtractEntities, maybeExtractRelationships, maybeSyncToNeo4j } = __test__;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Integration: Ingestion Pipeline GraphRAG Steps", () => {
  let originalEnv: Record<string, string | undefined>;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    originalEnv = {
      NEO4J_URI: process.env.NEO4J_URI,
      SIDECAR_URL: process.env.SIDECAR_URL,
      EXTRACTION_LLM_BASE_URL: process.env.EXTRACTION_LLM_BASE_URL,
    };

    jest.clearAllMocks();
    pipelineStore["job1"] = {};

    fetchMock = jest.spyOn(global, "fetch").mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
        }
        if (url.includes("/extract-entities")) {
          return new Response(JSON.stringify(ENHANCED_ENTITIES_RESPONSE), { status: 200 });
        }
        if (url.includes("/extract-relationships")) {
          return new Response(JSON.stringify(RELATIONSHIPS_RESPONSE), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      },
    );
  });

  afterEach(() => {
    process.env.NEO4J_URI = originalEnv.NEO4J_URI;
    process.env.SIDECAR_URL = originalEnv.SIDECAR_URL;
    process.env.EXTRACTION_LLM_BASE_URL = originalEnv.EXTRACTION_LLM_BASE_URL;
    jest.restoreAllMocks();
  });

  // ── Step F: Entity Extraction ──────────────────────────────────────────────

  it("Step F calls /extract-entities?include_embeddings=true when NEO4J_URI is set", async () => {
    process.env.NEO4J_URI = "bolt://localhost:7687";

    await maybeExtractEntities(JOB_ID, SIDECAR_URL, STORED_SECTIONS, DOCUMENT_ID, COMPANY_ID, noopRunStep);

    const entityCall = fetchMock.mock.calls.find(([url]) =>
      url.toString().includes("/extract-entities"),
    );
    expect(entityCall).toBeDefined();
    expect(entityCall![0].toString()).toContain("include_embeddings=true");
  });

  it("Step F does NOT run when NEO4J_URI is not set", async () => {
    delete process.env.NEO4J_URI;

    await maybeExtractEntities(JOB_ID, SIDECAR_URL, STORED_SECTIONS, DOCUMENT_ID, COMPANY_ID, noopRunStep);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Step F transforms entities with lowercase name and original displayName", async () => {
    process.env.NEO4J_URI = "bolt://localhost:7687";

    await maybeExtractEntities(JOB_ID, SIDECAR_URL, STORED_SECTIONS, DOCUMENT_ID, COMPANY_ID, noopRunStep);

    const entities = pipelineStore["job1"]?.graphrag_entities as any[];
    expect(entities).toBeDefined();
    expect(entities.length).toBe(4);
    expect(entities[0].name).toBe("satya nadella");
    expect(entities[0].displayName).toBe("Satya Nadella");
    expect(entities[0].label).toBe("PER");
    expect(entities[0].embedding).toHaveLength(768);
  });

  it("Step F deduplicates entities across chunks and accumulates mentionCount", async () => {
    process.env.NEO4J_URI = "bolt://localhost:7687";

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith("/health")) return new Response("{}", { status: 200 });
      if (url.includes("/extract-entities")) {
        return new Response(JSON.stringify(ENTITIES_WITH_DUPLICATE), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });

    await maybeExtractEntities(JOB_ID, SIDECAR_URL, STORED_SECTIONS, DOCUMENT_ID, COMPANY_ID, noopRunStep);

    const entities = pipelineStore["job1"]?.graphrag_entities as any[];
    // "Microsoft" appears in both chunks → should be deduplicated to 1 entity
    const msEntities = entities.filter((e: any) => e.name === "microsoft");
    expect(msEntities).toHaveLength(1);
    expect(msEntities[0].mentionCount).toBe(2);
    // Best confidence wins (0.98 > 0.95)
    expect(msEntities[0].confidence).toBe(0.98);
  });

  it("Step F generates CO_OCCURS relationships for entities in the same chunk", async () => {
    process.env.NEO4J_URI = "bolt://localhost:7687";

    await maybeExtractEntities(JOB_ID, SIDECAR_URL, STORED_SECTIONS, DOCUMENT_ID, COMPANY_ID, noopRunStep);

    const coOccurs = pipelineStore["job1"]?.graphrag_co_occurs as any[];
    expect(coOccurs).toBeDefined();
    // 2 entities per chunk × 2 chunks = 2 CO_OCCURS (one pair per chunk)
    expect(coOccurs.length).toBe(2);
    expect(coOccurs.every((r: any) => r.relationType === "CO_OCCURS")).toBe(true);
  });

  it("Step F creates mentions linking entities to sections", async () => {
    process.env.NEO4J_URI = "bolt://localhost:7687";

    await maybeExtractEntities(JOB_ID, SIDECAR_URL, STORED_SECTIONS, DOCUMENT_ID, COMPANY_ID, noopRunStep);

    const mentions = pipelineStore["job1"]?.graphrag_mentions as any[];
    expect(mentions).toBeDefined();
    expect(mentions.length).toBe(4);
    expect(mentions[0].sectionId).toBe(1);
    expect(mentions[0].documentId).toBe(DOCUMENT_ID);
  });

  // ── Step F2: Relationship Extraction ───────────────────────────────────────

  it("Step F2 calls POST /extract-relationships when NEO4J_URI and EXTRACTION_LLM_BASE_URL are set", async () => {
    process.env.NEO4J_URI = "bolt://localhost:7687";
    process.env.EXTRACTION_LLM_BASE_URL = "http://localhost:11434/v1";

    await maybeExtractRelationships(JOB_ID, SIDECAR_URL, STORED_SECTIONS, DOCUMENT_ID, COMPANY_ID, noopRunStep);

    const relCall = fetchMock.mock.calls.find(([url]) =>
      url.toString().includes("/extract-relationships"),
    );
    expect(relCall).toBeDefined();
  });

  it("Step F2 is skipped when EXTRACTION_LLM_BASE_URL is not set", async () => {
    process.env.NEO4J_URI = "bolt://localhost:7687";
    delete process.env.EXTRACTION_LLM_BASE_URL;

    await maybeExtractRelationships(JOB_ID, SIDECAR_URL, STORED_SECTIONS, DOCUMENT_ID, COMPANY_ID, noopRunStep);

    const relCall = fetchMock.mock.calls.find(([url]) =>
      url.toString().includes("/extract-relationships"),
    );
    expect(relCall).toBeUndefined();
  });

  it("Step F2 maps LLM entity types to BERT labels (PERSON→PER, ORGANIZATION→ORG)", async () => {
    process.env.NEO4J_URI = "bolt://localhost:7687";
    process.env.EXTRACTION_LLM_BASE_URL = "http://localhost:11434/v1";

    await maybeExtractRelationships(JOB_ID, SIDECAR_URL, STORED_SECTIONS, DOCUMENT_ID, COMPANY_ID, noopRunStep);

    const llmRels = pipelineStore["job1"]?.graphrag_llm_rels as any[];
    expect(llmRels).toBeDefined();
    expect(llmRels.length).toBe(1);
    expect(llmRels[0].relationType).toBe("CEO_OF");
    // Labels should be BERT format, not LLM format
    expect(llmRels[0].sourceLabel).toBe("PER");   // PERSON → PER
    expect(llmRels[0].targetLabel).toBe("ORG");   // ORGANIZATION → ORG
  });

  it("Step F2 failure does not throw", async () => {
    process.env.NEO4J_URI = "bolt://localhost:7687";
    process.env.EXTRACTION_LLM_BASE_URL = "http://localhost:11434/v1";

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith("/health")) return new Response("{}", { status: 200 });
      if (url.includes("/extract-relationships")) return new Response("error", { status: 500 });
      return new Response("{}", { status: 200 });
    });

    await expect(
      maybeExtractRelationships(JOB_ID, SIDECAR_URL, STORED_SECTIONS, DOCUMENT_ID, COMPANY_ID, noopRunStep),
    ).resolves.not.toThrow();
  });

  // ── Step G: Neo4j Direct Write ─────────────────────────────────────────────

  it("Step G calls ensureIndexes before writes", async () => {
    process.env.NEO4J_URI = "bolt://localhost:7687";

    await maybeSyncToNeo4j(JOB_ID, DOCUMENT_ID, DOCUMENT_NAME, COMPANY_ID, STORED_SECTIONS, noopRunStep);

    expect(mockEnsureIndexes).toHaveBeenCalled();
    // ensureIndexes should be called before writeEntities
    const indexOrder = mockEnsureIndexes.mock.invocationCallOrder[0]!;
    const writeOrder = mockWriteEntities.mock.invocationCallOrder[0]!;
    expect(indexOrder).toBeLessThan(writeOrder);
  });

  it("Step G calls writeEntities with data from pipeline state", async () => {
    process.env.NEO4J_URI = "bolt://localhost:7687";

    pipelineStore["job1"] = {
      graphrag_entities: [
        { name: "satya nadella", displayName: "Satya Nadella", label: "PER", confidence: 0.99, mentionCount: 1, companyId: COMPANY_ID },
      ],
      graphrag_co_occurs: [],
      graphrag_mentions: [],
      graphrag_llm_rels: [],
    };

    await maybeSyncToNeo4j(JOB_ID, DOCUMENT_ID, DOCUMENT_NAME, COMPANY_ID, STORED_SECTIONS, noopRunStep);

    expect(mockWriteEntities).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: "satya nadella" })]),
      COMPANY_ID,
    );
  });

  it("Step G combines CO_OCCURS + LLM relationships", async () => {
    process.env.NEO4J_URI = "bolt://localhost:7687";

    pipelineStore["job1"] = {
      graphrag_entities: [],
      graphrag_co_occurs: [
        { sourceName: "a", sourceLabel: "PER", targetName: "b", targetLabel: "ORG", relationType: "CO_OCCURS", weight: 0.5, evidenceCount: 1, documentId: DOCUMENT_ID, companyId: COMPANY_ID },
      ],
      graphrag_mentions: [],
      graphrag_llm_rels: [
        { sourceName: "a", sourceLabel: "PER", targetName: "b", targetLabel: "ORG", relationType: "CEO_OF", weight: 0.7, evidenceCount: 1, documentId: DOCUMENT_ID, companyId: COMPANY_ID },
      ],
    };

    await maybeSyncToNeo4j(JOB_ID, DOCUMENT_ID, DOCUMENT_NAME, COMPANY_ID, STORED_SECTIONS, noopRunStep);

    const rels = mockWriteRelationships.mock.calls[0]?.[0] as any[];
    const types = rels.map((r: any) => r.relationType);
    expect(types).toContain("CO_OCCURS");
    expect(types).toContain("CEO_OF");
  });

  it("Step G calls writeMentions with mention data", async () => {
    process.env.NEO4J_URI = "bolt://localhost:7687";

    pipelineStore["job1"] = {
      graphrag_entities: [],
      graphrag_co_occurs: [],
      graphrag_mentions: [
        { entityName: "satya nadella", entityLabel: "PER", sectionId: 1, documentId: DOCUMENT_ID, confidence: 0.99, companyId: COMPANY_ID },
      ],
      graphrag_llm_rels: [],
    };

    await maybeSyncToNeo4j(JOB_ID, DOCUMENT_ID, DOCUMENT_NAME, COMPANY_ID, STORED_SECTIONS, noopRunStep);

    expect(mockWriteMentions).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ entityName: "satya nadella" })]),
      COMPANY_ID,
    );
  });

  it("Step G calls writeDocumentGraph with document metadata and sectionIds", async () => {
    process.env.NEO4J_URI = "bolt://localhost:7687";

    pipelineStore["job1"] = { graphrag_entities: [], graphrag_co_occurs: [], graphrag_mentions: [], graphrag_llm_rels: [] };

    await maybeSyncToNeo4j(JOB_ID, DOCUMENT_ID, DOCUMENT_NAME, COMPANY_ID, STORED_SECTIONS, noopRunStep);

    expect(mockWriteDocumentGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.objectContaining({ id: DOCUMENT_ID, name: DOCUMENT_NAME, companyId: COMPANY_ID }),
        sectionIds: [1, 2],
      }),
      COMPANY_ID,
    );
  });

  it("Step G calls resolveEntities when entities exist", async () => {
    process.env.NEO4J_URI = "bolt://localhost:7687";

    pipelineStore["job1"] = {
      graphrag_entities: [
        { name: "microsoft", displayName: "Microsoft", label: "ORG", confidence: 0.98, mentionCount: 1, companyId: COMPANY_ID },
      ],
      graphrag_co_occurs: [],
      graphrag_mentions: [],
      graphrag_llm_rels: [],
    };

    await maybeSyncToNeo4j(JOB_ID, DOCUMENT_ID, DOCUMENT_NAME, COMPANY_ID, STORED_SECTIONS, noopRunStep);

    expect(mockResolveEntities).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: "microsoft" })]),
      COMPANY_ID,
    );
  });

  it("Step G does NOT import neo4j-sync.ts", async () => {
    process.env.NEO4J_URI = "bolt://localhost:7687";
    pipelineStore["job1"] = { graphrag_entities: [], graphrag_co_occurs: [], graphrag_mentions: [], graphrag_llm_rels: [] };

    const syncMock = jest.fn();
    jest.doMock("~/lib/graph/neo4j-sync", () => ({ syncDocumentToNeo4j: syncMock }));

    await maybeSyncToNeo4j(JOB_ID, DOCUMENT_ID, DOCUMENT_NAME, COMPANY_ID, STORED_SECTIONS, noopRunStep);

    expect(syncMock).not.toHaveBeenCalled();
  });

  // ── Gating & Backward Compatibility ────────────────────────────────────────

  it("When NEO4J_URI is not set, Steps F, F2, and G do not run", async () => {
    delete process.env.NEO4J_URI;

    await maybeExtractEntities(JOB_ID, SIDECAR_URL, STORED_SECTIONS, DOCUMENT_ID, COMPANY_ID, noopRunStep);
    await maybeExtractRelationships(JOB_ID, SIDECAR_URL, STORED_SECTIONS, DOCUMENT_ID, COMPANY_ID, noopRunStep);
    await maybeSyncToNeo4j(JOB_ID, DOCUMENT_ID, DOCUMENT_NAME, COMPANY_ID, STORED_SECTIONS, noopRunStep);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockWriteEntities).not.toHaveBeenCalled();
    expect(mockEnsureIndexes).not.toHaveBeenCalled();
  });

  it("Neo4j unreachable during Step G — no error thrown", async () => {
    process.env.NEO4J_URI = "bolt://localhost:7687";
    mockCheckNeo4jHealth.mockResolvedValue(false);

    pipelineStore["job1"] = { graphrag_entities: [], graphrag_co_occurs: [], graphrag_mentions: [], graphrag_llm_rels: [] };

    await expect(
      maybeSyncToNeo4j(JOB_ID, DOCUMENT_ID, DOCUMENT_NAME, COMPANY_ID, STORED_SECTIONS, noopRunStep),
    ).resolves.not.toThrow();

    expect(mockWriteEntities).not.toHaveBeenCalled();
  });

  // ── Failure Isolation ──────────────────────────────────────────────────────

  it("Step F2 failure → Step G still writes BERT entities + CO_OCCURS", async () => {
    process.env.NEO4J_URI = "bolt://localhost:7687";
    process.env.EXTRACTION_LLM_BASE_URL = "http://localhost:11434/v1";
    mockCheckNeo4jHealth.mockResolvedValue(true);

    // Step F2 fails
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith("/health")) return new Response("{}", { status: 200 });
      if (url.includes("/extract-relationships")) return new Response("error", { status: 500 });
      return new Response("{}", { status: 200 });
    });

    // Pre-populate with BERT data (as if Step F ran)
    pipelineStore["job1"] = {
      graphrag_entities: [
        { name: "microsoft", displayName: "Microsoft", label: "ORG", confidence: 0.98, mentionCount: 1, companyId: COMPANY_ID },
      ],
      graphrag_co_occurs: [
        { sourceName: "satya nadella", sourceLabel: "PER", targetName: "microsoft", targetLabel: "ORG", relationType: "CO_OCCURS", weight: 0.5, evidenceCount: 1, documentId: DOCUMENT_ID, companyId: COMPANY_ID },
      ],
      graphrag_mentions: [],
    };

    // F2 should swallow error
    await maybeExtractRelationships(JOB_ID, SIDECAR_URL, STORED_SECTIONS, DOCUMENT_ID, COMPANY_ID, noopRunStep);

    // G should still write BERT data (no LLM rels in pipeline state)
    await maybeSyncToNeo4j(JOB_ID, DOCUMENT_ID, DOCUMENT_NAME, COMPANY_ID, STORED_SECTIONS, noopRunStep);

    expect(mockWriteEntities).toHaveBeenCalled();
    const rels = mockWriteRelationships.mock.calls[0]?.[0] as any[];
    expect(rels.every((r: any) => r.relationType === "CO_OCCURS")).toBe(true);
  });

  it("Step G write failure → resolves without throwing", async () => {
    process.env.NEO4J_URI = "bolt://localhost:7687";
    mockCheckNeo4jHealth.mockResolvedValue(true);
    mockWriteEntities.mockRejectedValueOnce(new Error("Neo4j write failed"));

    pipelineStore["job1"] = {
      graphrag_entities: [{ name: "x", displayName: "X", label: "ORG", confidence: 0.9, mentionCount: 1, companyId: COMPANY_ID }],
      graphrag_co_occurs: [],
      graphrag_mentions: [],
      graphrag_llm_rels: [],
    };

    await expect(
      maybeSyncToNeo4j(JOB_ID, DOCUMENT_ID, DOCUMENT_NAME, COMPANY_ID, STORED_SECTIONS, noopRunStep),
    ).resolves.not.toThrow();
  });
});
