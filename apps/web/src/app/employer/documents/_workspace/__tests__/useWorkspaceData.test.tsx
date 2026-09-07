/** @jest-environment jsdom */

import { renderHook, waitFor } from "@testing-library/react";

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
                ]);
            }
            if (url.startsWith("/api/Categories/GetCategories")) return json([]);
            if (url.startsWith("/api/mindmaps")) {
                return json({
                    mindmaps: [summary({ publishedDocumentId: 99, publishedRevision: 4 })],
                    folders: ["Strategy"],
                });
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
