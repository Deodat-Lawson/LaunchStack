/**
 * Re-anchor sticky notes against a newly-processed document version.
 *
 * Anchors use the W3C Web Annotation pattern: a format-native `primary`
 * plus a durable `quote` (exact text with optional prefix/suffix). When a
 * new version is uploaded, the primary anchor (e.g. page + quads) is
 * almost always invalid — pagination shifts, OCR re-extracts, etc. — but
 * the quoted span usually still exists, possibly in a new location.
 *
 * Strategy per note:
 *   1. Already on the new version → skip (idempotent).
 *   2. Exact ILIKE match against the new version's context chunks → mark
 *      `resolved`, update `primary.page` to the matched chunk's page.
 *   3. Fuzzy match via `diff-match-patch` (the same library Hypothes.is
 *      uses via dom-anchor-text-quote) with a reflow-tolerant threshold
 *      → mark `drifted`, update `primary.page` to the best match.
 *   4. Neither → mark `orphaned`. We DO NOT move the note's versionId in
 *      this case: keeping it pinned to the original version preserves the
 *      truthful statement "this note was written against v3" and lets
 *      future code re-try rehydration against intervening versions.
 *
 * The embedding is regenerated for resolved/drifted notes because
 * `documentNoteEmbeddings.versionId` is a derived field used by retrievers
 * to scope results to the current version.
 */

import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import DiffMatchPatch from "diff-match-patch";

import { db } from "~/server/db";
import {
    documentNotes,
    documentContextChunks,
    type NoteAnchor,
    type AnchorStatus,
} from "@launchstack/core/db/schema";
import { embedNoteAsync } from "./embed-note";

// Fuzzy matcher knobs.
//
//   Match_Threshold lives on [0, 1]: 0 = exact, 1 = anything. 0.3 allows
//   reflow / whitespace changes and minor edits without crossing into
//   "semantically unrelated content" territory.
//
//   Match_Distance is the half-life of the location penalty. Large values
//   make location irrelevant, which is what we want here — the quote may
//   have moved many KB across the doc after re-OCR.
const MATCH_THRESHOLD = 0.3;
const MATCH_DISTANCE = 10_000;

export interface RehydrationResult {
    documentId: number;
    versionId: number;
    considered: number;
    resolved: number;
    drifted: number;
    orphaned: number;
    skipped: number;
}

interface ChunkRow {
    id: number | bigint;
    pageNumber: number | null;
    content: string;
}

/**
 * Run anchor rehydration for every anchored note on a document, against
 * the chunks already ingested for `newVersionId`. Idempotent: re-running
 * after a successful pass is a no-op.
 *
 * Throws if chunks for the target version are not yet in the DB — this
 * signals to the Inngest retry layer that the OCR pipeline hasn't
 * finished, and we should wait.
 */
export async function rehydrateNotesForDocument(
    documentId: number,
    newVersionId: number,
): Promise<RehydrationResult> {
    const notes = await db
        .select()
        .from(documentNotes)
        .where(
            and(
                eq(documentNotes.documentId, String(documentId)),
                isNotNull(documentNotes.anchor),
            ),
        );

    const result: RehydrationResult = {
        documentId,
        versionId: newVersionId,
        considered: notes.length,
        resolved: 0,
        drifted: 0,
        orphaned: 0,
        skipped: 0,
    };

    if (notes.length === 0) return result;

    const chunks = await fetchChunksForVersion(documentId, newVersionId);
    if (chunks.length === 0) {
        // OCR pipeline hasn't populated chunks yet. Let the caller retry.
        throw new Error(
            `[rehydrate] no context chunks for document=${documentId} version=${newVersionId} yet`,
        );
    }

    const dmp = new DiffMatchPatch();
    dmp.Match_Threshold = MATCH_THRESHOLD;
    dmp.Match_Distance = MATCH_DISTANCE;

    const newVersionBig = BigInt(newVersionId);

    for (const note of notes) {
        if (note.versionId === newVersionBig) {
            result.skipped += 1;
            continue;
        }
        const anchor = (note.anchor ?? null) as NoteAnchor | null;
        if (!anchor?.quote?.exact) {
            result.skipped += 1;
            continue;
        }

        const outcome = matchQuoteInChunks(anchor.quote.exact, chunks, dmp);
        const nextAnchor = rebuildAnchor(anchor, outcome);
        const status: AnchorStatus = outcome.kind;

        // Orphaned notes keep their original versionId — the quote no
        // longer lives in this version, so moving them would be a lie.
        // Resolved/drifted advance to the new version.
        const nextVersionId =
            status === "orphaned" ? note.versionId : newVersionBig;

        await db
            .update(documentNotes)
            .set({
                anchor: nextAnchor,
                anchorStatus: status,
                versionId: nextVersionId,
            })
            .where(eq(documentNotes.id, note.id));

        if (status === "resolved") result.resolved += 1;
        else if (status === "drifted") result.drifted += 1;
        else result.orphaned += 1;

        // Re-embed so the vector's versionId tag matches what the note now
        // says. Fire-and-forget — embedding failure must not revert the
        // anchor update.
        embedNoteAsync(note.id);
    }

    return result;
}

async function fetchChunksForVersion(
    documentId: number,
    versionId: number,
): Promise<ChunkRow[]> {
    const rows = await db
        .select({
            id: documentContextChunks.id,
            pageNumber: documentContextChunks.pageNumber,
            content: documentContextChunks.content,
        })
        .from(documentContextChunks)
        .where(
            and(
                eq(documentContextChunks.documentId, BigInt(documentId)),
                eq(documentContextChunks.versionId, BigInt(versionId)),
            ),
        )
        .orderBy(
            asc(documentContextChunks.pageNumber),
            asc(documentContextChunks.id),
        );
    return rows;
}

type MatchOutcome =
    | { kind: "resolved"; chunk: ChunkRow; index: number }
    | { kind: "drifted"; chunk: ChunkRow; index: number }
    | { kind: "orphaned" };

function matchQuoteInChunks(
    quote: string,
    chunks: ChunkRow[],
    dmp: DiffMatchPatch,
): MatchOutcome {
    const normQuote = normalize(quote);
    if (!normQuote) return { kind: "orphaned" };

    // 1) Exact match (cheap, covers most "PDF was re-OCR'd identically"
    //    cases). We normalize whitespace on both sides so line-wrap
    //    differences don't break a match.
    for (const chunk of chunks) {
        const idx = normalize(chunk.content).indexOf(normQuote);
        if (idx >= 0) return { kind: "resolved", chunk, index: idx };
    }

    // 2) Fuzzy match. diff-match-patch's `match_main` uses Bitap with
    //    a score function that blends edit-distance + location penalty.
    //    We scan each chunk with loc=0 (accept match anywhere) and keep
    //    the first chunk that accepts the quote within MATCH_THRESHOLD.
    for (const chunk of chunks) {
        const idx = dmp.match_main(chunk.content, quote, 0);
        if (idx >= 0) return { kind: "drifted", chunk, index: idx };
    }

    return { kind: "orphaned" };
}

function normalize(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

/**
 * Return a new anchor with the `primary` updated to reflect the new
 * version's layout. For PDFs, we update the page number to the matched
 * chunk's page (quads require the viewer; we recompute them when the
 * user next opens the note in a PDF.js-capable renderer).
 */
function rebuildAnchor(
    anchor: NoteAnchor,
    outcome: MatchOutcome,
): NoteAnchor {
    if (outcome.kind === "orphaned") {
        // Drop primary — it no longer points anywhere truthful.
        const { primary: _primary, ...rest } = anchor;
        return rest as NoteAnchor;
    }

    const page = outcome.chunk.pageNumber ?? undefined;
    if (anchor.type === "pdf" && typeof page === "number") {
        return {
            ...anchor,
            primary: { kind: "pdf", page, quads: [] },
        };
    }
    return anchor;
}

/**
 * Wait for at least one context chunk for `(documentId, versionId)` to
 * exist, polling with exponential backoff. Used by the Inngest handler to
 * bridge the gap between the "new version inserted" event and the OCR
 * pipeline actually finishing — without coupling the two functions
 * directly. Returns `true` if chunks appeared, `false` if the budget
 * elapsed.
 */
export async function waitForVersionChunks(
    documentId: number,
    versionId: number,
    opts: { maxWaitMs?: number; initialDelayMs?: number } = {},
): Promise<boolean> {
    const maxWait = opts.maxWaitMs ?? 180_000; // 3 min default
    let delay = opts.initialDelayMs ?? 2_000;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
        const [row] = await db
            .select({ n: sql<number>`count(*)::int` })
            .from(documentContextChunks)
            .where(
                and(
                    eq(documentContextChunks.documentId, BigInt(documentId)),
                    eq(documentContextChunks.versionId, BigInt(versionId)),
                ),
            );
        if ((row?.n ?? 0) > 0) return true;
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 1.6, 15_000);
    }
    return false;
}
