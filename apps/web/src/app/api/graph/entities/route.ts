/**
 * Graph Entities API
 *
 * GET /api/graph/entities
 *   Returns a company-scoped entity/relationship graph for the workspace
 *   Graph view. Serves from Neo4j when configured; falls back to the
 *   PostgreSQL knowledge-graph tables otherwise so the UI always renders.
 *
 * Query params:
 *   - limit:     max number of entities to return (default 120, cap 500)
 *   - minCount:  drop entities whose mentionCount is below this (default 1)
 *   - documentId: narrow to entities mentioned in a specific document
 *
 * Response shape:
 *   {
 *     source: "neo4j" | "postgres" | "empty",
 *     nodes: [{ id, name, label, mentionCount, confidence }],
 *     edges: [{ source, target, type, weight, evidenceCount }],
 *     stats: { entities, relationships, truncated }
 *   }
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "~/server/db";
import {
  kgEntities,
  kgEntityMentions,
  kgRelationships,
  users,
} from "@launchstack/core/db/schema";
import {
  getNeo4jSession,
  isNeo4jConfigured,
} from "@launchstack/core/graph";
import { getEngine } from "~/server/engine";

interface GraphNode {
  id: number;
  name: string;
  label: string;
  mentionCount: number;
  confidence: number;
}

interface GraphEdge {
  source: number;
  target: number;
  type: string;
  weight: number;
  evidenceCount: number;
}

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 120;

export async function GET(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [userInfo] = await db
      .select()
      .from(users)
      .where(eq(users.userId, userId));
    if (!userInfo) {
      return NextResponse.json({ error: "Unknown user" }, { status: 401 });
    }

    const url = new URL(request.url);
    const limitParam = Number(url.searchParams.get("limit"));
    const minCountParam = Number(url.searchParams.get("minCount"));
    const documentIdParam = url.searchParams.get("documentId");

    const limit = Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_LIMIT)
      : DEFAULT_LIMIT;
    const minCount = Number.isFinite(minCountParam) && minCountParam > 0
      ? minCountParam
      : 1;
    const documentId = documentIdParam ? Number(documentIdParam) : null;

    // Make sure the engine has booted so Neo4j is configured before we try it.
    getEngine();

    if (isNeo4jConfigured()) {
      try {
        const result = await queryNeo4j({
          companyId: userInfo.companyId,
          limit,
          minCount,
          documentId,
        });
        if (result.nodes.length > 0) {
          return NextResponse.json({
            source: "neo4j",
            ...result,
          });
        }
        // Neo4j returned no rows for this company — fall through to Postgres
        // in case sync hasn't run yet.
      } catch (err) {
        console.warn("[GraphEntities] Neo4j query failed, falling back to Postgres:", err);
      }
    }

    const pg = await queryPostgres({
      companyId: userInfo.companyId,
      limit,
      minCount,
      documentId,
    });
    return NextResponse.json({
      source: pg.nodes.length > 0 ? "postgres" : "empty",
      ...pg,
    });
  } catch (error) {
    console.error("[GraphEntities] failed:", error);
    return NextResponse.json(
      {
        error: "Failed to load graph",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

interface QueryArgs {
  companyId: bigint;
  limit: number;
  minCount: number;
  documentId: number | null;
}

interface QueryResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: { entities: number; relationships: number; truncated: boolean };
}

async function queryNeo4j({
  companyId,
  limit,
  minCount,
  documentId,
}: QueryArgs): Promise<QueryResult> {
  const session = getNeo4jSession();
  try {
    const companyIdStr = companyId.toString();
    // Pull top entities by mentionCount, optionally scoped to a document.
    const entityFilter = documentId
      ? `MATCH (e:Entity {companyId: $companyId})-[:MENTIONED_IN]->(:Section {documentId: $documentId})`
      : `MATCH (e:Entity {companyId: $companyId})`;
    const entityQuery = `
      ${entityFilter}
      WHERE e.mentionCount >= $minCount
      WITH DISTINCT e
      RETURN
        e.id AS id,
        e.displayName AS name,
        e.label AS label,
        coalesce(e.mentionCount, 1) AS mentionCount,
        coalesce(e.confidence, 0) AS confidence
      ORDER BY mentionCount DESC
      LIMIT $limit
    `;
    const entityResult = await session.run(entityQuery, {
      companyId: companyIdStr,
      minCount,
      limit,
      documentId: documentId ? documentId.toString() : null,
    });
    const nodes: GraphNode[] = entityResult.records.map((r) => ({
      id: Number(r.get("id")),
      name: String(r.get("name")),
      label: String(r.get("label")),
      mentionCount: Number(r.get("mentionCount")),
      confidence: Number(r.get("confidence")),
    }));
    if (nodes.length === 0) {
      return {
        nodes: [],
        edges: [],
        stats: { entities: 0, relationships: 0, truncated: false },
      };
    }
    const nodeIds = nodes.map((n) => n.id);
    const edgeQuery = `
      MATCH (a:Entity {companyId: $companyId})-[r]->(b:Entity {companyId: $companyId})
      WHERE a.id IN $nodeIds AND b.id IN $nodeIds AND type(r) <> 'MENTIONED_IN'
      RETURN
        a.id AS source,
        b.id AS target,
        type(r) AS type,
        coalesce(r.weight, 0.5) AS weight,
        coalesce(r.evidenceCount, 1) AS evidenceCount
    `;
    const edgeResult = await session.run(edgeQuery, {
      companyId: companyIdStr,
      nodeIds,
    });
    const edges: GraphEdge[] = edgeResult.records.map((r) => ({
      source: Number(r.get("source")),
      target: Number(r.get("target")),
      type: String(r.get("type")),
      weight: Number(r.get("weight")),
      evidenceCount: Number(r.get("evidenceCount")),
    }));
    return {
      nodes,
      edges,
      stats: {
        entities: nodes.length,
        relationships: edges.length,
        truncated: nodes.length === limit,
      },
    };
  } finally {
    await session.close();
  }
}

async function queryPostgres({
  companyId,
  limit,
  minCount,
  documentId,
}: QueryArgs): Promise<QueryResult> {
  let entityRows: {
    id: number;
    name: string;
    displayName: string;
    label: string;
    mentionCount: number;
    confidence: number;
  }[];

  if (documentId != null) {
    entityRows = await db
      .selectDistinct({
        id: kgEntities.id,
        name: kgEntities.name,
        displayName: kgEntities.displayName,
        label: kgEntities.label,
        mentionCount: kgEntities.mentionCount,
        confidence: kgEntities.confidence,
      })
      .from(kgEntities)
      .innerJoin(
        kgEntityMentions,
        eq(kgEntities.id, kgEntityMentions.entityId),
      )
      .where(
        and(
          eq(kgEntities.companyId, companyId),
          eq(kgEntityMentions.documentId, BigInt(documentId)),
          sql`${kgEntities.mentionCount} >= ${minCount}`,
        ),
      )
      .orderBy(desc(kgEntities.mentionCount))
      .limit(limit);
  } else {
    entityRows = await db
      .select({
        id: kgEntities.id,
        name: kgEntities.name,
        displayName: kgEntities.displayName,
        label: kgEntities.label,
        mentionCount: kgEntities.mentionCount,
        confidence: kgEntities.confidence,
      })
      .from(kgEntities)
      .where(
        and(
          eq(kgEntities.companyId, companyId),
          sql`${kgEntities.mentionCount} >= ${minCount}`,
        ),
      )
      .orderBy(desc(kgEntities.mentionCount))
      .limit(limit);
  }

  if (entityRows.length === 0) {
    return {
      nodes: [],
      edges: [],
      stats: { entities: 0, relationships: 0, truncated: false },
    };
  }

  const nodeIds = entityRows.map((r) => r.id);
  const edgeRows = await db
    .select({
      source: kgRelationships.sourceEntityId,
      target: kgRelationships.targetEntityId,
      type: kgRelationships.relationshipType,
      weight: kgRelationships.weight,
      evidenceCount: kgRelationships.evidenceCount,
    })
    .from(kgRelationships)
    .where(
      and(
        eq(kgRelationships.companyId, companyId),
        inArray(kgRelationships.sourceEntityId, nodeIds),
        inArray(kgRelationships.targetEntityId, nodeIds),
      ),
    );

  const nodes: GraphNode[] = entityRows.map((r) => ({
    id: r.id,
    name: r.displayName,
    label: r.label,
    mentionCount: r.mentionCount,
    confidence: r.confidence,
  }));

  const edges: GraphEdge[] = edgeRows.map((r) => ({
    source: r.source,
    target: r.target,
    type: r.type,
    weight: r.weight,
    evidenceCount: r.evidenceCount,
  }));

  return {
    nodes,
    edges,
    stats: {
      entities: nodes.length,
      relationships: edges.length,
      truncated: nodes.length === limit,
    },
  };
}
