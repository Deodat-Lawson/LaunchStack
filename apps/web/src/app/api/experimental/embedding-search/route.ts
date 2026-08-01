import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { experimentalDocumentSearch } from "~/lib/tools/rag/experimental-search";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import { document } from "@launchstack/core/db/schema";

const EXPERIMENTAL_FLAG = process.env.EXPERIMENTAL_EMBEDDINGS_ENABLED === "true";

export async function POST(request: Request) {
  if (!EXPERIMENTAL_FLAG) {
    return NextResponse.json(
      {
        error:
          "Experimental embeddings disabled. Set EXPERIMENTAL_EMBEDDINGS_ENABLED=true to enable this route.",
      },
      { status: 403 },
    );
  }

  const ctx = await requireWorkspaceContext();
  if (!ctx.success) return ctx.response;

  const body = (await request.json().catch(() => null)) as {
    documentId?: number;
    query?: string;
    topK?: number;
  } | null;

  if (!body || !body.documentId || !body.query) {
    return NextResponse.json(
      { error: "documentId and query are required" },
      { status: 400 },
    );
  }

  const [doc] = await db
    .select({ id: document.id, companyId: document.companyId })
    .from(document)
    .where(
      and(
        eq(document.id, body.documentId),
        eq(document.companyId, ctx.data.companyId),
      ),
    )
    .limit(1);

  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const results = await experimentalDocumentSearch(body.query, {
    documentId: body.documentId,
    topK: body.topK,
  });

  return NextResponse.json({
    provider: process.env.EXPERIMENTAL_EMBEDDING_PROVIDER || "sidecar",
    model: process.env.EXPERIMENTAL_EMBEDDING_MODEL || "bge-large-en-v1.5",
    version: process.env.EXPERIMENTAL_EMBEDDING_VERSION || "exp-v1",
    results,
  });
}
