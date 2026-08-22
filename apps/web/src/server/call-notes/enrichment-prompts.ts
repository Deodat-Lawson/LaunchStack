import {
    CALL_NOTES_ENRICHMENT_SCHEMA_VERSION,
    EnrichmentInputSchema,
    type EnrichmentInput,
} from "@launchstack/features/call-notes";

export const CALL_NOTES_ENRICHMENT_PROMPT_VERSION = "call-notes-enrichment-generation/v1" as const;

export const CALL_NOTES_ENRICHMENT_SYSTEM_PROMPT = `You generate a separate structured Call Note enrichment proposal from the supplied evidence. Return the frozen call-notes-enrichment/v1 proposal shape only. Never overwrite or represent the owner-authored current Call Note as model-authored truth.

The owner-authored current Call Note is source context whose intent and wording must be preserved unless the finalized Transcript provides clear contrary evidence. Finalized immutable Transcript segments are the only factual meeting evidence. Bookmarks identify important Transcript segments, and Bookmark user guidance is strong user steering about emphasis; guidance is not independent evidence and cannot support a claim beyond its linked segment.

Never invent decisions, action items, owners, deadlines, speakers, quotations, Bookmark IDs, or Transcript segment IDs. Do not turn uncertain discussion, suggestions, questions, or possibilities into confirmed outcomes. If an owner or deadline is not explicit in an available Transcript segment, use null. Identify conflicts between owner-authored notes and Transcript evidence instead of silently choosing a version.

Transcript gaps mean evidence is unavailable. Never infer, reconstruct, summarize, or bridge content that may have occurred during a gap. Do not use surrounding segments to claim what happened inside a gap.

Every bookmarkPassages citation must exactly copy a supplied Bookmark ID, its linked Transcript segment ID, that segment's speakerName, and that segment's providerStartMs. Omit unsupported claims rather than weakening, guessing, or fabricating provenance.`;

/** Canonical, stable serialization over the frozen enrichment input. */
export function buildCallNotesEnrichmentPrompt(rawInput: EnrichmentInput): string {
    const input = EnrichmentInputSchema.parse(rawInput);

    return JSON.stringify(
        sortObjectKeysRecursively({
            promptVersion: CALL_NOTES_ENRICHMENT_PROMPT_VERSION,
            outputSchemaVersion: CALL_NOTES_ENRICHMENT_SCHEMA_VERSION,
            callId: input.callId,
            transcriptFingerprint: input.transcriptFingerprint,
            currentOwnerCallNote: {
                sourceRole: "owner-authored current Call Note",
                documentNoteId: input.note.documentNoteId,
                ownerUserId: input.note.ownerUserId,
                visibility: input.note.visibility,
                revision: input.note.revision,
                title: input.note.title,
                contentMarkdown: input.note.contentMarkdown,
                contentRich: input.note.contentRich,
            },
            finalizedTranscript: {
                sourceRole: "finalized immutable Transcript evidence",
                segments: input.transcript,
            },
            transcriptGaps: input.gaps.map(gap => ({
                ...gap,
                evidenceAvailability: "unavailable",
                instruction: "Do not infer or reconstruct content during this gap.",
            })),
            bookmarks: input.bookmarks.map(bookmark => ({
                bookmarkId: bookmark.id,
                linkedTranscriptSegmentId: bookmark.segmentId,
                createdAt: bookmark.createdAt,
                userGuidance: bookmark.comment,
                guidanceRole: "strong user steering, not independent factual evidence",
            })),
            generationMode: "create a separate proposal; do not overwrite the current Call Note",
        })
    );
}

/** Sort object keys recursively while retaining the exact supplied order of arrays. */
function sortObjectKeysRecursively(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortObjectKeysRecursively);
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.keys(value as Record<string, unknown>)
                .sort()
                .map(key => [
                    key,
                    sortObjectKeysRecursively((value as Record<string, unknown>)[key]),
                ])
        );
    }
    return value;
}
