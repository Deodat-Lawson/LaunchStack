/**
 * Markdown rendering of a normalized session.
 *
 * The rendered document is what gets chunked and embedded, so its structure is
 * retrieval-facing: `##` headings per speaker turn line up with the
 * heading-aware chunker, and the provenance header travels in the text itself —
 * retrieval sees chunks, not documents, so a chunk has to carry its own origin.
 */
import { type NormalizedSession } from "./types.js";
export declare function sessionDisplayTitle(session: NormalizedSession, fallbackId: string): string;
/**
 * The rendered text is what gets content-hashed for change detection, so
 * nothing sync-dependent (like a synced-at stamp) may appear in it — only
 * facts about the session itself. Sync timestamps live in the sink's metadata.
 */
export declare function renderSessionMarkdown(session: NormalizedSession, options: {
    readonly title: string;
}): string;
//# sourceMappingURL=render.d.ts.map