/**
 * Demo endpoint — Company Metadata Extraction
 *
 * Processes ALL documents for the logged-in user's company, extracts
 * metadata from each, and merges them into a single canonical JSON.
 * No DB writes — returns the result directly.
 *
 * Usage:
 *   POST /api/company/metadata/extract
 *   (no body required — uses the authenticated user's company)
 *
 *   POST /api/company/metadata/extract   body: { "debug": true }
 *   (returns per-document diagnostics instead of running extraction)
 *
 * Returns the full CompanyMetadataJSON + aggregated diff.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { users, document as documentTable, documentContextChunks } from "~/server/db/schema";
import { companyMetadata } from "~/server/db/schema/company-metadata";
import { extractCompanyFacts } from "~/lib/tools/company-metadata/extractor";
import { mergeCompanyMetadata } from "~/lib/tools/company-metadata/merger";
import { createEmptyMetadata } from "~/lib/tools/company-metadata/types";
import type { CompanyMetadataJSON, MetadataDiff } from "~/lib/tools/company-metadata/types";

export async function POST(request: Request) {
    try {
        // Auth
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

        // Check for debug mode
        let debug = false;
        try {
            const body = (await request.json()) as { debug?: boolean };
            debug = body.debug === true;
        } catch {
            // No body or invalid JSON — that's fine
        }

        // Find all documents for this company
        const docs = await db
            .select({ id: documentTable.id, title: documentTable.title })
            .from(documentTable)
            .where(eq(documentTable.companyId, userInfo.companyId));

        if (docs.length === 0) {
            return NextResponse.json({
                message: "No documents found for this company",
                metadata: null,
                documentsProcessed: 0,
            });
        }

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
                totalDocuments: docs.length,
                documents: diagnostics,
                documentsWithChunks: diagnostics.filter((d) => d.chunkCount > 0).length,
            });
        }

        // Process each document sequentially, merging into canonical metadata
        let metadata: CompanyMetadataJSON = createEmptyMetadata(companyId);
        const allDiffs: MetadataDiff = { added: [], updated: [], deprecated: [] };
        let documentsWithFacts = 0;

        for (const doc of docs) {
            const extracted = await extractCompanyFacts({
                documentId: doc.id,
                companyId,
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
        }

        if (documentsWithFacts === 0) {
            return NextResponse.json({
                message: "No extractable company facts found in any document",
                metadata: null,
                documentsProcessed: docs.length,
            });
        }

        // Save to database
        await db
            .insert(companyMetadata)
            .values({
                companyId: userInfo.companyId,
                metadata: metadata,
            })
            .onConflictDoUpdate({
                target: companyMetadata.companyId,
                set: {
                    metadata: metadata,
                },
            });

        return NextResponse.json({
            metadata,
            documentsProcessed: docs.length,
            documentsWithFacts,
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
    } catch (error) {
        console.error("[company-metadata] POST /extract error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 },
        );
    }
}
