/**
 * What a published diagram puts in the library: the publish route renders the
 * *stored* document with the real serializer and uploads it for indexing. A
 * flowchart goes in as its step text — the language the Steps panel shows and
 * the agent tools read and write — so Ask can answer from it; a mind map goes
 * in as its outline, as before. Access is covered by publish-access.route.test.
 */

import type { NextResponse } from "next/server";

import { POST as publishMindmap } from "~/app/api/mindmaps/[id]/publish/route";
import { newStepBox } from "~/app/employer/documents/_mindmap/model/flowchart";
import { buildDiagram } from "~/app/employer/documents/_mindmap/model/generate";
import { draftAccess } from "~/server/mindmap/access";
import { getMindmap } from "~/server/mindmap/repository";
import { processDocumentUpload } from "~/server/services/document-upload";
import { uploadFile } from "~/lib/storage";
import { canEditFolder } from "~/server/services/folder-access";

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
jest.mock("~/lib/storage", () => ({ uploadFile: jest.fn() }));
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
jest.mock("~/server/mindmap/access", () => ({
    canEditDraftAt: (level: string | null) => level === "edit" || level === "manage",
    draftAccess: jest.fn(),
    draftReader: jest.fn().mockResolvedValue({ companyId: BigInt(5), authUserId: "ada" }),
}));
jest.mock("~/server/services/folder-access", () => ({ canEditFolder: jest.fn() }));
jest.mock("~/server/workspace/item-access", () => ({ canEditDocument: jest.fn() }));
jest.mock("~/server/workspace/added-documents", () => ({ recordUpload: jest.fn() }));

const member = makeWorkspaceContext({
    authUserId: "ada",
    userPk: BigInt(7),
    companyId: BigInt(5),
    role: "member",
});

const STEPS = [
    "Start",
    "Receive the order",
    "In stock?",
    "  Yes: Pick and pack",
    "  No: Reorder from supplier -> Receive the order",
    "Ship it",
    "End",
].join("\n");

Object.assign(fakeDb.db, { execute: () => Promise.resolve(undefined) });

beforeEach(() => {
    jest.clearAllMocks();
    fakeDb.reset();
    mockRequireWorkspaceContext.mockResolvedValue({ success: true, data: member });
    jest.mocked(uploadFile).mockResolvedValue({
        url: "/api/files/9",
        provider: "database",
    } as never);
    jest.mocked(canEditFolder).mockResolvedValue(true);
    jest.mocked(draftAccess).mockResolvedValue({ level: "manage" } as never);
    jest.mocked(processDocumentUpload).mockResolvedValue({
        jobId: "job",
        document: { id: 40 },
    } as never);
});

/** Publish a stored document and return the Markdown the route uploaded. */
async function published(doc: unknown, title: string): Promise<string> {
    jest.mocked(getMindmap).mockResolvedValue({
        id: 8,
        title,
        folder: "Unfiled",
        doc: JSON.parse(JSON.stringify(doc)),
        revision: 3,
        publishedDocumentId: null,
    } as never);
    const response = await publishMindmap(
        new Request("http://localhost/api/mindmaps/8/publish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
        }),
        { params: Promise.resolve({ id: "8" }) }
    );
    expect(response.status).toBe(201);
    const upload = jest.mocked(uploadFile).mock.calls[0]![0] as { data: Buffer };
    return upload.data.toString("utf8");
}

describe("publishing a diagram indexes", () => {
    it("a flowchart as its step text, with its notes", async () => {
        const doc = buildDiagram({ title: "Orders", type: "flowchart", steps: STEPS });
        const page = doc.pages[0]!;
        const note = newStepBox("sticky", "Ask Sam before reordering", "light");
        const markdown = await published(
            { ...doc, pages: [{ ...page, nodes: [...page.nodes, note] }] },
            "Orders"
        );
        expect(markdown).toContain("# Orders");
        expect(markdown).toContain("```steps\n" + STEPS + "\n```");
        expect(markdown).toContain("## Notes\n\n- Ask Sam before reordering");
        expect(markdown).not.toContain("**Connections**");
    });

    it("a mind map as its outline, as before", async () => {
        const doc = buildDiagram({
            title: "Launch",
            type: "mindmap",
            outline: "- Launch\n  - Product\n    - Beta\n  - Marketing",
        });
        const markdown = await published(doc, "Launch");
        expect(markdown).not.toContain("```steps");
        expect(markdown).toContain("## Product\n\n- Launch\n  - Product\n    - Beta");
    });
});
