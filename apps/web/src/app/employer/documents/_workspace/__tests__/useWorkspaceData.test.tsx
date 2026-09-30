/** @jest-environment jsdom */

import { renderHook, waitFor } from "@testing-library/react";

import type { WorkspaceCallNoteFile } from "@launchstack/pipelines/call-notes/files";
import type { MindmapSummary } from "../../_mindmap/lib/api";
import { mapMindmap, mindmapCitability, useWorkspaceData } from "../useWorkspaceData";

/**
 * A mindmap is a source. The list the whole workspace reads comes from this
 * hook, so this is where "one list" is either true or not: maps appear beside
 * documents, and a map's published copy is folded into the map rather than
 * listed twice.
 */

function summary(overrides: Partial<MindmapSummary> = {}): MindmapSummary {
    return {
        id: 7,
        title: "Launch plan",
        description: null,
        folder: "Strategy",
        templateId: "mindmap",
        thumbnail: null,
        hasThumbnail: true,
        nodeCount: 12,
        edgeCount: 11,
        revision: 4,
        starred: false,
        publishedDocumentId: null,
        publishedAt: null,
        publishedRevision: null,
        searchText: "Launch plan · Postgres · Billing",
        createdByUserId: "u1",
        updatedByUserId: null,
        deletedAt: null,
        openedAt: null,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}

const callNote: WorkspaceCallNoteFile = {
    type: "call-note",
    callId: "call-review",
    noteId: 11,
    title: "Release review",
    visibility: "company",
    revision: 2,
    updatedAt: "2026-09-14T12:00:00.000Z",
    preview: "Ship the revised onboarding flow.",
    documentId: 101,
};

/** The URL a fetch mock was called with, whatever form the caller used. */
function urlOf(input: RequestInfo | URL): string {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return input.url;
}

describe("mindmapCitability", () => {
    it("is none until published, stale once edited past the published revision", () => {
        expect(mindmapCitability(summary())).toBe("none");
        expect(mindmapCitability(summary({ publishedDocumentId: 99, publishedRevision: 4 }))).toBe(
            "citable"
        );
        expect(mindmapCitability(summary({ publishedDocumentId: 99, publishedRevision: 2 }))).toBe(
            "stale"
        );
    });

    it("trusts a published copy whose revision was never recorded", () => {
        // Rows published before `published_revision` existed.
        expect(
            mindmapCitability(summary({ publishedDocumentId: 99, publishedRevision: null }))
        ).toBe("citable");
    });
});

describe("mapMindmap", () => {
    it("shapes a row into a source the rail, search and viewer understand", () => {
        const source = mapMindmap(summary({ publishedDocumentId: 99, publishedRevision: 4 }));
        expect(source.id).toBe("m7");
        expect(source.type).toBe("mindmap");
        expect(source.mindmapId).toBe(7);
        // Citations name document ids; the map answers to its published copy.
        expect(source.documentId).toBe(99);
        expect(source.folder).toBe("Strategy");
        expect(source.size).toBe("12 shapes");
        expect(source.searchText).toContain("Postgres");
        expect(source.thumbnailUrl).toBe("/api/mindmaps/7/thumbnail");
        expect(source.citability).toBe("citable");
    });

    it("leaves documentId unset for a map that was never published", () => {
        const source = mapMindmap(summary());
        expect(source.documentId).toBeUndefined();
        expect(source.citability).toBe("none");
    });

    it("skips the thumbnail URL when there is no image to serve", () => {
        expect(mapMindmap(summary({ hasThumbnail: false })).thumbnailUrl).toBeUndefined();
    });
});

describe("useWorkspaceData", () => {
    const fetchMock = jest.fn();

    beforeAll(() => {
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockImplementation((input: RequestInfo | URL) => {
            const url = urlOf(input);
            const json = (value: unknown) =>
                Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(value) });
            if (url.startsWith("/api/fetchDocument")) {
                return json([
                    { id: 1, title: "Handbook.pdf", category: "HR", url: "/x/1" },
                    // The published copy of map 7 — must not show up on its own.
                    { id: 99, title: "Launch plan", category: "Strategy", url: "/x/99" },
                    // The Call Note's indexed Markdown is not a second source.
                    {
                        id: 101,
                        title: callNote.title,
                        category: "Calls",
                        url: "/x/101",
                        ocrMetadata: { callNote: { callId: callNote.callId } },
                    },
                ]);
            }
            if (url.startsWith("/api/folders")) return json({ data: { folders: [] } });
            if (url.startsWith("/api/mindmaps")) {
                return json({
                    mindmaps: [summary({ publishedDocumentId: 99, publishedRevision: 4 })],
                    folders: ["Strategy"],
                });
            }
            if (url.startsWith("/api/call-notes/files")) {
                return json([
                    callNote,
                    {
                        ...callNote,
                        callId: "call-private",
                        noteId: 12,
                        title: "Private coaching",
                        visibility: "private",
                        documentId: null,
                    },
                    {
                        ...callNote,
                        callId: "call-pending",
                        noteId: 13,
                        title: "Awaiting indexing",
                        documentId: null,
                    },
                ]);
            }
            if (url.startsWith("/api/fetchUserInfo")) {
                return json({ companyId: 1, role: "owner" });
            }
            return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
        });
    });

    it("lists mindmaps beside documents and hides a map's published copy", async () => {
        const { result } = renderHook(() => useWorkspaceData("user_1"));
        await waitFor(() => expect(result.current.loading).toBe(false));

        const ids = result.current.sources.map(s => s.id);
        expect(ids).toContain("d1");
        expect(ids).toContain("m7");
        expect(ids).not.toContain("d99");

        // The map's folder is a folder like any other.
        expect(result.current.folders.map(f => f.name)).toEqual(
            expect.arrayContaining(["HR", "Strategy"])
        );
    });

    it("lists an indexed Call Note once and keeps its document available for chat references", async () => {
        const { result } = renderHook(() => useWorkspaceData("user_1"));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.sources.filter(source => source.documentId === 101)).toEqual([
            expect.objectContaining({
                id: "call-note:call-review",
                callId: "call-review",
                type: "call-note",
                documentId: 101,
                folder: "Calls",
            }),
        ]);
        expect(result.current.sources.find(source => source.id === "d101")).toBeUndefined();
        expect(result.current.folders.map(folder => folder.name)).toContain("Calls");
    });

    it("lists private and not-yet-indexed Call Notes without a chat document", async () => {
        const { result } = renderHook(() => useWorkspaceData("user_1"));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(
            result.current.sources.find(source => source.id === "call-note:call-private")
        ).toEqual(
            expect.objectContaining({
                callId: "call-private",
                visibility: "private",
                documentId: undefined,
            })
        );
        expect(
            result.current.sources.find(source => source.id === "call-note:call-pending")
        ).toEqual(
            expect.objectContaining({
                callId: "call-pending",
                visibility: "company",
                documentId: undefined,
            })
        );
    });

    it.each(["http", "network"] as const)(
        "hides indexed Call Note documents when the files listing has a %s failure",
        async failure => {
            const fetchAvailable = fetchMock.getMockImplementation()!;
            fetchMock.mockImplementation((input: RequestInfo | URL) => {
                if (urlOf(input).startsWith("/api/call-notes/files")) {
                    return failure === "network"
                        ? Promise.reject(new Error("offline"))
                        : Promise.resolve({ ok: false, status: 503 });
                }
                return fetchAvailable(input);
            });

            const { result } = renderHook(() => useWorkspaceData("user_1"));
            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(result.current.error).toBeNull();
            expect(result.current.sources.map(source => source.id)).toEqual(["d1", "m7"]);
            expect(result.current.sources.some(source => source.documentId === 101)).toBe(false);
        }
    );

    it("still lists documents when the mindmap list is unavailable", async () => {
        fetchMock.mockImplementation((input: RequestInfo | URL) => {
            const url = urlOf(input);
            const json = (value: unknown) =>
                Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(value) });
            if (url.startsWith("/api/fetchDocument")) {
                return json([{ id: 1, title: "Handbook.pdf", category: "HR", url: "/x/1" }]);
            }
            if (url.startsWith("/api/mindmaps")) return Promise.reject(new Error("offline"));
            return json([]);
        });
        const { result } = renderHook(() => useWorkspaceData("user_1"));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBeNull();
        expect(result.current.sources.map(s => s.id)).toEqual(["d1"]);
    });
});
