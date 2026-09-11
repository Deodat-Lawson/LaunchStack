import {
    deleteSource,
    isMindmapSource,
    isPersistedSource,
    moveSource,
    renameSource,
    sourceKind,
} from "../sourceApi";
import type { WorkspaceSource } from "../types";

/**
 * The adapter is the one place the workspace decides which API a source
 * lives behind. Everything above it — rail, viewer, context menu — calls
 * these with a `WorkspaceSource` and never looks at the id prefix itself, so
 * this is the contract to pin.
 */

function doc(overrides: Partial<WorkspaceSource> = {}): WorkspaceSource {
    return {
        id: "d12",
        documentId: 12,
        title: "Q3 plan.pdf",
        type: "doc",
        size: "",
        added: "",
        folder: "Unfiled",
        tags: [],
        domain: "General",
        ...overrides,
    };
}

function map(overrides: Partial<WorkspaceSource> = {}): WorkspaceSource {
    return {
        id: "m7",
        mindmapId: 7,
        title: "Launch plan",
        type: "mindmap",
        size: "12 shapes",
        added: "",
        folder: "Strategy",
        tags: [],
        domain: "General",
        ...overrides,
    };
}

const fetchMock = jest.fn();

function calls(): { url: string; init: RequestInit | undefined }[] {
    return fetchMock.mock.calls.map(([url, init]) => ({
        url: String(url),
        init: init as RequestInit | undefined,
    }));
}

function body<T>(index: number): T {
    const raw = calls()[index]?.init?.body;
    if (typeof raw !== "string") throw new Error("expected a JSON body");
    return JSON.parse(raw) as T;
}

beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });
});

describe("sourceKind", () => {
    it("tells documents, mindmaps and staged uploads apart", () => {
        expect(sourceKind(doc())).toBe("document");
        expect(sourceKind(map())).toBe("mindmap");
        expect(sourceKind(doc({ id: "s1", documentId: undefined }))).toBe("local");
        expect(isMindmapSource(map())).toBe(true);
        expect(isMindmapSource(doc())).toBe(false);
    });

    it("needs both the prefix and the type before it calls something a mindmap", () => {
        // A document that merely starts with "m" is still a document.
        expect(sourceKind(doc({ id: "m1", type: "doc", documentId: 1 }))).toBe("local");
    });
});

describe("isPersistedSource", () => {
    it("uses the mindmap id for maps and the document id for everything else", () => {
        expect(isPersistedSource(map())).toBe(true);
        expect(isPersistedSource(map({ mindmapId: undefined }))).toBe(false);
        expect(isPersistedSource(doc())).toBe(true);
        expect(isPersistedSource(doc({ documentId: 0 }))).toBe(false);
    });
});

describe("renameSource", () => {
    it("PATCHes the mindmap route for a map", async () => {
        await renameSource(map(), "Launch plan v2");
        expect(calls()[0]?.url).toBe("/api/mindmaps/7");
        expect(calls()[0]?.init?.method).toBe("PATCH");
        expect(body<{ title: string }>(0).title).toBe("Launch plan v2");
    });

    it("PATCHes the document route for an upload", async () => {
        await renameSource(doc(), "Q3 plan (final).pdf");
        expect(calls()[0]?.url).toBe("/api/documents/12");
        expect(body<{ title: string }>(0).title).toBe("Q3 plan (final).pdf");
    });

    it("refuses a source that has no row yet", async () => {
        await expect(renameSource(doc({ id: "s1", documentId: undefined }), "x")).rejects.toThrow(
            /still being added/
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("surfaces the server's message on failure", async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 403,
            json: () => Promise.resolve({ error: "Read-only workspace" }),
        });
        await expect(renameSource(map(), "x")).rejects.toThrow("Read-only workspace");
    });
});

describe("moveSource", () => {
    it("moves a map by folder and a document by category", async () => {
        await moveSource(map(), "Archive");
        await moveSource(doc(), "Archive");
        expect(calls()[0]?.url).toBe("/api/mindmaps/7");
        expect(body<{ folder: string }>(0).folder).toBe("Archive");
        expect(calls()[1]?.url).toBe("/api/documents/12");
        expect(body<{ category: string }>(1).category).toBe("Archive");
    });
});

describe("deleteSource", () => {
    it("soft-deletes a map and hands back a restore", async () => {
        const outcome = await deleteSource(map());
        expect(calls()[0]?.url).toBe("/api/mindmaps/7");
        expect(calls()[0]?.init?.method).toBe("DELETE");
        expect(outcome.restore).toBeDefined();

        await outcome.restore!();
        expect(calls()[1]?.url).toBe("/api/mindmaps/7");
        expect(calls()[1]?.init?.method).toBe("PATCH");
        expect(body<{ restore: boolean }>(1).restore).toBe(true);
    });

    it("hard-deletes a document with nothing to undo", async () => {
        const outcome = await deleteSource(doc());
        expect(calls()[0]?.url).toBe("/api/deleteDocument");
        expect(body<{ docId: string }>(0).docId).toBe("12");
        expect(outcome.restore).toBeUndefined();
    });
});
