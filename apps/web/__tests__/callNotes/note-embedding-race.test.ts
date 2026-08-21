jest.mock("~/server/db", () => ({ db: {} }));

import {
    embedNoteWithDependencies,
    evaluateEmbeddingFreshness,
    type CallNoteEmbeddingState,
    type NoteEmbeddingProjection,
    type NoteEmbeddingCleanupResult,
    type NoteEmbeddingSnapshot,
    type NoteEmbeddingStore,
    type NoteEmbeddingWriteResult,
} from "~/server/notes/embed-note";
import type { NoteEmbeddingRuntime } from "~/server/notes/embedding-config";

const NOTE_ID = 77;

function callState(overrides: Partial<CallNoteEmbeddingState> = {}): CallNoteEmbeddingState {
    return {
        id: "call-77",
        companyId: 42n,
        status: "completed",
        documentNoteId: NOTE_ID,
        noteOwnerUserId: "owner-77",
        noteVisibility: "company",
        knowledgeIncluded: true,
        currentNoteRevision: 2,
        ...overrides,
    };
}

function snapshot(
    overrides: Partial<NoteEmbeddingSnapshot["note"]> = {},
    call: CallNoteEmbeddingState | null = callState()
): NoteEmbeddingSnapshot {
    return {
        note: {
            id: NOTE_ID,
            userId: "owner-77",
            companyId: "42",
            documentId: null,
            versionId: null,
            title: "Canonical Call Note",
            content: null,
            contentMarkdown: "Current accepted note",
            anchor: null,
            createdAt: new Date("2026-08-21T00:00:00.000Z"),
            updatedAt: new Date("2026-08-21T00:02:00.000Z"),
            ...overrides,
        },
        call,
    };
}

class InMemoryEmbeddingStore implements NoteEmbeddingStore {
    current: NoteEmbeddingSnapshot | null;
    projections: NoteEmbeddingProjection[] = [
        {
            content: "previous",
            tokenCount: 2,
            embedding: [0, 0, 0],
            embeddingShort: [0, 0],
            modelVersion: "old",
        },
    ];
    removeCount = 0;
    beforeGuardedRemove?: () => void;
    private replacementQueue: Promise<void> = Promise.resolve();

    constructor(current: NoteEmbeddingSnapshot | null) {
        this.current = structuredClone(current);
    }

    async loadSnapshot(): Promise<NoteEmbeddingSnapshot | null> {
        return structuredClone(this.current);
    }

    async removeProjection(): Promise<void> {
        this.removeCount += 1;
        this.projections = [];
    }

    async removeIfCurrent(expected: NoteEmbeddingSnapshot): Promise<NoteEmbeddingCleanupResult> {
        this.beforeGuardedRemove?.();
        const freshness = evaluateEmbeddingFreshness(expected, this.current);
        if (freshness === "stale") return "stale";
        this.removeCount += 1;
        this.projections = [];
        return freshness === "missing" ? "missing" : "removed";
    }

    async replaceIfCurrent(
        expected: NoteEmbeddingSnapshot,
        projection: NoteEmbeddingProjection
    ): Promise<NoteEmbeddingWriteResult> {
        let result: NoteEmbeddingWriteResult = "missing";
        const previous = this.replacementQueue;
        let release: () => void = () => undefined;
        this.replacementQueue = new Promise<void>(resolve => {
            release = resolve;
        });
        await previous;
        try {
            result = evaluateEmbeddingFreshness(expected, this.current);
            if (result === "written") {
                this.projections = [projection];
            } else if (
                result !== "stale" ||
                expected.call !== null ||
                this.current?.call !== null
            ) {
                this.projections = [];
            }
            return result;
        } finally {
            release();
        }
    }
}

function runtime(onEmbed?: () => void): NoteEmbeddingRuntime {
    return {
        index: {
            indexKey: "test-note-index",
            model: "test-note-model",
            dimension: 3,
            shortDimension: 2,
            version: "test",
        },
        embeddings: {
            embedQuery: async () => [1, 2, 3],
            embedDocuments: async () => {
                onEmbed?.();
                return [[1, 2, 3]];
            },
        },
    };
}

describe("Call Note embedding final revalidation", () => {
    it("does not restore a projection after knowledge inclusion is turned off", async () => {
        const store = new InMemoryEmbeddingStore(snapshot());

        const result = await embedNoteWithDependencies(NOTE_ID, {
            store,
            runtime: runtime(() => {
                if (store.current?.call) store.current.call.knowledgeIncluded = false;
            }),
        });

        expect(result).toBe("ineligible");
        expect(store.projections).toEqual([]);
    });

    it("does not restore a projection after visibility becomes private", async () => {
        const store = new InMemoryEmbeddingStore(snapshot());

        const result = await embedNoteWithDependencies(NOTE_ID, {
            store,
            runtime: runtime(() => {
                if (store.current?.call) store.current.call.noteVisibility = "private";
            }),
        });

        expect(result).toBe("ineligible");
        expect(store.projections).toEqual([]);
    });

    it("prevents an old Call Note revision from overwriting the current revision", async () => {
        const store = new InMemoryEmbeddingStore(snapshot());

        const result = await embedNoteWithDependencies(NOTE_ID, {
            store,
            runtime: runtime(() => {
                if (store.current?.call) store.current.call.currentNoteRevision = 3;
            }),
        });

        expect(result).toBe("stale");
        expect(store.projections).toEqual([]);
    });

    it("suppresses a vector when canonical content changes during embedding", async () => {
        const store = new InMemoryEmbeddingStore(snapshot());

        const result = await embedNoteWithDependencies(NOTE_ID, {
            store,
            runtime: runtime(() => {
                if (store.current) {
                    store.current.note.contentMarkdown = "Newer canonical content";
                    store.current.note.updatedAt = new Date("2026-08-21T00:03:00.000Z");
                }
            }),
        });

        expect(result).toBe("stale");
        expect(store.projections).toEqual([]);
    });

    it("preserves ordinary non-Call note embedding behavior", async () => {
        const store = new InMemoryEmbeddingStore(snapshot({}, null));

        const result = await embedNoteWithDependencies(NOTE_ID, { store, runtime: runtime() });

        expect(result).toBe("written");
        expect(store.projections).toHaveLength(1);
        expect(store.projections[0]).toMatchObject({
            content: "Canonical Call Note\n\nCurrent accepted note",
            embedding: [1, 2, 3],
            embeddingShort: [1, 2],
            modelVersion: "test-note-model",
        });
    });

    it("serializes concurrent replacements into one effective projection", async () => {
        const store = new InMemoryEmbeddingStore(snapshot());

        const results = await Promise.all([
            embedNoteWithDependencies(NOTE_ID, { store, runtime: runtime() }),
            embedNoteWithDependencies(NOTE_ID, { store, runtime: runtime() }),
        ]);

        expect(results).toEqual(["written", "written"]);
        expect(store.projections).toHaveLength(1);
    });

    it("removes an already projected Call Note when the delayed job starts ineligible", async () => {
        const store = new InMemoryEmbeddingStore(
            snapshot({}, callState({ knowledgeIncluded: false }))
        );

        const result = await embedNoteWithDependencies(NOTE_ID, { store, runtime: runtime() });

        expect(result).toBe("ineligible");
        expect(store.removeCount).toBe(1);
        expect(store.projections).toEqual([]);
    });

    it("does not let stale ineligible cleanup erase a newly eligible projection", async () => {
        const store = new InMemoryEmbeddingStore(
            snapshot({}, callState({ knowledgeIncluded: false }))
        );
        store.beforeGuardedRemove = () => {
            if (store.current?.call) store.current.call.knowledgeIncluded = true;
            store.projections = [
                {
                    content: "new eligible projection",
                    tokenCount: 5,
                    embedding: [3, 2, 1],
                    embeddingShort: [3, 2],
                    modelVersion: "new",
                },
            ];
        };

        const result = await embedNoteWithDependencies(NOTE_ID, { store, runtime: runtime() });

        expect(result).toBe("stale");
        expect(store.projections).toHaveLength(1);
        expect(store.projections[0]?.content).toBe("new eligible projection");
    });

    it("does not let stale empty-content cleanup erase a newer ordinary-note projection", async () => {
        const store = new InMemoryEmbeddingStore(
            snapshot({ title: null, contentMarkdown: "" }, null)
        );
        store.beforeGuardedRemove = () => {
            if (store.current) {
                store.current.note.contentMarkdown = "new ordinary note content";
                store.current.note.updatedAt = new Date("2026-08-21T00:04:00.000Z");
            }
            store.projections = [
                {
                    content: "new ordinary note content",
                    tokenCount: 5,
                    embedding: [3, 2, 1],
                    embeddingShort: [3, 2],
                    modelVersion: "new",
                },
            ];
        };

        const result = await embedNoteWithDependencies(NOTE_ID, { store, runtime: runtime() });

        expect(result).toBe("stale");
        expect(store.projections[0]?.content).toBe("new ordinary note content");
    });
});
