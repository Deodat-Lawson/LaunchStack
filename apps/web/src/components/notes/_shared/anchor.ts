import type { JSONContent } from "@tiptap/react";

/**
 * Anchor shape the client cares about. Deliberately loose on `primary` so
 * format-specific overlays can extend without forcing a type bump on every
 * surface. See `NoteAnchor` in `@launchstack/core/db/schema/document-notes`
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

export function primaryPageOfAnchor(
  anchor: NoteAnchorLite | null,
): number | null {
  if (!anchor) return null;
  const p = (anchor.primary as { page?: number } | undefined)?.page;
  return typeof p === "number" ? p : null;
}

export function buildAnchorFromDraft(
  draft: DraftState,
): NoteAnchorLite | null {
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
