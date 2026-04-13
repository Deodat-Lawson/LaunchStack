import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { document, documentSections, pdfChunks, users } from "~/server/db/schema";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [user] = await db.select().from(users).where(eq(users.userId, userId)).limit(1);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const url = new URL(request.url);
    const docIdParam = url.searchParams.get("documentId");

    const companyId = Number(user.companyId);

    const docs = await db
      .select({
        id: document.id,
        title: document.title,
        category: document.category,
        ocrProcessed: document.ocrProcessed,
      })
      .from(document)
      .where(eq(document.companyId, BigInt(companyId)));

    if (!docIdParam) {
      const docSummaries = [];
      for (const doc of docs) {
        const docBigInt = BigInt(Number(doc.id));
        const sections = await db
          .select({ id: documentSections.id })
          .from(documentSections)
          .where(eq(documentSections.documentId, docBigInt));
        const legacy = await db
          .select({ id: pdfChunks.id })
          .from(pdfChunks)
          .where(eq(pdfChunks.documentId, docBigInt));
        docSummaries.push({
          id: Number(doc.id),
          title: doc.title,
          category: doc.category,
          ocrProcessed: doc.ocrProcessed,
          sectionChunks: sections.length,
          legacyChunks: legacy.length,
          totalChunks: sections.length + legacy.length,
        });
      }
      return NextResponse.json({
        companyId,
        totalDocuments: docs.length,
        documents: docSummaries,
      });
    }

    const docId = parseInt(docIdParam, 10);
    if (Number.isNaN(docId)) {
      return NextResponse.json({ error: "Invalid documentId" }, { status: 400 });
    }

    const targetDoc = docs.find((d) => Number(d.id) === docId);
    if (!targetDoc) {
      return NextResponse.json({ error: "Document not found in your company" }, { status: 404 });
    }

    const sections = await db
      .select({
        id: documentSections.id,
        content: documentSections.content,
        page: documentSections.pageNumber,
      })
      .from(documentSections)
      .where(eq(documentSections.documentId, BigInt(docId)));

    const legacy = await db
      .select({
        id: pdfChunks.id,
        content: pdfChunks.content,
        page: pdfChunks.page,
      })
      .from(pdfChunks)
      .where(eq(pdfChunks.documentId, BigInt(docId)));

    return NextResponse.json({
      document: {
        id: Number(targetDoc.id),
        title: targetDoc.title,
        ocrProcessed: targetDoc.ocrProcessed,
      },
      sections: sections.map((s) => ({
        id: s.id,
        page: s.page,
        contentPreview: s.content.slice(0, 500),
        contentLength: s.content.length,
      })),
      legacyChunks: legacy.map((c) => ({
        id: c.id,
        page: c.page,
        contentPreview: c.content.slice(0, 500),
        contentLength: c.content.length,
      })),
      totalSections: sections.length,
      totalLegacyChunks: legacy.length,
    });
  } catch (error) {
    console.error("[debug/document-chunks] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 },
    );
  }
}
