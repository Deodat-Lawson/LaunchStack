import { getTableName, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { callNotesCalls } from "@launchstack/pipelines/call-notes";
import type { document } from "@launchstack/store/schema";

/** Durable provenance for the retrieval copy of a Call Note. */
export const CALL_NOTE_DOCUMENT_MARKER_KEY = "callNote";

export const CALL_NOTE_DOCUMENT_MANAGED_MESSAGE = "Call Note documents are managed from Calls";

export type CallNoteDocumentMarker = {
    [CALL_NOTE_DOCUMENT_MARKER_KEY]: { callId: string };
};

export function callNoteDocumentMarker(input: { callId: string }): CallNoteDocumentMarker {
    return { [CALL_NOTE_DOCUMENT_MARKER_KEY]: { callId: input.callId } };
}

export type CallNoteDocumentProvenance = {
    ocrMetadata?: unknown;
    indexedCallNote?: boolean;
};

/** Select alongside document fields; even lost metadata cannot hide a Call's index copy. */
export function callNoteDocumentReference(
    documentTable: typeof document,
    callsTable: typeof callNotesCalls
): SQL<boolean> {
    const documentName = sql.identifier(getTableName(documentTable));
    const callsName = sql.identifier(getTableName(callsTable));
    return sql<boolean>`EXISTS (
        SELECT 1 FROM ${callsName}
        WHERE ${callsName}.${sql.identifier(callsTable.companyId.name)} = ${documentName}.${sql.identifier(documentTable.companyId.name)}
          AND ${callsName}.${sql.identifier(callsTable.indexedDocumentId.name)} = ${documentName}.${sql.identifier(documentTable.id.name)}
    )`;
}

/** Index ownership follows durable metadata or a Call's document reference. */
export function isCallNoteDocument(doc: CallNoteDocumentProvenance): boolean {
    if (doc.indexedCallNote === true) return true;
    const { ocrMetadata } = doc;
    if (
        !ocrMetadata ||
        typeof ocrMetadata !== "object" ||
        Array.isArray(ocrMetadata) ||
        !(CALL_NOTE_DOCUMENT_MARKER_KEY in ocrMetadata)
    ) {
        return false;
    }
    const marker = ocrMetadata[CALL_NOTE_DOCUMENT_MARKER_KEY];
    if (!marker || typeof marker !== "object" || Array.isArray(marker) || !("callId" in marker)) {
        return false;
    }
    return typeof marker.callId === "string" && marker.callId.length > 0;
}
