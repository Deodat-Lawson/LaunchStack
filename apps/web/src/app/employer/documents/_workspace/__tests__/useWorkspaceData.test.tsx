/** @jest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";

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

    it("files a draft by its own access, not its published copy's (ADR-014)", () => {
        const draft = {
            audience: "private" as const,
            ownAudience: true,
            principalCount: 1,
            canEdit: true,
            canManage: true,
            canDelete: true,
        };
        const published = {
            audience: "workspace" as const,
            ownAudience: false,
            principalCount: 0,
            canEdit: false,
            canManage: false,
            canDelete: false,
        };
        const row = summary({ folder: "Unfiled", access: draft, publishedDocumentId: 99 });
        const source = mapMindmap(row, { access: published } as never);
        expect(source.access).toEqual(draft);
        // An older server that described only the published copy still gets a label.
        expect(mapMindmap(summary(), { access: published } as never).access).toEqual(published);
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

    describe("processing-source polling", () => {
        const documentRequests = jest.fn();
        const processingDocument = {
            id: 1,
            title: "Handbook.pdf",
            category: "HR",
            url: "/x/1",
            ocrProcessed: false,
            ocrMetadata: null,
            currentVersionId: 10,
            currentVersionOcrProcessed: false,
            currentVersionOcrMetadata: null,
        };
        const failedDocument = {
            ...processingDocument,
            currentVersionOcrMetadata: {
                error: "processing_failed",
                errorMessage: "Could not extract this document",
            },
        };
        const jsonResponse = (value: unknown) => ({
            ok: true,
            status: 200,
            json: () => Promise.resolve(value),
        });
        let visibilityState: DocumentVisibilityState;

        beforeEach(() => {
            jest.useFakeTimers();
            visibilityState = "visible";
            jest.spyOn(document, "visibilityState", "get").mockImplementation(
                () => visibilityState
            );
            documentRequests.mockReset();
            documentRequests.mockResolvedValue(jsonResponse([processingDocument]));
            fetchMock.mockImplementation((input: RequestInfo | URL) => {
                const url = urlOf(input);
                if (url.startsWith("/api/fetchDocument")) return documentRequests();
                if (url.startsWith("/api/mindmaps")) {
                    return Promise.resolve(jsonResponse({ mindmaps: [] }));
                }
                if (url.startsWith("/api/folders")) {
                    return Promise.resolve(jsonResponse({ data: { folders: [] } }));
                }
                return Promise.resolve(jsonResponse({ companyId: 1, role: "owner" }));
            });
        });

        afterEach(() => {
            jest.restoreAllMocks();
            jest.useRealTimers();
        });

        it("updates a processing source to failed on the next poll and stops polling", async () => {
            documentRequests
                .mockResolvedValueOnce(jsonResponse([processingDocument]))
                .mockResolvedValue(jsonResponse([failedDocument]));
            const { result, unmount } = renderHook(() => useWorkspaceData("user_1"));
            await act(async () => {});
            expect(result.current.sources[0]?.indexStatus).toBe("processing");
            expect(documentRequests).toHaveBeenCalledTimes(1);

            await act(async () => {
                jest.advanceTimersByTime(3000);
            });
            expect(result.current.sources[0]?.indexStatus).toBe("failed");
            expect(result.current.sources[0]?.errorMessage).toBe("Could not extract this document");
            expect(documentRequests).toHaveBeenCalledTimes(2);

            await act(async () => {
                jest.advanceTimersByTime(9000);
            });
            expect(documentRequests).toHaveBeenCalledTimes(2);
            unmount();
        });

        it("pauses while hidden, resumes while processing, and stops on unmount", async () => {
            const { result, unmount } = renderHook(() => useWorkspaceData("user_1"));
            await act(async () => {});
            expect(result.current.sources[0]?.indexStatus).toBe("processing");

            act(() => {
                visibilityState = "hidden";
                document.dispatchEvent(new Event("visibilitychange"));
            });
            await act(async () => {
                jest.advanceTimersByTime(9000);
            });
            expect(documentRequests).toHaveBeenCalledTimes(1);

            // Coming back catches up at once, then carries on with the schedule.
            await act(async () => {
                visibilityState = "visible";
                document.dispatchEvent(new Event("visibilitychange"));
            });
            expect(documentRequests).toHaveBeenCalledTimes(2);
            await act(async () => {
                jest.advanceTimersByTime(3000);
            });
            expect(documentRequests).toHaveBeenCalledTimes(3);

            unmount();
            await act(async () => {
                jest.advanceTimersByTime(9000);
            });
            expect(documentRequests).toHaveBeenCalledTimes(3);
        });

        /** Let the clock run, then let the poll it fired (if any) land. */
        const advance = (ms: number) =>
            act(async () => {
                jest.advanceTimersByTime(ms);
            });

        it("slows down while the same source keeps processing", async () => {
            const { unmount } = renderHook(() => useWorkspaceData("user_1"));
            await act(async () => {});
            expect(documentRequests).toHaveBeenCalledTimes(1);

            await advance(3000);
            expect(documentRequests).toHaveBeenCalledTimes(2);
            await advance(4499);
            expect(documentRequests).toHaveBeenCalledTimes(2);
            await advance(1);
            expect(documentRequests).toHaveBeenCalledTimes(3);
            await advance(6749);
            expect(documentRequests).toHaveBeenCalledTimes(3);
            await advance(1);
            expect(documentRequests).toHaveBeenCalledTimes(4);
            unmount();
        });

        it("starts over at 3s when what is processing changes", async () => {
            const secondUpload = { ...processingDocument, id: 2, title: "Deck.pdf", url: "/x/2" };
            documentRequests
                .mockResolvedValueOnce(jsonResponse([processingDocument]))
                .mockResolvedValueOnce(jsonResponse([processingDocument]))
                .mockResolvedValue(jsonResponse([processingDocument, secondUpload]));
            const { unmount } = renderHook(() => useWorkspaceData("user_1"));
            await act(async () => {});

            await advance(3000);
            expect(documentRequests).toHaveBeenCalledTimes(2);
            // The third poll finds a second upload processing...
            await advance(4500);
            expect(documentRequests).toHaveBeenCalledTimes(3);
            // ...so the next one comes 3s later, not 6.75s.
            await advance(2999);
            expect(documentRequests).toHaveBeenCalledTimes(3);
            await advance(1);
            expect(documentRequests).toHaveBeenCalledTimes(4);
            unmount();
        });

        it("stops polling a source stuck in processing, and catches up once on return", async () => {
            const { unmount } = renderHook(() => useWorkspaceData("user_1"));
            await act(async () => {});

            // Well past half an hour of watching, one 30s step at a time.
            for (let i = 0; i < 80; i++) await advance(30_000);
            // The first load plus every poll the schedule allows.
            expect(documentRequests).toHaveBeenCalledTimes(1 + 63);

            act(() => {
                visibilityState = "hidden";
                document.dispatchEvent(new Event("visibilitychange"));
            });
            await act(async () => {
                visibilityState = "visible";
                document.dispatchEvent(new Event("visibilitychange"));
            });
            expect(documentRequests).toHaveBeenCalledTimes(1 + 63 + 1);

            await advance(10 * 60_000);
            expect(documentRequests).toHaveBeenCalledTimes(1 + 63 + 1);
            unmount();
        });

        it("skips busy ticks without losing an explicit refresh queued behind a poll", async () => {
            function deferred<T>() {
                let resolve!: (value: T | PromiseLike<T>) => void;
                const promise = new Promise<T>(resolver => {
                    resolve = resolver;
                });
                return { promise, resolve };
            }
            const pendingPoll = deferred<unknown>();
            documentRequests
                .mockResolvedValueOnce(jsonResponse([processingDocument]))
                .mockReturnValueOnce(pendingPoll.promise)
                .mockResolvedValue(jsonResponse([failedDocument]));
            const { result, unmount } = renderHook(() => useWorkspaceData("user_1"));
            await act(async () => {});

            await act(async () => {
                jest.advanceTimersByTime(3000);
            });
            expect(documentRequests).toHaveBeenCalledTimes(2);
            let explicitRefresh!: Promise<void>;
            act(() => {
                explicitRefresh = result.current.refresh();
            });

            await act(async () => {
                jest.advanceTimersByTime(9000);
            });
            expect(documentRequests).toHaveBeenCalledTimes(2);

            await act(async () => {
                pendingPoll.resolve(jsonResponse([processingDocument]));
                await explicitRefresh;
            });
            expect(documentRequests).toHaveBeenCalledTimes(3);
            expect(result.current.sources[0]?.indexStatus).toBe("failed");
            unmount();
        });
    });
});
