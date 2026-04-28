/**
 * Wiki-link plumbing for Studio - Notes.
 *
 * Notes can reference each other (and documents) via `[[Wiki Link]]` syntax
 * inside the Tiptap content. We extract those references on every save and
 * upsert rows in `note_links` so:
 *   1. The Backlinks panel can show incoming references for any note/doc.
 *   2. Renames re-resolve cheaply (we keep the literal title we matched).
 *
 * Resolution is best-effort and scoped by `companyId` to avoid cross-tenant
 * leakage. Unresolved references (`[[Title]]` with no matching note/doc)
 * are still persisted with `targetTitle` only — the UI shows them as broken
 * links.
 */

import { sql, and, eq, inArray, isNull, or } from "drizzle-orm";
import type { JSONContent } from "@tiptap/react";

import { db } from "~/server/db";
import {
  documentNotes,
  noteLinks,
  type NoteLinkTargetType,
} from "@launchstack/core/db/schema/document-notes";
import { document, users } from "@launchstack/core/db/schema/base";

/**
 * Match the GitHub/Notion-flavored `[[Wiki Link]]` syntax. Permits any
 * non-bracket content of length 1..200 — long enough for document titles,
 * short enough to keep a single line readable.
 */
const WIKI_LINK_RE = /\[\[([^\[\]\n]{1,200})\]\]/g;

export interface WikiLinkRef {
  /** Raw label between the double brackets, trimmed. */
  title: string;
}

export function extractWikiLinks(rich: JSONContent | null | undefined): WikiLinkRef[] {
  if (!rich) return [];
  const seen = new Set<string>();
  const out: WikiLinkRef[] = [];

  const walk = (node: JSONContent) => {
    if (!node) return;
    if (node.type === "text" && typeof node.text === "string") {
      let m: RegExpExecArray | null;
      WIKI_LINK_RE.lastIndex = 0;
      while ((m = WIKI_LINK_RE.exec(node.text)) !== null) {
        const title = m[1]?.trim();
        if (!title || seen.has(title.toLowerCase())) continue;
        seen.add(title.toLowerCase());
        out.push({ title });
      }
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(rich);
  return out;
}

interface ResolveCtx {
  companyId: string | null;
  /** Excluded from match — prevents a note from linking to itself. */
  selfNoteId?: number;
}

interface ResolvedRef {
  title: string;
  targetType: NoteLinkTargetType;
  targetNoteId: number | null;
  targetDocumentId: string | null;
}

/**
 * Resolve a batch of `[[Title]]` references against the company's notes
 * and documents. Documents take precedence — they're the more public,
 * stable target. Falls back to a note title match. Unresolved refs are
 * returned with `targetType: "note"` and both ids null.
 */
async function resolveRefs(
  refs: WikiLinkRef[],
  ctx: ResolveCtx,
): Promise<ResolvedRef[]> {
  if (refs.length === 0) return [];
  const titles = refs.map((r) => r.title);
  const titleLower = titles.map((t) => t.toLowerCase());

  const docMatches = ctx.companyId
    ? await db
        .select({ id: document.id, title: document.title })
        .from(document)
        .where(
          and(
            eq(document.companyId, BigInt(ctx.companyId)),
            // varchar lower(title) match
            inArray(sql<string>`lower(${document.title})`, titleLower),
          ),
        )
    : [];

  const noteMatches = await db
    .select({ id: documentNotes.id, title: documentNotes.title })
    .from(documentNotes)
    .where(
      and(
        ctx.companyId
          ? eq(documentNotes.companyId, ctx.companyId)
          : isNull(documentNotes.companyId),
        inArray(sql<string>`lower(${documentNotes.title})`, titleLower),
      ),
    );

  const docByTitle = new Map<string, number>();
  for (const d of docMatches) {
    if (d.title) docByTitle.set(d.title.toLowerCase(), d.id);
  }
  const noteByTitle = new Map<string, number>();
  for (const n of noteMatches) {
    if (n.title && n.id !== ctx.selfNoteId)
      noteByTitle.set(n.title.toLowerCase(), n.id);
  }

  return refs.map((r) => {
    const lower = r.title.toLowerCase();
    const docId = docByTitle.get(lower);
    if (docId !== undefined) {
      return {
        title: r.title,
        targetType: "document" as const,
        targetNoteId: null,
        targetDocumentId: String(docId),
      };
    }
    const noteId = noteByTitle.get(lower);
    if (noteId !== undefined) {
      return {
        title: r.title,
        targetType: "note" as const,
        targetNoteId: noteId,
        targetDocumentId: null,
      };
    }
    return {
      title: r.title,
      targetType: "note" as const,
      targetNoteId: null,
      targetDocumentId: null,
    };
  });
}

interface SyncArgs {
  noteId: number;
  rich: JSONContent | null | undefined;
  companyId: string | null;
}

/**
 * Replace the link rows for `noteId` with the references currently present
 * in `rich`. Idempotent: passing the same content twice is a no-op modulo
 * timestamps.
 */
export async function syncNoteLinks(args: SyncArgs): Promise<void> {
  const refs = extractWikiLinks(args.rich);
  const resolved = await resolveRefs(refs, {
    companyId: args.companyId,
    selfNoteId: args.noteId,
  });

  await db
    .delete(noteLinks)
    .where(eq(noteLinks.sourceNoteId, args.noteId));

  if (resolved.length === 0) return;

  await db.insert(noteLinks).values(
    resolved.map((r) => ({
      sourceNoteId: args.noteId,
      targetType: r.targetType,
      targetNoteId: r.targetNoteId,
      targetDocumentId: r.targetDocumentId,
      targetTitle: r.title,
      resolvedAt:
        r.targetNoteId !== null || r.targetDocumentId !== null
          ? new Date()
          : null,
      companyId: args.companyId,
    })),
  );
}

/**
 * Resolve the user's `companyId` from the auth user id. Returns it as a
 * stringified bigint to match the varchar shape stored on note rows.
 */
export async function getCompanyIdForUser(
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ companyId: users.companyId })
    .from(users)
    .where(eq(users.userId, userId))
    .limit(1);
  return row?.companyId !== undefined && row.companyId !== null
    ? String(row.companyId)
    : null;
}

/**
 * Resolve a single `[[Title]]` for the typeahead picker. Returns the top
 * candidates ordered: documents first (more durable), then notes. Both are
 * scoped by the user's `companyId`.
 */
export async function searchWikiLinkCandidates(
  title: string,
  ctx: { companyId: string | null; userId: string; limit?: number },
): Promise<
  Array<
    | {
        targetType: "document";
        targetDocumentId: string;
        title: string;
      }
    | { targetType: "note"; targetNoteId: number; title: string }
  >
> {
  const trimmed = title.trim();
  if (!trimmed) return [];
  const limit = ctx.limit ?? 8;
  const pattern = `%${trimmed}%`;

  const docs = ctx.companyId
    ? await db
        .select({ id: document.id, title: document.title })
        .from(document)
        .where(
          and(
            eq(document.companyId, BigInt(ctx.companyId)),
            sql<boolean>`${document.title} ILIKE ${pattern}`,
          ),
        )
        .limit(limit)
    : [];

  const notes = await db
    .select({ id: documentNotes.id, title: documentNotes.title })
    .from(documentNotes)
    .where(
      and(
        or(
          ctx.companyId
            ? eq(documentNotes.companyId, ctx.companyId)
            : undefined,
          eq(documentNotes.userId, ctx.userId),
        ),
        sql<boolean>`${documentNotes.title} ILIKE ${pattern}`,
      ),
    )
    .limit(limit);

  return [
    ...docs.map(
      (d) =>
        ({
          targetType: "document" as const,
          targetDocumentId: String(d.id),
          title: d.title,
        }) as const,
    ),
    ...notes
      .filter((n): n is { id: number; title: string } => n.title !== null)
      .map(
        (n) =>
          ({
            targetType: "note" as const,
            targetNoteId: n.id,
            title: n.title,
          }) as const,
      ),
  ].slice(0, limit);
}
