import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

import { POST } from "~/app/api/documents/[id]/versions/route";
import { validateRequestBody } from "~/lib/validation";
import { db } from "~/server/db";
import { getOcrConfig } from "@launchstack/conversion/ocr/config";
import { parseProvider } from "@launchstack/conversion/ocr/trigger";
import { createDocumentVersionLifecycle } from "~/server/services/document-creation";
import {
    authorizeInternalFileRef,
    UploadAuthorizationError,
} from "~/server/services/internal-file-ref";

import { canEditFolder } from "~/server/services/folder-access";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

jest.mock("~/server/services/folder-access", () => ({
    FOLDER_EDIT_DENIED: "You do not have edit access to this folder.",
    canEditFolder: jest.fn().mockResolvedValue(true),
}));

// The scope predicate is exercised by its own tests; here it only has to be
// something the fake `where` accepts.
jest.mock("~/lib/authz/scope", () => ({
    scopedDocumentWhere: (companyId: bigint) => ({ op: "scoped", companyId }),
}));

jest.mock("~/lib/validation", () => ({
    validateRequestBody: jest.fn(),
}));

jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, handler: () => Promise<Response>) =>
        handler(),
}));

jest.mock("~/lib/rate-limiter", () => ({
    RateLimitPresets: { strict: {} },
}));

jest.mock("~/server/engine", () => ({
    getEngine: jest.fn().mockReturnValue({}),
}));

jest.mock("~/server/services/document-creation", () => ({
    createDocumentVersionLifecycle: jest.fn(),
}));

// Drive-linked documents refuse in-app version uploads with a 409; these
// tests exercise the unlinked path, so the guard reports no link.
jest.mock("~/server/services/google-drive/links", () => ({
    getActiveDriveLink: jest.fn().mockResolvedValue(null),
}));

jest.mock("~/server/services/internal-file-ref", () => {
    class MockUploadAuthorizationError extends Error {
        status: number;

        constructor(message: string, status = 503) {
            super(message);
            this.name = "UploadAuthorizationError";
            this.status = status;
        }
    }

    return {
        authorizeInternalFileRef: jest.fn(),
        UploadAuthorizationError: MockUploadAuthorizationError,
    };
});

jest.mock("~/server/db", () => ({
    db: {
        select: jest.fn(),
    },
}));

jest.mock("@launchstack/store/schema", () => ({
    document: {
        id: "document.id",
    },
    documentVersions: {
        documentId: "documentVersions.documentId",
        versionNumber: "documentVersions.versionNumber",
        id: "documentVersions.id",
    },
}));

jest.mock("@launchstack/conversion/ocr/config", () => ({
    getOcrConfig: jest.fn(),
}));

jest.mock("@launchstack/conversion/ocr/trigger", () => ({
    parseProvider: jest.fn((provider?: string) => (provider ? provider.toUpperCase() : undefined)),
}));

jest.mock("drizzle-orm", () => ({
    and: (...conditions: unknown[]) => ({ op: "and", conditions }),
    desc: (column: unknown) => ({ op: "desc", column }),
    eq: (column: unknown, value: unknown) => ({ op: "eq", column, value }),
}));

const workspaceContext = makeWorkspaceContext({
    authUserId: "user-1",
    userPk: BigInt(7),
    companyId: BigInt(10),
    role: "owner",
});

const documentRow = {
    id: 55,
    companyId: BigInt(10),
    title: "Contract",
    category: "contracts",
    fileType: "application/pdf",
    url: "https://app.example/api/files/99",
};

const mockSelect = db.select as jest.Mock;

function setupDatabase() {
    const selectWhere = jest.fn().mockResolvedValue([documentRow]);
    const selectFrom = jest.fn().mockReturnValue({ where: selectWhere });
    mockSelect.mockReturnValue({ from: selectFrom });
}

function setupAuthenticatedRequest(context = workspaceContext) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: context,
    });
    (getOcrConfig as jest.Mock).mockReturnValue({
        defaultProvider: "DOCLING",
        appPublicUrl: "https://app.example",
    });
    (validateRequestBody as jest.Mock).mockResolvedValue({
        success: true,
        data: {
            documentUrl: "https://app.example/api/files/123/?source=upload",
            mimeType: "application/pdf",
            originalFilename: "contract.pdf",
            preferredProvider: "docling",
        },
    });
    (authorizeInternalFileRef as jest.Mock).mockResolvedValue(123);
    (createDocumentVersionLifecycle as jest.Mock).mockResolvedValue({
        version: { id: 77, versionNumber: 2 },
        job: { id: "job-1" },
        eventIds: ["event-1"],
    });
}

function request() {
    return new Request("https://app.example/api/documents/55/versions", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
    });
}

function routeContext() {
    return { params: Promise.resolve({ id: "55" }) };
}

describe("POST /api/documents/[id]/versions", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setupDatabase();
        setupAuthenticatedRequest();
    });

    it("persists and dispatches the effective provider with a canonical internal URL", async () => {
        const response = await POST(request(), routeContext());

        expect(response.status).toBe(202);
        expect(parseProvider).toHaveBeenCalledWith("docling");
        expect(createDocumentVersionLifecycle).toHaveBeenCalledWith(
            expect.objectContaining({
                documentId: 55,
                companyId: BigInt(10),
                userId: "user-1",
                url: "https://app.example/api/files/123",
                creationKey: "version:55:https://app.example/api/files/123",
                preferredProvider: "DOCLING",
            })
        );
    });

    it("returns 403 for a viewer (no documents.upload)", async () => {
        setupAuthenticatedRequest(makeWorkspaceContext({ role: "viewer", companyId: BigInt(10) }));

        const response = await POST(request(), routeContext());

        expect(response.status).toBe(403);
        expect(mockSelect).not.toHaveBeenCalled();
        expect(createDocumentVersionLifecycle).not.toHaveBeenCalled();
    });

    it("returns 404 when the document is outside the caller's scope", async () => {
        const selectWhere = jest.fn().mockResolvedValue([]);
        mockSelect.mockReturnValue({ from: jest.fn().mockReturnValue({ where: selectWhere }) });

        const response = await POST(request(), routeContext());

        expect(response.status).toBe(404);
        expect(selectWhere).toHaveBeenCalledWith(
            expect.objectContaining({
                op: "and",
                conditions: expect.arrayContaining([{ op: "scoped", companyId: BigInt(10) }]),
            })
        );
        expect(createDocumentVersionLifecycle).not.toHaveBeenCalled();
    });

    it("refuses a new version into a restricted folder without an edit grant", async () => {
        (canEditFolder as jest.Mock).mockResolvedValueOnce(false);

        const response = await POST(request(), routeContext());

        expect(response.status).toBe(403);
        expect(canEditFolder).toHaveBeenCalledWith(workspaceContext, "contracts");
        expect(createDocumentVersionLifecycle).not.toHaveBeenCalled();
    });

    it("returns 503 before inserting a version when OSS authorization cannot sign", async () => {
        const authorizationError = new UploadAuthorizationError(
            "FILE_ACCESS_TOKEN_SECRET is required",
            503
        );
        (authorizeInternalFileRef as jest.Mock).mockRejectedValue(authorizationError);

        const response = await POST(request(), routeContext());

        expect(response.status).toBe(503);
        expect(createDocumentVersionLifecycle).not.toHaveBeenCalled();
    });
});
