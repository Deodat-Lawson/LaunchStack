/**
 * Publishing a mindmap or a repo explanation adds a file to the library, so
 * since ADR-014 it takes what any upload takes: `documents.upload` (the
 * permission-gates table covers that), edit access to the folder the file
 * lands in, and — for a mindmap's later publish — edit access to the copy it
 * replaces. A first publish hands the new row to the creation defaults, so a
 * map published into Unfiled is private to its publisher until they share it.
 *
 * These routes used to need nothing but a membership: a Viewer could publish
 * into a restricted folder they cannot see into.
 */

import type { NextResponse } from "next/server";

import { POST as publishMindmap } from "~/app/api/mindmaps/[id]/publish/route";
import { POST as publishExplanation } from "~/app/api/repo-explainer/publish/route";
import { document } from "@launchstack/store/schema";
import { getMindmap } from "~/server/mindmap/repository";
import { processDocumentUpload } from "~/server/services/document-upload";
import { createDocumentVersionLifecycle } from "~/server/services/document-creation";
import { canEditFolder } from "~/server/services/folder-access";
import { recordUpload } from "~/server/workspace/added-documents";
import { canEditDocument } from "~/server/workspace/item-access";

import { fakeDb } from "../helpers/fake-db";
import { makeWorkspaceContext } from "../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual("../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);
jest.mock("~/server/db", () => ({ db: jest.requireActual("../helpers/fake-db").fakeDb.db }));
jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, handler: () => Promise<NextResponse>) =>
        handler(),
}));
jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));
jest.mock("~/lib/storage", () => ({
    uploadFile: jest.fn().mockResolvedValue({ url: "/api/files/9", provider: "database" }),
}));
jest.mock("@launchstack/conversion/ocr/config", () => ({
    getOcrConfig: () => ({ defaultProvider: "AZURE", appPublicUrl: "https://app.test" }),
}));
jest.mock("~/server/services/internal-file-ref", () => ({
    authorizeInternalFileRef: jest.fn().mockResolvedValue(null),
    UploadAuthorizationError: class extends Error {},
}));
jest.mock("~/server/services/document-upload", () => ({
    processDocumentUpload: jest.fn(),
    toAbsoluteUrl: (url: string) => url,
}));
jest.mock("~/server/services/document-creation", () => ({
    createDocumentVersionLifecycle: jest.fn(),
}));
jest.mock("~/server/mindmap/repository", () => ({
    getMindmap: jest.fn(),
    toDetail: (row: unknown) => row,
}));
jest.mock("~/app/employer/documents/_mindmap/model/serialize", () => ({
    parseDoc: () => ({}),
    toMarkdownOutline: () => "# Map",
}));
jest.mock("~/server/services/folder-access", () => ({
    FOLDER_EDIT_DENIED: "You do not have edit access to this folder.",
    DOCUMENT_EDIT_DENIED: "You can view this file but not change it.",
    canEditFolder: jest.fn(),
}));
jest.mock("~/server/workspace/item-access", () => ({ canEditDocument: jest.fn() }));
jest.mock("~/server/workspace/added-documents", () => ({ recordUpload: jest.fn() }));
jest.mock("@launchstack/pipelines/repo-explainer", () => ({
    makeExplanationCreationKey: () => "explain:key",
    makeExplanationFilename: () => "explain.md",
    renderExplanationMarkdown: () => "# Explained",
}));
jest.mock("@launchstack/pipelines/repo-workspace/db", () => ({
    getExplainerJob: jest.fn().mockResolvedValue({
        id: "job-1",
        status: "completed",
        result: { summary: "s" },
        sha: "abc",
        workspaceId: 3,
        diagramType: "architecture",
        completedAt: new Date("2026-10-01T00:00:00Z"),
    }),
    getRepoWorkspace: jest.fn().mockResolvedValue({ owner: "acme", repo: "app" }),
    markJobPublished: jest.fn().mockResolvedValue(null),
}));
jest.mock("~/server/services/repo-explainer-jobs", () => ({
    serializeExplainerJob: (job: unknown) => job,
}));

const member = makeWorkspaceContext({
    authUserId: "ada",
    userPk: BigInt(7),
    companyId: BigInt(5),
    role: "member",
});

const UPLOAD = {
    jobId: "job",
    eventIds: [],
    storageType: "database",
    document: { id: 40, title: "Roadmap", url: "/api/files/9", category: "Unfiled" },
    createdDocuments: [{ id: 40, title: "Roadmap", url: "/api/files/9", category: "Unfiled" }],
    resolvedDocumentUrl: "/api/files/9",
};

function post(path: string, body: unknown): Request {
    return new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

const mapParams = { params: Promise.resolve({ id: "8" }) };

function map(overrides: Record<string, unknown> = {}) {
    return {
        id: 8,
        title: "Roadmap",
        folder: "Unfiled",
        doc: {},
        revision: 3,
        publishedDocumentId: null,
        ...overrides,
    };
}

// A later publish stamps the revision marker with a raw UPDATE.
Object.assign(fakeDb.db, { execute: () => Promise.resolve(undefined) });

beforeEach(() => {
    jest.clearAllMocks();
    fakeDb.reset();
    mockRequireWorkspaceContext.mockResolvedValue({ success: true, data: member });
    jest.mocked(canEditFolder).mockResolvedValue(true);
    jest.mocked(canEditDocument).mockResolvedValue(true);
    jest.mocked(processDocumentUpload).mockResolvedValue(UPLOAD as never);
});

describe("POST /api/mindmaps/[id]/publish", () => {
    it("refuses a folder the publisher cannot add to", async () => {
        jest.mocked(getMindmap).mockResolvedValue(map({ folder: "Board" }) as never);
        jest.mocked(canEditFolder).mockResolvedValue(false);

        const response = await publishMindmap(post("/api/mindmaps/8/publish", {}), mapParams);

        expect(response.status).toBe(403);
        expect(canEditFolder).toHaveBeenCalledWith(member, "Board");
        expect(processDocumentUpload).not.toHaveBeenCalled();
    });

    it("checks the folder the request names, not the map's own", async () => {
        jest.mocked(getMindmap).mockResolvedValue(map({ folder: "Plans" }) as never);

        await publishMindmap(post("/api/mindmaps/8/publish", { category: "Board" }), mapParams);

        expect(canEditFolder).toHaveBeenCalledWith(member, "Board");
    });

    it("hands a first publish to the creation defaults, as the publisher", async () => {
        jest.mocked(getMindmap).mockResolvedValue(map() as never);

        const response = await publishMindmap(post("/api/mindmaps/8/publish", {}), mapParams);

        expect(response.status).toBe(201);
        expect(recordUpload).toHaveBeenCalledWith(member, UPLOAD);
    });

    it("refuses a later publish from someone who can only view the citable copy", async () => {
        jest.mocked(getMindmap).mockResolvedValue(
            map({ publishedDocumentId: BigInt(40) }) as never
        );
        fakeDb.onSelect(document, [{ category: "Sales" }]);
        jest.mocked(canEditDocument).mockResolvedValue(false);

        const response = await publishMindmap(post("/api/mindmaps/8/publish", {}), mapParams);

        expect(response.status).toBe(403);
        expect(canEditDocument).toHaveBeenCalledWith(member, { id: 40, category: "Sales" });
        expect(createDocumentVersionLifecycle).not.toHaveBeenCalled();
    });

    it("adds a version for an editor without touching the defaults again", async () => {
        jest.mocked(getMindmap).mockResolvedValue(
            map({ publishedDocumentId: BigInt(40) }) as never
        );
        fakeDb.onSelect(document, [{ category: "Sales" }]);
        jest.mocked(createDocumentVersionLifecycle).mockResolvedValue({
            document: { id: 40 },
            jobId: "job-2",
        } as never);

        const response = await publishMindmap(post("/api/mindmaps/8/publish", {}), mapParams);

        expect(response.status).toBe(201);
        expect(createDocumentVersionLifecycle).toHaveBeenCalled();
        expect(recordUpload).not.toHaveBeenCalled();
    });
});

describe("POST /api/repo-explainer/publish", () => {
    it("refuses a folder the publisher cannot add to", async () => {
        jest.mocked(canEditFolder).mockResolvedValue(false);

        const response = await publishExplanation(
            post("/api/repo-explainer/publish", { jobId: "job-1", category: "Board" })
        );

        expect(response.status).toBe(403);
        expect(canEditFolder).toHaveBeenCalledWith(member, "Board");
        expect(processDocumentUpload).not.toHaveBeenCalled();
    });

    it("publishes for a member and hands the new file to the creation defaults", async () => {
        const response = await publishExplanation(
            post("/api/repo-explainer/publish", { jobId: "job-1" })
        );

        expect(response.status).toBe(201);
        expect(recordUpload).toHaveBeenCalledWith(member, UPLOAD);
    });
});
