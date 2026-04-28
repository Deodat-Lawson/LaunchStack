import type { DocumentNote } from "@launchstack/core/db/schema";

/**
 * `documentNotes.versionId` is a bigint column; JSON.stringify can't serialize
 * bigints, so coerce it to a JSON-safe number before returning a note over the
 * wire. The frontend already types `versionId` as `number | null`.
 */
export function serializeNote(note: DocumentNote) {
  return {
    ...note,
    versionId: note.versionId !== null ? Number(note.versionId) : null,
  };
}
