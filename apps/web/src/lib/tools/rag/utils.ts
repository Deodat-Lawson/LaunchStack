import { db } from "~/server/db/index";
import { eq } from "drizzle-orm";
import { document, users } from "~/server/db/schema";
import type { SearchResult } from "./types";

export async function validateDocumentAccess(
  userId: string,
  requestedDocIds: (string | number)[]
): Promise<{
  validDocIds: number[];
  documentTitles: Map<number, string>;
  companyId: string | null;
}> {
  const [userInfo] = await db
    .select()
    .from(users)
    .where(eq(users.userId, userId));

  if (!userInfo) {
    return { validDocIds: [], documentTitles: new Map(), companyId: null };
  }

  const companyId = userInfo.companyId;
  const numericIds = requestedDocIds.map((id) => Number(id));

  const docs = await db
    .select({
      id: document.id,
      title: document.title,
    })
    .from(document)
    .where(eq(document.companyId, companyId));

  const validDocIds = docs
    .map((d) => d.id)
    .filter((id) => numericIds.includes(id));

  const documentTitles = new Map<number, string>();
  docs.forEach((d) => {
    if (numericIds.includes(d.id)) {
      documentTitles.set(d.id, d.title);
    }
  });

  return { validDocIds, documentTitles, companyId: companyId.toString() };
}

export async function getUserCompanyId(userId: string): Promise<string | null> {
  const [userInfo] = await db
    .select({ companyId: users.companyId })
    .from(users)
    .where(eq(users.userId, userId));

  return userInfo?.companyId ? userInfo.companyId.toString() : null;
}

export function formatResultsForPrompt(
  results: SearchResult[],
  documentTitles?: Map<number, string>
): string {
  if (results.length === 0) {
    return "";
  }

  const byDocument = new Map<number, SearchResult[]>();
  for (const result of results) {
    const docId = result.metadata.documentId;
    if (docId !== undefined) {
      if (!byDocument.has(docId)) {
        byDocument.set(docId, []);
      }
      byDocument.get(docId)!.push(result);
    }
  }

  const sections: string[] = [];

  for (const [docId, docResults] of byDocument.entries()) {
    const title =
      documentTitles?.get(docId) ??
      docResults[0]?.metadata.documentTitle ??
      `Document ${docId}`;

    docResults.sort((a, b) => (a.metadata.page ?? 0) - (b.metadata.page ?? 0));

    const content = docResults
      .map((r) => {
        const pageInfo = r.metadata.page ? `[Page ${r.metadata.page}]` : "";
        return `${pageInfo}\n${r.pageContent}`;
      })
      .join("\n\n");

    sections.push(`--- ${title} ---\n${content}`);
  }

  return sections.join("\n\n");
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + "...";
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!;
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}
