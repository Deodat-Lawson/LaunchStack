/**
 * POST /api/company/metadata/extract
 *
 * Extracts metadata from the logged-in user's company documents and merges
 * them into a single canonical JSON.
 *
 * By default, only processes documents uploaded AFTER the last extraction
 * (incremental mode). Use `{ "force": true }` to re-process all documents.
 *
 * Usage:
 *   POST /api/company/metadata/extract
 *   POST /api/company/metadata/extract   body: { "force": true }
 *   POST /api/company/metadata/extract   body: { "debug": true }
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { users, document as documentTable, documentContextChunks } from "@launchstack/core/db/schema";
import { companyMetadata, companyMetadataHistory } from "@launchstack/core/db/schema/company-metadata";
import { extractCompanyFacts } from "@launchstack/features/company-metadata";
import { mergeCompanyMetadata } from "@launchstack/features/company-metadata";
import { createEmptyMetadata } from "@launchstack/features/company-metadata";
import type { CompanyMetadataJSON, MetadataDiff } from "@launchstack/features/company-metadata";
import { generateStructured } from "~/lib/llm";

export async function POST(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const [userInfo] = await db
            .select({ companyId: users.companyId })
            .from(users)
            .where(eq(users.userId, userId));

        if (!userInfo) {
            return NextResponse.json(
                { error: "User not found" },
                { status: 400 },
            );
        }

        const companyId = String(userInfo.companyId);

        // Parse optional body flags
        let debug = false;
        let force = false;
        try {
            const { CompanyMetadataExtractSchema } = await import("~/lib/validation");
            const body = CompanyMetadataExtractSchema.parse(await request.json());
            debug = body.debug;
            force = body.force;
        } catch {
            // No body or invalid JSON — that's fine, defaults apply
        }

        // Load existing metadata row (for incremental extraction)
        const [existingRow] = await db
            .select({
                metadata: companyMetadata.metadata,
                lastExtractionDocumentId: companyMetadata.lastExtractionDocumentId,
            })
            .from(companyMetadata)
            .where(eq(companyMetadata.companyId, userInfo.companyId));

        // Build document query — incremental by default, full if force=true or no prior extraction
        const lastDocId = existingRow?.lastExtractionDocumentId;
        const isIncremental = !force && lastDocId != null;

        const docs = isIncremental
            ? await db
                  .select({ id: documentTable.id, title: documentTable.title })
                  .from(documentTable)
                  .where(
                      sql`${documentTable.companyId} = ${userInfo.companyId} AND ${documentTable.id} > ${lastDocId}`,
                  )
            : await db
                  .select({ id: documentTable.id, title: documentTable.title })
                  .from(documentTable)
                  .where(eq(documentTable.companyId, userInfo.companyId));

        if (docs.length === 0) {
            return NextResponse.json({
                message: isIncremental
                    ? "No new documents since last extraction"
                    : "No documents found for this company",
                metadata: isIncremental ? existingRow?.metadata ?? null : null,
                documentsProcessed: 0,
                incremental: isIncremental,
            });
        }

        // For incremental: merge into existing. For full: start fresh (force) or merge into existing.
        const baseMetadata = force ? null : existingRow?.metadata ?? null;

        return processDocuments(docs, companyId, userInfo.companyId, baseMetadata, debug, isIncremental, userId);
    } catch (error) {
        console.error("[company-metadata] POST /extract error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 },
        );
    }
}

async function processDocuments(
    docs: Array<{ id: number; title: string }>,
    companyId: string,
    companyIdBigint: bigint,
    existingMetadata: CompanyMetadataJSON | null,
    debug: boolean,
    incremental: boolean,
    userId: string,
) {
    // Debug mode: return per-document chunk counts without running extraction
    if (debug) {
        const diagnostics = [];
        for (const doc of docs) {
            const [row] = await db
                .select({ count: sql<number>`count(*)` })
                .from(documentContextChunks)
                .where(eq(documentContextChunks.documentId, BigInt(doc.id)));
            diagnostics.push({
                documentId: doc.id,
                title: doc.title,
                chunkCount: Number(row?.count ?? 0),
            });
        }
        return NextResponse.json({
            companyId,
            incremental,
            totalDocuments: docs.length,
            documents: diagnostics,
            documentsWithChunks: diagnostics.filter((d) => d.chunkCount > 0).length,
        });
    }

    // Start from existing metadata (incremental) or empty (full re-extract)
    let metadata: CompanyMetadataJSON = existingMetadata ?? createEmptyMetadata(companyId);
    const allDiffs: MetadataDiff = { added: [], updated: [], deprecated: [] };
    let documentsWithFacts = 0;
    let lastDocId = 0;

    for (const doc of docs) {
        const extracted = await extractCompanyFacts({
            documentId: doc.id,
            companyId,
            generate: (input) =>
                generateStructured({
                    ...input,
                    capability: "smallExtraction",
                }),
        });

        if (!extracted) continue;

        const { updatedMetadata, diff } = mergeCompanyMetadata(
            metadata,
            extracted,
        );

        metadata = updatedMetadata;
        allDiffs.added.push(...diff.added);
        allDiffs.updated.push(...diff.updated);
        allDiffs.deprecated.push(...diff.deprecated);
        documentsWithFacts++;
        lastDocId = Math.max(lastDocId, doc.id);
    }

    if (documentsWithFacts === 0 && !existingMetadata) {
        return NextResponse.json({
            message: "No extractable company facts found in any document",
            metadata: null,
            documentsProcessed: docs.length,
            incremental,
        });
    }

    // Update provenance
    metadata.provenance.total_documents_processed =
        (existingMetadata?.provenance.total_documents_processed ?? 0) +
        (incremental ? documentsWithFacts : documentsWithFacts);

    // Save to database with lastExtractionDocumentId tracking
    await db
        .insert(companyMetadata)
        .values({
            companyId: companyIdBigint,
            metadata: metadata,
            ...(lastDocId > 0 && { lastExtractionDocumentId: BigInt(lastDocId) }),
        })
        .onConflictDoUpdate({
            target: companyMetadata.companyId,
            set: {
                metadata: metadata,
                ...(lastDocId > 0 && { lastExtractionDocumentId: BigInt(lastDocId) }),
            },
        });

    // Write audit history entry for this extraction
    const hasChanges = allDiffs.added.length > 0 || allDiffs.updated.length > 0 || allDiffs.deprecated.length > 0;
    if (hasChanges) {
        await db.insert(companyMetadataHistory).values({
            companyId: companyIdBigint,
            documentId: lastDocId > 0 ? BigInt(lastDocId) : null,
            changeType: "extraction",
            diff: allDiffs,
            changedBy: userId,
        });
    }

    return NextResponse.json({
        metadata,
        documentsProcessed: docs.length,
        documentsWithFacts,
        incremental,
        diff: {
            added: allDiffs.added,
            updated: allDiffs.updated,
            deprecated: allDiffs.deprecated,
            summary: {
                added: allDiffs.added.length,
                updated: allDiffs.updated.length,
                deprecated: allDiffs.deprecated.length,
            },
        },
    });
}
