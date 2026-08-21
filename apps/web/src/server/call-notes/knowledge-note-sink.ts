import { and, eq } from "drizzle-orm";

import {
    KnowledgeNoteSchema,
    type KnowledgeNote,
    type KnowledgeNoteSink,
} from "@launchstack/features/call-notes";

import { db } from "~/server/db";
import { callNotesCalls, documentNoteEmbeddings, documentNotes } from "~/server/db/schema";
import { requestNoteEmbedding } from "~/server/notes/embed-note";

type KnowledgeNoteSinkErrorCode =
    | "call_not_found"
    | "document_note_not_found"
    | "wrong_document_note"
    | "wrong_owner"
    | "wrong_company"
    | "stale_revision"
    | "knowledge_disabled"
    | "private_note"
    | "call_not_completed"
    | "content_mismatch"
    | "unsupported_company_id";

export class KnowledgeNoteSinkError extends Error {
    readonly code: KnowledgeNoteSinkErrorCode;

    constructor(code: KnowledgeNoteSinkErrorCode, message: string) {
        super(message);
        this.name = "KnowledgeNoteSinkError";
        this.code = code;
    }
}

export interface KnowledgeCallState {
    id: string;
    companyId: bigint;
    status: "active" | "finalizing" | "completed" | "failed";
    documentNoteId: number | null;
    noteOwnerUserId: string | null;
    noteVisibility: "company" | "private";
    knowledgeIncluded: boolean;
    currentNoteRevision: number;
}

export interface CanonicalDocumentNoteState {
    id: number;
    userId: string;
    companyId: string | null;
    title: string | null;
    content: string | null;
    contentMarkdown: string | null;
}

export interface KnowledgeNoteStore {
    findCall(companyId: bigint, callId: string): Promise<KnowledgeCallState | null>;
    findDocumentNote(documentNoteId: number): Promise<CanonicalDocumentNoteState | null>;
    removeProjection(documentNoteId: number): Promise<void>;
    enqueueEmbedding(documentNoteId: number, companyId: bigint): Promise<void>;
}

class DrizzleKnowledgeNoteStore implements KnowledgeNoteStore {
    async findCall(companyId: bigint, callId: string): Promise<KnowledgeCallState | null> {
        const [call] = await db
            .select({
                id: callNotesCalls.id,
                companyId: callNotesCalls.companyId,
                status: callNotesCalls.status,
                documentNoteId: callNotesCalls.documentNoteId,
                noteOwnerUserId: callNotesCalls.noteOwnerUserId,
                noteVisibility: callNotesCalls.noteVisibility,
                knowledgeIncluded: callNotesCalls.knowledgeIncluded,
                currentNoteRevision: callNotesCalls.currentNoteRevision,
            })
            .from(callNotesCalls)
            .where(and(eq(callNotesCalls.id, callId), eq(callNotesCalls.companyId, companyId)))
            .limit(1);

        return call ?? null;
    }

    async findDocumentNote(documentNoteId: number): Promise<CanonicalDocumentNoteState | null> {
        const [note] = await db
            .select({
                id: documentNotes.id,
                userId: documentNotes.userId,
                companyId: documentNotes.companyId,
                title: documentNotes.title,
                content: documentNotes.content,
                contentMarkdown: documentNotes.contentMarkdown,
            })
            .from(documentNotes)
            .where(eq(documentNotes.id, documentNoteId))
            .limit(1);

        return note ?? null;
    }

    async removeProjection(documentNoteId: number): Promise<void> {
        await db
            .delete(documentNoteEmbeddings)
            .where(eq(documentNoteEmbeddings.noteId, documentNoteId));
    }

    async enqueueEmbedding(documentNoteId: number, companyId: bigint): Promise<void> {
        await requestNoteEmbedding(documentNoteId, "updated", companyId);
    }
}

function canonicalMarkdown(note: CanonicalDocumentNoteState): string {
    return note.contentMarkdown ?? note.content ?? "";
}

function parseSafeCompanyId(value: string): bigint {
    if (!/^\d+$/.test(value)) {
        throw new KnowledgeNoteSinkError(
            "unsupported_company_id",
            "The company id must contain only decimal digits."
        );
    }

    const companyId = BigInt(value);
    const numericCompanyId = Number(companyId);
    if (!Number.isSafeInteger(numericCompanyId) || numericCompanyId <= 0) {
        throw new KnowledgeNoteSinkError(
            "unsupported_company_id",
            "The company id cannot be represented safely by the existing durable event protocol."
        );
    }

    return companyId;
}

function requireEligibleCall(call: KnowledgeCallState, note: KnowledgeNote): void {
    if (call.documentNoteId !== note.documentNoteId) {
        throw new KnowledgeNoteSinkError(
            "wrong_document_note",
            "The supplied document note is not the canonical note for this Call."
        );
    }
    if (call.noteOwnerUserId !== note.ownerUserId) {
        throw new KnowledgeNoteSinkError(
            "wrong_owner",
            "The supplied owner does not own the canonical Call Note."
        );
    }
    if (call.currentNoteRevision !== note.revision) {
        throw new KnowledgeNoteSinkError(
            "stale_revision",
            "The supplied Call Note revision is not current."
        );
    }
    if (!call.knowledgeIncluded) {
        throw new KnowledgeNoteSinkError(
            "knowledge_disabled",
            "Knowledge inclusion is disabled for this Call Note."
        );
    }
    if (call.noteVisibility !== "company") {
        throw new KnowledgeNoteSinkError(
            "private_note",
            "Private Call Notes cannot be included in company knowledge."
        );
    }
    if (call.status !== "completed") {
        throw new KnowledgeNoteSinkError(
            "call_not_completed",
            "Only completed Calls can contribute a Call Note to company knowledge."
        );
    }
}

function requireCanonicalDocumentNote(
    canonical: CanonicalDocumentNoteState,
    note: KnowledgeNote
): void {
    if (canonical.id !== note.documentNoteId) {
        throw new KnowledgeNoteSinkError(
            "wrong_document_note",
            "The supplied document note identity does not match the canonical note."
        );
    }
    if (canonical.userId !== note.ownerUserId) {
        throw new KnowledgeNoteSinkError(
            "wrong_owner",
            "The canonical document note owner does not match the Call Note owner."
        );
    }
    if (canonical.companyId !== note.companyId) {
        throw new KnowledgeNoteSinkError(
            "wrong_company",
            "The canonical document note company does not match the Call company."
        );
    }
    if (
        (canonical.title ?? "") !== note.title ||
        canonicalMarkdown(canonical) !== note.contentMarkdown
    ) {
        throw new KnowledgeNoteSinkError(
            "content_mismatch",
            "The supplied Call Note content is not the current canonical document note content."
        );
    }
}

export class LaunchStackKnowledgeNoteSink implements KnowledgeNoteSink {
    constructor(private readonly store: KnowledgeNoteStore = new DrizzleKnowledgeNoteStore()) {}

    async upsert(input: KnowledgeNote): Promise<void> {
        const note = KnowledgeNoteSchema.parse(input);
        const companyId = parseSafeCompanyId(note.companyId);
        const call = await this.store.findCall(companyId, note.callId);
        if (!call) {
            throw new KnowledgeNoteSinkError(
                "call_not_found",
                "The canonical Call could not be found for this company."
            );
        }

        requireEligibleCall(call, note);

        const canonical = await this.store.findDocumentNote(note.documentNoteId);
        if (!canonical) {
            throw new KnowledgeNoteSinkError(
                "document_note_not_found",
                "The canonical document note could not be found."
            );
        }
        requireCanonicalDocumentNote(canonical, note);

        // Fail closed while durable work is pending: an older projection must
        // not remain retrievable after the canonical revision changes.
        await this.store.removeProjection(note.documentNoteId);
        await this.store.enqueueEmbedding(note.documentNoteId, companyId);
    }

    async remove(companyIdInput: string, callId: string): Promise<void> {
        const companyId = parseSafeCompanyId(companyIdInput);
        const call = await this.store.findCall(companyId, callId);
        if (!call) {
            throw new KnowledgeNoteSinkError(
                "call_not_found",
                "The canonical Call could not be found for this company."
            );
        }

        if (call.documentNoteId !== null) {
            await this.store.removeProjection(call.documentNoteId);
        }
    }
}

export function createKnowledgeNoteSink(store?: KnowledgeNoteStore): KnowledgeNoteSink {
    return new LaunchStackKnowledgeNoteSink(store);
}
