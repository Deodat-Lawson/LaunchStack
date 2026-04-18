/**
 * Integration tests for entity resolution via vector index (R6).
 * Requires a running Neo4j instance with vector index support.
 * (docker compose --profile dev up)
 *
 * Run: pnpm test -- integration.entity-resolution
 */

// TODO: import your implementation
// import { Neo4jDirectWriterImpl } from "~/lib/graph/neo4j-direct-writer-impl";

/** Generates a 768-dim embedding with a given base value (for deterministic similarity). */
function makeEmbedding(base: number): number[] {
  return Array.from({ length: 768 }, (_, i) => base + i * 0.0001);
}

/** Cosine similarity between two vectors (for test assertions). */
function cosineSim(a: number[], b: number[]): number {
  const dot = a.reduce((sum, v, i) => sum + v * b[i]!, 0);
  const magA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
  const magB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
  return dot / (magA * magB);
}

describe("Integration: Entity Resolution", () => {
  let testCompanyId: string;

  beforeEach(async () => {
    testCompanyId = `test-company-${Date.now()}`;
    // TODO: ensure vector index exists
    // const writer = new Neo4jDirectWriterImpl();
    // await writer.ensureIndexes();
  });

  afterEach(async () => {
    // TODO: clear test nodes
    // const session = getNeo4jSession();
    // try {
    //   await session.run(
    //     "MATCH (n) WHERE n.companyId = $companyId DETACH DELETE n",
    //     { companyId: testCompanyId }
    //   );
    // } finally {
    //   await session.close();
    // }
  });

  it("merges entities with cosine similarity above threshold", async () => {
    // Write two entities with very similar embeddings (cosine sim > 0.95)
    // const embA = makeEmbedding(0.1);
    // const embB = makeEmbedding(0.1001); // nearly identical
    // console.log("similarity:", cosineSim(embA, embB)); // should be > 0.95
    //
    // await writer.writeEntities([
    //   { name: "microsoft", displayName: "Microsoft", label: "ORG", confidence: 0.9, mentionCount: 5, companyId: testCompanyId, embedding: embA },
    //   { name: "microsoft corp", displayName: "Microsoft Corp", label: "ORG", confidence: 0.85, mentionCount: 2, companyId: testCompanyId, embedding: embB },
    // ], testCompanyId);
    //
    // await writer.resolveEntities([...], testCompanyId);
    //
    // MATCH ()-[:ALIAS_OF]->() WHERE companyId = testCompanyId
    // Expect exactly 1 ALIAS_OF relationship
  });

  it("creates ALIAS_OF relationship from alias to canonical (higher mentionCount is canonical)", async () => {
    // Write entity A (mentionCount: 5) and entity B (mentionCount: 2) with similar embeddings
    // Run resolution
    // MATCH (alias)-[:ALIAS_OF]->(canonical)
    // Verify alias.name = "microsoft corp" (lower mentionCount)
    // Verify canonical.name = "microsoft" (higher mentionCount)
  });

  it("canonical entity has higher mentionCount — no ALIAS_OF points away from it", async () => {
    // Write entities with different mentionCounts and similar embeddings
    // Run resolution
    // MATCH (canonical)-[:ALIAS_OF]->() — should return 0 results (canonical has no outgoing ALIAS_OF)
  });

  it("skips resolution when vector index doesn't exist", async () => {
    // TODO: drop the vector index before this test
    // DROP INDEX `entity-embeddings` IF EXISTS
    //
    // Write entities with embeddings, run resolveEntities
    // Verify no error thrown (resolves without throwing)
    // Verify console.warn was called with a message about the index
    // Verify no ALIAS_OF relationships created
  });

  it("respects ENTITY_RESOLUTION_THRESHOLD env var", async () => {
    // Write two entities with moderate similarity (e.g., 0.90)
    //
    // Test 1: threshold = 0.99 → no ALIAS_OF created
    // process.env.ENTITY_RESOLUTION_THRESHOLD = "0.99";
    // await writer.resolveEntities([...], testCompanyId);
    // MATCH ()-[:ALIAS_OF]->() — expect 0
    //
    // Test 2: threshold = 0.80 → ALIAS_OF created
    // process.env.ENTITY_RESOLUTION_THRESHOLD = "0.80";
    // await writer.resolveEntities([...], testCompanyId);
    // MATCH ()-[:ALIAS_OF]->() — expect 1
  });

  it("excludes self-match — entity is not aliased to itself", async () => {
    // Write one entity with an embedding
    // Run resolveEntities — the vector query will return the entity itself as top match
    // Verify no ALIAS_OF relationship is created (self-match excluded by name <> $name filter)
  });

  it("skips entities without embeddings during resolution", async () => {
    // Write entities: one with embedding, one without
    // Run resolveEntities
    // Verify no error; only the entity with embedding participates in resolution
  });
});
