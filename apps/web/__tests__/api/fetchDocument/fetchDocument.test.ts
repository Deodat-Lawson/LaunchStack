/**
 * The document list is the first place a restricted folder must disappear:
 * the read scope goes into the WHERE clause, and each row says whether the
 * document itself is restricted.
 */

import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

import type { SQL } from "drizzle-orm";

import type { DocumentScope } from "~/lib/authz/scope-types";
import type { WorkspaceSource } from "~/app/employer/documents/_workspace/types";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

jest.mock("~/server/storage/vercel-blob", () => ({
    isPrivateBlobUrl: jest.fn(() => false),
    fetchBlob: jest.fn(),
    putFile: jest.fn(),
}));

jest.mock("~/lib/storage", () => ({
    isS3Storage: jest.fn(() => false),
    fetchFile: jest.fn(),
}));

// The dedicated second pool (~/server/db/core, `dbCore`) was deleted — the
// route now uses the engine's shared Drizzle client from ~/server/db.
jest.mock("~/server/db", () => ({
    db: {
        select: jest.fn(),
    },
}));

// The scope predicate is asserted by structure — was the real one used with
// the right scope — not by re-implementing its SQL here.
const mockScopedDocumentWhere = jest.fn();
jest.mock("~/lib/authz/scope", () => ({
    scopedDocumentWhere: (companyId: bigint, scope: DocumentScope) =>
        mockScopedDocumentWhere(companyId, scope),
}));

// Who can see each document and who added it — ADR-014's rail sections. The
// classification is pure and tested in source-access.test; here the route
// only has to attach what it is handed, row by row.
const mockSubject = { userPk: "7", role: "owner", groupIds: new Set<string>() };
const mockDescribe = jest.fn();
jest.mock("~/server/workspace/item-access", () => ({
    accessSubject: () => Promise.resolve(mockSubject),
}));
jest.mock("~/server/workspace/source-access", () => ({
    describeDocumentAccess: (...args: unknown[]) => mockDescribe(...args),
}));

import { POST } from "~/app/api/fetchDocument/route";
import {
    mapDocument as mapDocumentWith,
    type SourceRowLabels,
} from "~/app/employer/documents/_workspace/useWorkspaceData";
import { englishMessages } from "~/i18n/messages";
import { createFormatter, createTranslator } from "use-intl";
import { db } from "~/server/db";
import { documentVersions } from "@launchstack/store/schema";

const SCOPE_MARKER = { marker: "scoped-where" } as unknown as SQL;

/** The rail's mapping, with the English words a source row is made of. */
const ENGLISH_ROW_LABELS: SourceRowLabels = {
    t: createTranslator({ locale: "en", messages: englishMessages, namespace: "workspace" }),
    format: createFormatter({ locale: "en" }),
};
const mapDocument = (doc: Parameters<typeof mapDocumentWith>[0]) =>
    mapDocumentWith(doc, ENGLISH_ROW_LABELS);

function mockAuthenticated(companyId = BigInt(1), scope?: DocumentScope) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ authUserId: "test-user-123", companyId, scope }),
    });
}

function mockUnauthenticated() {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: false,
        response: new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        }),
    });
}

function docRow(id: number, overrides: Record<string, unknown> = {}) {
    return {
        id,
        title: `Document ${id}`,
        category: "General",
        companyId: BigInt(1),
        url: `https://example.com/${id}.pdf`,
        mimeType: "application/pdf",
        currentVersionId: null,
        restricted: null,
        ...overrides,
    };
}

/** Captures the predicate the route hands to `.where()` and resolves `rows`. */
function mockDocumentQuery(rows: Record<string, unknown>[]) {
    const where = jest.fn().mockResolvedValue(rows);
    const query = { leftJoin: jest.fn().mockReturnThis(), where };
    (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue(query),
    });
    return where;
}

describe("POST /api/fetchDocument", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockScopedDocumentWhere.mockReturnValue(SCOPE_MARKER);
        mockDescribe.mockResolvedValue({ access: new Map(), addedBy: new Map() });
    });

    it("says, per document, who can see it, what the caller may do, and who added it", async () => {
        mockAuthenticated(BigInt(1));
        mockDocumentQuery([docRow(1, { category: "Unfiled" }), docRow(2)]);
        const privateToMe = {
            audience: "private",
            ownAudience: true,
            principalCount: 1,
            canEdit: true,
            canManage: true,
        };
        mockDescribe.mockResolvedValue({
            access: new Map([[1, privateToMe]]),
            addedBy: new Map([[1, { authUserId: "test-user-123", name: "Ada" }]]),
        });

        const response = await POST(
            new Request("http://localhost/api/fetchDocument", { method: "POST" })
        );
        const json = await response.json();

        expect(mockDescribe).toHaveBeenCalledWith(BigInt(1), mockSubject, [
            { id: 1, category: "Unfiled" },
            { id: 2, category: "General" },
        ]);
        expect(json[0].access).toEqual(privateToMe);
        expect(json[0].addedBy).toEqual({ authUserId: "test-user-123", name: "Ada" });
        // A row the classifier had nothing for stays backward compatible.
        expect(json[1].access).toBeNull();
        expect(json[1].addedBy).toBeNull();
    });

    it("should successfully fetch documents for authenticated user", async () => {
        mockAuthenticated(BigInt(1));
        mockDocumentQuery([docRow(1), docRow(2)]);

        const response = await POST(
            new Request("http://localhost/api/fetchDocument", { method: "POST" })
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json).toHaveLength(2);
        expect(json[0].id).toBe(1);
        expect(json[0].companyId).toBe(1);
        expect(json[0].restricted).toBe(false);
    });

    it.each([
        {
            previousState: "indexed",
            ocrProcessed: true,
            ocrMetadata: null,
        },
        {
            previousState: "failed",
            ocrProcessed: false,
            ocrMetadata: {
                error: "processing_failed",
                errorMessage: "The previous version failed",
            },
        },
    ])(
        "keeps a queued current version processing when the previous version $previousState",
        async ({ ocrProcessed, ocrMetadata }) => {
            mockAuthenticated();
            mockDocumentQuery([
                docRow(1, {
                    ocrProcessed,
                    ocrMetadata,
                    currentVersionId: BigInt(22),
                    currentVersionOcrProcessed: false,
                    currentVersionOcrMetadata: null,
                }),
            ]);

            const response = await POST(
                new Request("http://localhost/api/fetchDocument", { method: "POST" })
            );
            const [doc] = await response.json();

            expect(response.status).toBe(200);
            expect(db.select).toHaveBeenCalledWith(
                expect.objectContaining({
                    currentVersionOcrProcessed: documentVersions.ocrProcessed,
                    currentVersionOcrMetadata: documentVersions.ocrMetadata,
                })
            );
            expect(doc).toMatchObject({
                ocrProcessed,
                ocrMetadata,
                currentVersionId: 22,
                currentVersionOcrProcessed: false,
                currentVersionOcrMetadata: null,
            });
            expect(mapDocument(doc)).toMatchObject({ indexStatus: "processing" });
            expect(mapDocument(doc).errorMessage).toBeUndefined();
        }
    );

    it("does not call an unindexed recording ready, but uses version readiness for its transcript", async () => {
        mockAuthenticated();
        mockDocumentQuery([
            docRow(1, {
                title: "Standup.mp3",
                mimeType: "audio/mpeg",
                creationKey: "upload:standup:audio-source",
                ocrProcessed: true,
                currentVersionId: BigInt(22),
                currentVersionOcrProcessed: true,
                currentVersionOcrMetadata: null,
            }),
            docRow(2, {
                title: "Standup.mp3 (Transcription)",
                mimeType: "text/plain",
                ocrMetadata: { source: "transcription", audioDocumentId: 1 },
                currentVersionId: BigInt(23),
                currentVersionOcrProcessed: false,
                currentVersionOcrMetadata: { source: "transcription", audioDocumentId: 1 },
            }),
            docRow(3, {
                title: "Legacy standup.mp3",
                mimeType: "audio/mpeg",
                ocrEnabled: false,
                ocrProcessed: true,
            }),
        ]);

        const response = await POST(
            new Request("http://localhost/api/fetchDocument", { method: "POST" })
        );
        const [recording, transcript, legacyRecording] = await response.json();

        expect(response.status).toBe(200);
        expect(mapDocument(recording).indexStatus).toBeUndefined();
        expect(mapDocument(recording).citability).toBe("none");
        expect(mapDocument(legacyRecording).indexStatus).toBeUndefined();
        expect(mapDocument(legacyRecording).citability).toBe("none");
        expect(mapDocument(transcript).indexStatus).toBe("processing");
        expect(mapDocument({ ...transcript, currentVersionOcrProcessed: true }).indexStatus).toBe(
            "ready"
        );
    });

    it("uses current-version failures and falls back only for documents without a version", async () => {
        mockAuthenticated();
        mockDocumentQuery([
            docRow(1, {
                ocrProcessed: true,
                currentVersionId: BigInt(22),
                currentVersionOcrProcessed: false,
                currentVersionOcrMetadata: {
                    error: "processing_failed",
                    errorMessage: "The current version failed",
                },
            }),
            docRow(2, {
                ocrProcessed: false,
                ocrMetadata: { error: "processing_failed", errorMessage: "An old failure" },
                currentVersionId: BigInt(23),
                currentVersionOcrProcessed: true,
                currentVersionOcrMetadata: null,
            }),
            docRow(3, {
                ocrProcessed: false,
                ocrMetadata: { error: "processing_failed", errorMessage: "Legacy failure" },
            }),
            docRow(4, {
                ocrProcessed: true,
                currentVersionId: BigInt(24),
                currentVersionOcrProcessed: null,
                currentVersionOcrMetadata: null,
            }),
            docRow(5, { ocrProcessed: true }),
        ]);

        const response = await POST(
            new Request("http://localhost/api/fetchDocument", { method: "POST" })
        );
        const docs = await response.json();
        const sources: WorkspaceSource[] = docs.map(mapDocument);

        expect(response.status).toBe(200);
        expect(sources.map(source => source.indexStatus)).toEqual([
            "failed",
            "ready",
            "failed",
            "processing",
            "ready",
        ]);
        expect(sources[0]?.errorMessage).toBe("The current version failed");
        expect(sources[1]?.errorMessage).toBeUndefined();
        expect(sources[2]?.errorMessage).toBe("Legacy failure");
    });

    it("reads through the caller's scope predicate, not a bare company filter", async () => {
        const scope: DocumentScope = {
            kind: "except",
            deniedCategories: ["Board"],
            deniedDocumentIds: [9],
            allowedDocumentIds: [],
        };
        mockAuthenticated(BigInt(1), scope);
        const where = mockDocumentQuery([docRow(1)]);

        await POST(new Request("http://localhost/api/fetchDocument", { method: "POST" }));

        expect(mockScopedDocumentWhere).toHaveBeenCalledWith(BigInt(1), scope);
        expect(where).toHaveBeenCalledWith(SCOPE_MARKER);
    });

    it("marks individually restricted documents the caller was granted", async () => {
        mockAuthenticated(BigInt(1));
        mockDocumentQuery([docRow(1), docRow(2, { restricted: true })]);

        const response = await POST(
            new Request("http://localhost/api/fetchDocument", { method: "POST" })
        );
        const json = await response.json();

        expect(json.map((d: { restricted: boolean }) => d.restricted)).toEqual([false, true]);
    });

    it("returns 401 when workspace context fails", async () => {
        mockUnauthenticated();

        const response = await POST(
            new Request("http://localhost/api/fetchDocument", { method: "POST" })
        );
        const json = await response.json();

        expect(response.status).toBe(401);
        expect(json.error).toBe("Unauthorized");
        expect(db.select).not.toHaveBeenCalled();
    });

    it("returns 403 for a role without documents.read", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: makeWorkspaceContext({ role: "custom-nothing", permissions: [] }),
        });

        const response = await POST(
            new Request("http://localhost/api/fetchDocument", { method: "POST" })
        );

        expect(response.status).toBe(403);
        expect(db.select).not.toHaveBeenCalled();
    });

    it("should return empty array if no documents exist for company", async () => {
        mockAuthenticated(BigInt(2));
        mockDocumentQuery([]);

        const response = await POST(
            new Request("http://localhost/api/fetchDocument", { method: "POST" })
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json).toEqual([]);
    });
});
