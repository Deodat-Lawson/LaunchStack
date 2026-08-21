import type { KnowledgeNote } from "@launchstack/features/call-notes";

jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/server/notes/embed-note", () => ({ requestNoteEmbedding: jest.fn() }));

import {
    createKnowledgeNoteSink,
    type CanonicalDocumentNoteState,
    type KnowledgeCallState,
    type KnowledgeNoteStore,
} from "~/server/call-notes/knowledge-note-sink";

const COMPANY_ID = 42n;
const CALL_ID = "call-42";
const NOTE_ID = 314;

function knowledgeNote(overrides: Partial<KnowledgeNote> = {}): KnowledgeNote {
    return {
        companyId: COMPANY_ID.toString(),
        callId: CALL_ID,
        documentNoteId: NOTE_ID,
        ownerUserId: "user-owner",
        revision: 3,
        title: "Founder sync",
        contentMarkdown: "## Canonical owner note\n\nApproved outcome.",
        deepLink: "/calls/call-42",
        ...overrides,
    };
}

function callState(overrides: Partial<KnowledgeCallState> = {}): KnowledgeCallState {
    return {
        id: CALL_ID,
        companyId: COMPANY_ID,
        status: "completed",
        documentNoteId: NOTE_ID,
        noteOwnerUserId: "user-owner",
        noteVisibility: "company",
        knowledgeIncluded: true,
        currentNoteRevision: 3,
        ...overrides,
    };
}

function documentNote(
    overrides: Partial<CanonicalDocumentNoteState> = {}
): CanonicalDocumentNoteState {
    return {
        id: NOTE_ID,
        userId: "user-owner",
        companyId: COMPANY_ID.toString(),
        title: "Founder sync",
        content: null,
        contentMarkdown: "## Canonical owner note\n\nApproved outcome.",
        ...overrides,
    };
}

class FakeKnowledgeNoteStore implements KnowledgeNoteStore {
    call: KnowledgeCallState | null = callState();
    note: CanonicalDocumentNoteState | null = documentNote();
    projectionPresent = true;
    readonly operations: string[] = [];
    readonly embeddingRequests: Array<{ noteId: number; companyId: bigint }> = [];

    async findCall(companyId: bigint, callId: string): Promise<KnowledgeCallState | null> {
        this.operations.push(`find-call:${companyId}:${callId}`);
        if (this.call?.companyId !== companyId || this.call.id !== callId) return null;
        return this.call;
    }

    async findDocumentNote(documentNoteId: number): Promise<CanonicalDocumentNoteState | null> {
        this.operations.push(`find-note:${documentNoteId}`);
        return this.note?.id === documentNoteId ? this.note : null;
    }

    async removeProjection(documentNoteId: number): Promise<void> {
        this.operations.push(`remove-projection:${documentNoteId}`);
        this.projectionPresent = false;
    }

    async enqueueEmbedding(documentNoteId: number, companyId: bigint): Promise<void> {
        this.operations.push(`enqueue:${documentNoteId}:${companyId}`);
        this.embeddingRequests.push({ noteId: documentNoteId, companyId });
    }
}

describe("LaunchStackKnowledgeNoteSink", () => {
    it("removes the stale projection and enqueues the current accepted Call Note", async () => {
        const store = new FakeKnowledgeNoteStore();
        const sink = createKnowledgeNoteSink(store);

        await sink.upsert(knowledgeNote());

        expect(store.operations).toEqual([
            "find-call:42:call-42",
            "find-note:314",
            "remove-projection:314",
            "enqueue:314:42",
        ]);
        expect(store.projectionPresent).toBe(false);
        expect(store.embeddingRequests).toEqual([{ noteId: NOTE_ID, companyId: COMPANY_ID }]);
    });

    it("rejects knowledge inclusion when the default-off flag is false", async () => {
        const store = new FakeKnowledgeNoteStore();
        store.call = callState({ knowledgeIncluded: false });

        await expect(createKnowledgeNoteSink(store).upsert(knowledgeNote())).rejects.toMatchObject({
            code: "knowledge_disabled",
        });
        expect(store.embeddingRequests).toHaveLength(0);
    });

    it("rejects a private Call Note", async () => {
        const store = new FakeKnowledgeNoteStore();
        store.call = callState({ noteVisibility: "private" });

        await expect(createKnowledgeNoteSink(store).upsert(knowledgeNote())).rejects.toMatchObject({
            code: "private_note",
        });
    });

    it.each(["active", "finalizing", "failed"] as const)(
        "rejects an ineligible %s Call",
        async status => {
            const store = new FakeKnowledgeNoteStore();
            store.call = callState({ status });

            await expect(
                createKnowledgeNoteSink(store).upsert(knowledgeNote())
            ).rejects.toMatchObject({ code: "call_not_completed" });
        }
    );

    it("rejects a stale canonical revision", async () => {
        const store = new FakeKnowledgeNoteStore();
        store.call = callState({ currentNoteRevision: 4 });

        await expect(createKnowledgeNoteSink(store).upsert(knowledgeNote())).rejects.toMatchObject({
            code: "stale_revision",
        });
    });

    it("fails closed for the wrong company", async () => {
        const store = new FakeKnowledgeNoteStore();

        await expect(
            createKnowledgeNoteSink(store).upsert(knowledgeNote({ companyId: "99" }))
        ).rejects.toMatchObject({ code: "call_not_found" });
    });

    it("rejects a company id that cannot round-trip through the durable event protocol", async () => {
        const store = new FakeKnowledgeNoteStore();

        await expect(
            createKnowledgeNoteSink(store).upsert(knowledgeNote({ companyId: "9007199254740993" }))
        ).rejects.toMatchObject({ code: "unsupported_company_id" });
        expect(store.operations).toHaveLength(0);
    });

    it("rejects the wrong owner at both Call and document-note identity seams", async () => {
        const callStore = new FakeKnowledgeNoteStore();
        callStore.call = callState({ noteOwnerUserId: "someone-else" });
        await expect(
            createKnowledgeNoteSink(callStore).upsert(knowledgeNote())
        ).rejects.toMatchObject({ code: "wrong_owner" });

        const documentStore = new FakeKnowledgeNoteStore();
        documentStore.note = documentNote({ userId: "someone-else" });
        await expect(
            createKnowledgeNoteSink(documentStore).upsert(knowledgeNote())
        ).rejects.toMatchObject({ code: "wrong_owner" });
    });

    it("rejects a document note that is not the Call's canonical note", async () => {
        const store = new FakeKnowledgeNoteStore();

        await expect(
            createKnowledgeNoteSink(store).upsert(knowledgeNote({ documentNoteId: 999 }))
        ).rejects.toMatchObject({ code: "wrong_document_note" });
    });

    it("rejects stale payload content before enqueueing", async () => {
        const store = new FakeKnowledgeNoteStore();

        await expect(
            createKnowledgeNoteSink(store).upsert(
                knowledgeNote({ contentMarkdown: "A stale accepted proposal" })
            )
        ).rejects.toMatchObject({ code: "content_mismatch" });
        expect(store.embeddingRequests).toHaveLength(0);
    });

    it("rejects a missing canonical document note and a document-note company mismatch", async () => {
        const missingStore = new FakeKnowledgeNoteStore();
        missingStore.note = null;
        await expect(
            createKnowledgeNoteSink(missingStore).upsert(knowledgeNote())
        ).rejects.toMatchObject({ code: "document_note_not_found" });

        const wrongCompanyStore = new FakeKnowledgeNoteStore();
        wrongCompanyStore.note = documentNote({ companyId: "99" });
        await expect(
            createKnowledgeNoteSink(wrongCompanyStore).upsert(knowledgeNote())
        ).rejects.toMatchObject({ code: "wrong_company" });
    });

    it("remove deletes only the retrieval projection", async () => {
        const store = new FakeKnowledgeNoteStore();
        const originalCall = structuredClone(store.call);
        const originalNote = structuredClone(store.note);

        await createKnowledgeNoteSink(store).remove(COMPANY_ID.toString(), CALL_ID);

        expect(store.projectionPresent).toBe(false);
        expect(store.call).toEqual(originalCall);
        expect(store.note).toEqual(originalNote);
        expect(store.embeddingRequests).toHaveLength(0);
    });

    it("does not send Transcript, Bookmark, or proposal content into the embedding request", async () => {
        const store = new FakeKnowledgeNoteStore();

        await createKnowledgeNoteSink(store).upsert(knowledgeNote());

        expect(store.embeddingRequests).toEqual([{ noteId: NOTE_ID, companyId: COMPANY_ID }]);
        expect(Object.keys(store.embeddingRequests[0] ?? {})).toEqual(["noteId", "companyId"]);
    });

    it("does not mutate Call lifecycle or canonical document-note state", async () => {
        const store = new FakeKnowledgeNoteStore();
        const originalCall = structuredClone(store.call);
        const originalNote = structuredClone(store.note);

        await createKnowledgeNoteSink(store).upsert(knowledgeNote());

        expect(store.call).toEqual(originalCall);
        expect(store.note).toEqual(originalNote);
    });

    it("stays fail closed when durable enqueue fails after projection removal", async () => {
        const store = new FakeKnowledgeNoteStore();
        store.enqueueEmbedding = jest.fn().mockRejectedValue(new Error("outbox unavailable"));

        await expect(createKnowledgeNoteSink(store).upsert(knowledgeNote())).rejects.toThrow(
            "outbox unavailable"
        );
        expect(store.projectionPresent).toBe(false);
    });
});
