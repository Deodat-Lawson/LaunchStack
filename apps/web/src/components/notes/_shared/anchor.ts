import type { JSONContent } from "@tiptap/react";

/**
 * Anchor shape the client cares about. Deliberately loose on `primary` so
 * format-specific overlays can extend without forcing a type bump on every
 * surface. See `NoteAnchor` in `~/server/db/schema`
 * for the full server-side shape.
 */
export type NoteAnchorLite = {
    type: "pdf" | "docx" | "media" | "image" | "code" | "markdown" | "text";
    primary?: unknown;
    quote: { exact: string; prefix?: string; suffix?: string };
    chunkIdAtCreate?: number;
};

export interface PrefilledAnchor {
    /** Page number (1-indexed). */
    page: number;
    /** Normalized quads in [0, 1] space, first is the "headline" box. */
    quads: Array<[number, number, number, number]>;
    /** Exact quoted span. Prefix/suffix may be empty initially. */
    quote: { exact: string; prefix?: string; suffix?: string };
}

export type DraftState = {
    id: number | "new" | null;
    title: string;
    rich: JSONContent | null;
    text: string;
    tags: string[];
    anchorQuote: string;
    anchorPage: string;
    /** Captured quads from PDF selection; empty when user typed the anchor manually. */
    anchorQuads: Array<[number, number, number, number]>;
};

export const EMPTY_DRAFT: DraftState = {
    id: null,
    title: "",
    rich: null,
    text: "",
    tags: [],
    anchorQuote: "",
    anchorPage: "",
    anchorQuads: [],
};

export function primaryPageOfAnchor(anchor: NoteAnchorLite | null): number | null {
    if (!anchor) return null;
    const p = (anchor.primary as { page?: number } | undefined)?.page;
    return typeof p === "number" ? p : null;
}

export function buildAnchorFromDraft(draft: DraftState): NoteAnchorLite | null {
    const exact = draft.anchorQuote.trim();
    if (!exact) return null;
    const pageNum = Number.parseInt(draft.anchorPage, 10);
    const primary =
        Number.isFinite(pageNum) && pageNum > 0
            ? {
                  kind: "pdf" as const,
                  page: pageNum,
                  quads: draft.anchorQuads,
              }
            : undefined;
    return {
        type: primary ? "pdf" : "text",
        primary,
        quote: { exact },
    };
}

/**
 * Where a note sits in the document, when that is actually known.
 *
 * `page` alone is not a position: indexing stores page 1 for every chunk, so
 * an agent-captured note's anchor says page 1 with no quads and means
 * nothing. Only a real selection carries quads, and only then can a note be
 * placed. Returning null for the rest is what keeps the ordering honest.
 */
export function documentPositionOfAnchor(
    anchor: NoteAnchorLite | null
): { page: number; top: number } | null {
    const primary = anchor?.primary as
        | { page?: number; quads?: Array<[number, number, number, number]> }
        | undefined;
    const page = primary?.page;
    const first = primary?.quads?.[0];
    if (typeof page !== "number" || !first) return null;
    return { page, top: first[1] };
}

/**
 * Order notes the way a reader meets them, the way Docs orders comments.
 *
 * Notes with a real position come first in document order. Everything else
 * keeps newest-first, because a note with no position has no place in the
 * reading order and inventing one would only look meaningful. Today every
 * agent-captured note lands in that second group, so this is a no-op until
 * anchors carry real quads — which is the point: it is already right when
 * they do.
 */
export function orderNotesForReading<
    T extends { anchor: unknown; createdAt?: Date | string | null },
>(notes: T[]): T[] {
    const at = (n: T) => {
        const raw = n.createdAt;
        if (!raw) return 0;
        return raw instanceof Date ? raw.getTime() : Date.parse(raw) || 0;
    };
    const positioned: Array<{ note: T; pos: { page: number; top: number } }> = [];
    const loose: T[] = [];

    for (const note of notes) {
        const pos = documentPositionOfAnchor(note.anchor as NoteAnchorLite | null);
        if (pos) positioned.push({ note, pos });
        else loose.push(note);
    }

    positioned.sort((a, b) =>
        a.pos.page !== b.pos.page ? a.pos.page - b.pos.page : a.pos.top - b.pos.top
    );
    loose.sort((a, b) => at(b) - at(a));

    return [...positioned.map(p => p.note), ...loose];
}
