/**
 * Document Generator - Documents CRUD API
 * 
 * Endpoints:
 * - GET: List all generated documents for the user
 * - POST: Create a new generated document
 * - PUT: Update an existing generated document
 * - DELETE: Delete a generated document
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "~/server/db/index";
import { eq, and, desc } from "drizzle-orm";
import { users, generatedDocuments } from "~/server/db/schema";
import { z } from "zod";

export const runtime = "nodejs";

// Citation schema - flexible to support multiple formats
const CitationSchema = z.object({
    id: z.string(),
    // Support both old and new formats
    sourceType: z.enum(["arxiv", "website", "document", "book", "journal"]).optional(),
    title: z.string().optional(),
    authors: z.array(z.string()).optional(),
    url: z.string().optional(),
    year: z.string().optional(),
    arxivId: z.string().optional(),
    accessDate: z.string().optional(),
    // Legacy fields
    text: z.string().optional(),
    sourceUrl: z.string().optional(),
    sourceTitle: z.string().optional(),
    format: z.string().optional(),
    createdAt: z.string().optional(),
}).passthrough(); // Allow additional fields

// Validation schemas
const CreateDocumentSchema = z.object({
    title: z.string().min(1).max(512),
    content: z.string(),
    templateId: z.string().max(64).optional(),
    metadata: z.record(z.unknown()).optional(), // Flexible metadata object
    citations: z.array(CitationSchema).optional(),
});

const UpdateDocumentSchema = z.object({
    id: z.number(),
    title: z.string().min(1).max(512).optional(),
    content: z.string().optional(),
    metadata: z.record(z.unknown()).optional(), // Flexible metadata object
    citations: z.array(CitationSchema).optional(),
});

const DeleteDocumentSchema = z.object({
    id: z.number(),
});

// Database citation format
interface DbCitation {
    id: string;
    text: string;
    sourceUrl?: string;
    sourceTitle?: string;
    format: string;
    createdAt: string;
}

// Transform input citations to database format
function transformCitations(citations: z.infer<typeof CitationSchema>[] | undefined): DbCitation[] | undefined {
    if (!citations) return undefined;
    
    return citations.map((c) => ({
        id: c.id,
        text: c.text ?? c.title ?? "",
        sourceUrl: c.sourceUrl ?? c.url,
        sourceTitle: c.sourceTitle ?? c.title,
        format: c.format ?? "apa",
        createdAt: c.createdAt ?? new Date().toISOString(),
    }));
}

/**
 * GET - List all generated documents for the authenticated user
 * Query: ?templateId=rewrite to filter rewrite documents only
 */
export async function GET(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        // Get user's company
        const [requestingUser] = await db
            .select()
            .from(users)
            .where(eq(users.userId, userId))
            .limit(1);

        if (!requestingUser) {
            return NextResponse.json(
                { success: false, message: "User not found" },
                { status: 404 }
            );
        }

        const { searchParams } = new URL(request.url);
        const templateId = searchParams.get("templateId");

        const conditions = [
            eq(generatedDocuments.userId, userId),
            eq(generatedDocuments.companyId, requestingUser.companyId),
        ];
        if (templateId) {
            conditions.push(eq(generatedDocuments.templateId, templateId));
        }

        const documents = await db
            .select()
            .from(generatedDocuments)
            .where(and(...conditions))
            .orderBy(desc(generatedDocuments.updatedAt));

        return NextResponse.json({
            success: true,
            documents: documents.map(doc => ({
                id: doc.id,
                title: doc.title,
                content: doc.content,
                templateId: doc.templateId,
                metadata: doc.metadata,
                citations: doc.citations,
                createdAt: doc.createdAt,
                updatedAt: doc.updatedAt,
            })),
        });
    } catch (error) {
        console.error("❌ [Document Generator] Error fetching documents:", error);
        return NextResponse.json(
            { success: false, message: "Failed to fetch documents" },
            { status: 500 }
        );
    }
}

/**
 * POST - Create a new generated document
 */
export async function POST(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const body = await request.json() as unknown;
        const validation = CreateDocumentSchema.safeParse(body);
        
        if (!validation.success) {
            return NextResponse.json(
                { success: false, message: "Invalid request body", errors: validation.error.errors },
                { status: 400 }
            );
        }

        // Get user's company
        const [requestingUser] = await db
            .select()
            .from(users)
            .where(eq(users.userId, userId))
            .limit(1);

        if (!requestingUser) {
            return NextResponse.json(
                { success: false, message: "User not found" },
                { status: 404 }
            );
        }

        const { title, content, templateId, metadata, citations } = validation.data;

        // Create the document
        const [newDocument] = await db
            .insert(generatedDocuments)
            .values({
                userId,
                companyId: requestingUser.companyId,
                title,
                content,
                templateId,
                metadata,
                citations: transformCitations(citations),
            })
            .returning();

        return NextResponse.json({
            success: true,
            document: {
                id: newDocument?.id,
                title: newDocument?.title,
                content: newDocument?.content,
                templateId: newDocument?.templateId,
                metadata: newDocument?.metadata,
                citations: newDocument?.citations,
                createdAt: newDocument?.createdAt,
                updatedAt: newDocument?.updatedAt,
            },
        });
    } catch (error) {
        console.error("❌ [Document Generator] Error creating document:", error);
        return NextResponse.json(
            { success: false, message: "Failed to create document" },
            { status: 500 }
        );
    }
}

/**
 * PUT - Update an existing generated document
 */
export async function PUT(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const body = await request.json() as unknown;
        const validation = UpdateDocumentSchema.safeParse(body);
        
        if (!validation.success) {
            return NextResponse.json(
                { success: false, message: "Invalid request body", errors: validation.error.errors },
                { status: 400 }
            );
        }

        const { id, title, content, metadata, citations } = validation.data;

        // Verify ownership
        const [existingDoc] = await db
            .select()
            .from(generatedDocuments)
            .where(
                and(
                    eq(generatedDocuments.id, id),
                    eq(generatedDocuments.userId, userId)
                )
            )
            .limit(1);

        if (!existingDoc) {
            return NextResponse.json(
                { success: false, message: "Document not found or access denied" },
                { status: 404 }
            );
        }

        // Build update object
        const updateData: Partial<typeof generatedDocuments.$inferInsert> = {};
        if (title !== undefined) updateData.title = title;
        if (content !== undefined) updateData.content = content;
        if (metadata !== undefined) updateData.metadata = metadata;
        if (citations !== undefined) updateData.citations = transformCitations(citations);

        // Update the document
        const [updatedDocument] = await db
            .update(generatedDocuments)
            .set(updateData)
            .where(eq(generatedDocuments.id, id))
            .returning();

        return NextResponse.json({
            success: true,
            document: {
                id: updatedDocument?.id,
                title: updatedDocument?.title,
                content: updatedDocument?.content,
                templateId: updatedDocument?.templateId,
                metadata: updatedDocument?.metadata,
                citations: updatedDocument?.citations,
                createdAt: updatedDocument?.createdAt,
                updatedAt: updatedDocument?.updatedAt,
            },
        });
    } catch (error) {
        console.error("❌ [Document Generator] Error updating document:", error);
        return NextResponse.json(
            { success: false, message: "Failed to update document" },
            { status: 500 }
        );
    }
}

/**
 * DELETE - Delete a generated document
 */
export async function DELETE(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const body = await request.json() as unknown;
        const validation = DeleteDocumentSchema.safeParse(body);
        
        if (!validation.success) {
            return NextResponse.json(
                { success: false, message: "Invalid request body", errors: validation.error.errors },
                { status: 400 }
            );
        }

        const { id } = validation.data;

        // Verify ownership before deleting
        const [existingDoc] = await db
            .select()
            .from(generatedDocuments)
            .where(
                and(
                    eq(generatedDocuments.id, id),
                    eq(generatedDocuments.userId, userId)
                )
            )
            .limit(1);

        if (!existingDoc) {
            return NextResponse.json(
                { success: false, message: "Document not found or access denied" },
                { status: 404 }
            );
        }

        // Delete the document
        await db
            .delete(generatedDocuments)
            .where(eq(generatedDocuments.id, id));

        return NextResponse.json({
            success: true,
            message: "Document deleted successfully",
        });
    } catch (error) {
        console.error("❌ [Document Generator] Error deleting document:", error);
        return NextResponse.json(
            { success: false, message: "Failed to delete document" },
            { status: 500 }
        );
    }
}
