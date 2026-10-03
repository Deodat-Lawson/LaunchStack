import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { documentNotes } from "~/server/db/schema";
import { eq, and, desc, ilike, arrayContains, isNull, inArray, or } from "drizzle-orm";
import { validateRequestBody, CreateNoteSchema } from "~/lib/validation";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { createNote } from "~/server/notes/create-note";
import { serializeNote } from "~/server/notes/serialize";
import { searchNotes } from "~/server/notes/search";
import { validateNoteTarget } from "~/server/notes/validate-note-target";
import { filterNotesByDocumentScope, isNoteDocumentVisible } from "~/server/notes/document-scope";

export async function GET(request: Request) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const { searchParams } = new URL(request.url);
        const documentId = searchParams.get("documentId");
        const search = searchParams.get("search");
        const tagsParam = searchParams.get("tags");
        const anchorStatus = searchParams.get("anchorStatus");
        const surface = searchParams.get("surface");

        const companyIdStr = String(ctx.data.companyId);
        const scope = await ctx.data.documentScope();

        // A document outside the caller's scope has no notes to list — it reads
        // as missing, the same as a document that does not exist.
        if (documentId && !(await isNoteDocumentVisible(documentId, ctx.data.companyId, scope))) {
            return NextResponse.json({ error: "Document not found" }, { status: 404 });
        }
        // Scope to the active workspace. Legacy rows with null companyId still
        // surface for the owning user so old notes are not silently dropped.
        const conditions = [
            eq(documentNotes.userId, ctx.data.authUserId),
            or(eq(documentNotes.companyId, companyIdStr), isNull(documentNotes.companyId))!,
        ];

        if (documentId) {
            conditions.push(eq(documentNotes.documentId, documentId));
        } else if (surface === "notebook") {
            // Freeform / cross-document notes — those without a document anchor.
            conditions.push(isNull(documentNotes.documentId));
        }

        // Semantic search path: when `search` is set we try vector first and
        // fall back to title ILIKE if no embedding key is configured. Hits come
        // back as note ids, which we then load via the same Drizzle pipeline so
        // tags/anchorStatus filters still apply on top.
        let semanticIds: number[] | null = null;
        if (search) {
            const hits = await searchNotes({
                userId: ctx.data.authUserId,
                query: search,
                scope: documentId ? "document" : "company",
                documentId: documentId ?? undefined,
                companyId: companyIdStr,
                topK: 25,
            });
            if (hits.length > 0) {
                semanticIds = hits.map(h => h.noteId);
                conditions.push(inArray(documentNotes.id, semanticIds));
            } else {
                conditions.push(ilike(documentNotes.title, `%${search}%`));
            }
        }

        if (tagsParam) {
            const tags = tagsParam.split(",").map(t => t.trim());
            conditions.push(arrayContains(documentNotes.tags, tags));
        }

        if (
            anchorStatus === "resolved" ||
            anchorStatus === "drifted" ||
            anchorStatus === "orphaned"
        ) {
            conditions.push(eq(documentNotes.anchorStatus, anchorStatus));
        }

        const rows = await db
            .select()
            .from(documentNotes)
            .where(and(...conditions))
            .orderBy(desc(documentNotes.createdAt));

        // When semantic search seeded the result set, restore the relevance
        // ordering rather than the raw createdAt sort.
        const ordered = semanticIds
            ? semanticIds
                  .map(id => rows.find(r => r.id === id))
                  .filter((r): r is (typeof rows)[number] => r !== undefined)
            : rows;

        // Notes are the author's, but an anchored note quotes its document:
        // when the document is outside the scope, so is the note.
        const notes = await filterNotesByDocumentScope(ordered, ctx.data.companyId, scope);

        return NextResponse.json({ notes: notes.map(serializeNote) }, { status: 200 });
    } catch (error) {
        console.error("Error fetching notes:", error);
        return NextResponse.json({ error: "Failed to fetch notes" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const validation = await validateRequestBody(request, CreateNoteSchema);
        if (!validation.success) return validation.response;
        const body = validation.data;

        const scope = await ctx.data.documentScope();
        const target = await validateNoteTarget({
            documentId: body.documentId,
            versionId: body.versionId,
            companyId: ctx.data.companyId,
            scope,
        });
        if (!target.ok) return target.response;

        // Insert, then the post-commit side effects (embedding, wiki links),
        // which log but never fail the save — see ~/server/notes/create-note.
        const note = await createNote(
            {
                authUserId: ctx.data.authUserId,
                companyId: ctx.data.companyId,
                documentId: body.documentId,
                versionId: body.versionId,
                title: body.title,
                content: body.content,
                contentRich: body.contentRich,
                contentMarkdown: body.contentMarkdown,
                anchor: body.anchor,
                anchorStatus: body.anchorStatus,
                tags: body.tags,
            },
            scope
        );

        return NextResponse.json({ note: note ? serializeNote(note) : note }, { status: 201 });
    } catch (error) {
        console.error("Error creating note:", error);
        return NextResponse.json({ error: "Failed to create note" }, { status: 500 });
    }
}
