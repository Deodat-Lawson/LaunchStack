/**
 * Ask's document tool: what `create_document` writes and where, what the
 * model is told back, its budget, and the prompt that keeps the chat from
 * ever again telling someone to copy an answer into a file themselves.
 *
 * Storage, ingestion and the ADR-014 defaults are the upload path's own
 * (document-upload, added-documents); here they are mocked to check that the
 * tool takes that path with the right folder, and checks the folder first.
 */
import {
    createDocumentTools,
    documentFilename,
    documentToolsPrompt,
    noDocumentToolsPrompt,
    writeWorkspaceDocument,
    DocumentWriteDenied,
    type WriteDocumentInput,
} from "~/server/chat-document-tools";
import type { ChatCreatedSource } from "~/lib/chat-turns";
import { uploadFile } from "~/lib/storage";
import { processDocumentUpload } from "~/server/services/document-upload";
import { canEditFolder } from "~/server/services/folder-access";
import { recordUpload } from "~/server/workspace/added-documents";

import { makeWorkspaceContext } from "../helpers/workspace-context";

jest.mock("~/lib/storage", () => ({ uploadFile: jest.fn() }));
jest.mock("~/server/services/document-upload", () => ({ processDocumentUpload: jest.fn() }));
jest.mock("~/server/services/folder-access", () => ({ canEditFolder: jest.fn() }));
jest.mock("~/server/workspace/added-documents", () => ({ recordUpload: jest.fn() }));

const ctx = makeWorkspaceContext({ companyId: BigInt(5), userPk: BigInt(7) });
const signal = new AbortController().signal;
const REQUEST_URL = "https://app.example.com/api/agents/documentQ&A/AIChat/query";
const PLAN =
    "# Scenario Simulator — Business Plan\n\n## 1. Executive Summary\n\nTest your next move.";

function toolWith(write: jest.Mock) {
    const session = createDocumentTools(ctx, { requestUrl: REQUEST_URL }, { write });
    return { session, tool: session.tools[0]! };
}

function writes(documentId = 41, folder = "Unfiled") {
    return jest.fn(
        async (_ctx: unknown, input: WriteDocumentInput): Promise<ChatCreatedSource> => ({
            documentId,
            title: input.title,
            folder,
        })
    );
}

describe("create_document", () => {
    it("writes the whole document to the Private section when no folder is named", async () => {
        const write = writes();
        const { session, tool } = toolWith(write);

        const result = await tool.run(
            { title: "Scenario Simulator — Business Plan", content: PLAN },
            signal
        );

        expect(tool.name).toBe("create_document");
        expect(write).toHaveBeenCalledWith(ctx, {
            title: "Scenario Simulator — Business Plan",
            markdown: PLAN,
            folder: "Unfiled",
            requestUrl: REQUEST_URL,
        });
        expect(result).toContain('Created "Scenario Simulator — Business Plan" (d41)');
        expect(result).toContain("Private section: only they can open it");
        expect(session.created).toEqual([
            { documentId: 41, title: "Scenario Simulator — Business Plan", folder: "Unfiled" },
        ]);
    });

    it("reads Private and Unfiled as no folder, never as a folder to create", async () => {
        for (const folder of ["Private", "private space", "Unfiled", null]) {
            const write = writes();
            const { tool } = toolWith(write);
            await tool.run({ title: "Plan", content: PLAN, folder }, signal);
            expect(write.mock.calls[0]?.[1].folder).toBe("Unfiled");
        }
    });

    it("files into the folder the person named, and says it follows that folder", async () => {
        const write = writes(42, "Company/Plans");
        const { tool } = toolWith(write);

        const result = await tool.run(
            { title: "Plan", content: PLAN, folder: " Company / Plans " },
            signal
        );

        expect(write.mock.calls[0]?.[1].folder).toBe("Company/Plans");
        expect(result).toContain('in the folder "Company/Plans", with that folder\'s sharing');
    });

    it("turns a folder the person cannot add to into words the model can act on", async () => {
        const write = jest.fn(async () => {
            throw new DocumentWriteDenied("Board");
        });
        const { session, tool } = toolWith(write);

        await expect(
            tool.run({ title: "Plan", content: PLAN, folder: "Board" }, signal)
        ).rejects.toThrow(
            'The person cannot add files to "Board". Create it without a folder (their Private section), or ask them which folder to use.'
        );
        expect(session.created).toEqual([]);
    });

    it("refuses an empty document, a missing title and an invalid folder", async () => {
        const write = writes();
        const { tool } = toolWith(write);

        await expect(tool.run({ title: "Plan", content: "   " }, signal)).rejects.toThrow(
            "content must not be empty"
        );
        await expect(tool.run({ content: PLAN }, signal)).rejects.toThrow("title");
        await expect(
            tool.run({ title: "Plan", content: PLAN, folder: "Unfiled/Plans" }, signal)
        ).rejects.toThrow("Invalid folder");
        expect(write).not.toHaveBeenCalled();
    });

    it("gives back the first document when the model sends the same one again", async () => {
        const write = writes();
        const { session, tool } = toolWith(write);

        await tool.run({ title: "Plan", content: PLAN }, signal);
        const again = await tool.run({ title: "Plan", content: PLAN }, signal);

        expect(write).toHaveBeenCalledTimes(1);
        expect(again).toContain("was already created");
        expect(session.created).toHaveLength(1);
    });

    it("stops after three documents in one answer", async () => {
        let next = 50;
        const write = jest.fn(async (_ctx: unknown, input: WriteDocumentInput) => ({
            documentId: next++,
            title: input.title,
            folder: "Unfiled",
        }));
        const { tool } = toolWith(write);

        for (const n of [1, 2, 3]) await tool.run({ title: `Doc ${n}`, content: PLAN }, signal);
        await expect(tool.run({ title: "Doc 4", content: PLAN }, signal)).rejects.toThrow(
            "document budget for this answer is used up"
        );
        expect(write).toHaveBeenCalledTimes(3);
    });

    it("says what it is writing while it runs", () => {
        const { tool } = toolWith(writes());
        expect(tool.describe({ title: "Scenario Simulator — Business Plan" })).toBe(
            "Writing “Scenario Simulator — Business Plan”"
        );
        expect(tool.describe({})).toBe("Writing a document");
    });

    it("says it in the reader's language", () => {
        const { tools } = createDocumentTools(
            ctx,
            { requestUrl: REQUEST_URL, locale: "zh-CN" },
            { write: writes() }
        );
        expect(tools[0]!.describe({ title: "商业计划" })).toBe("正在撰写“商业计划”");
        expect(tools[0]!.describe({})).toBe("正在撰写文档");
    });
});

describe("writing to the workspace", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (canEditFolder as jest.Mock).mockResolvedValue(true);
        (uploadFile as jest.Mock).mockResolvedValue({ url: "/api/files/9", provider: "database" });
        (processDocumentUpload as jest.Mock).mockImplementation(async params => ({
            document: {
                id: 41,
                title: params.documentName,
                url: "/api/files/9",
                category: params.category ?? "Unfiled",
            },
            createdDocuments: [
                { id: 41, title: params.documentName, category: params.category ?? "Unfiled" },
            ],
        }));
    });

    it("takes the upload path for a loose Markdown file, so it starts private to the person", async () => {
        const created = await writeWorkspaceDocument(ctx, {
            title: "Scenario Simulator — Business Plan",
            markdown: PLAN,
            folder: "Unfiled",
            requestUrl: REQUEST_URL,
        });

        expect(canEditFolder).toHaveBeenCalledWith(ctx, "Unfiled");
        expect(uploadFile).toHaveBeenCalledWith(
            expect.objectContaining({
                filename: "Scenario-Simulator-Business-Plan.md",
                contentType: "text/markdown",
                userId: ctx.authUserId,
                companyId: ctx.companyId,
            })
        );
        const params = (processDocumentUpload as jest.Mock).mock.calls[0][0];
        expect(params).toMatchObject({
            documentName: "Scenario Simulator — Business Plan",
            rawDocumentUrl: "/api/files/9",
            requestUrl: REQUEST_URL,
            category: undefined,
            mimeType: "text/markdown",
            explicitStorageType: "database",
        });
        expect(params.creationKey).toMatch(/^chat-document:7:/);
        expect(recordUpload).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({ document: expect.objectContaining({ id: 41 }) })
        );
        expect(created).toEqual({
            documentId: 41,
            title: "Scenario Simulator — Business Plan",
            folder: "Unfiled",
        });
    });

    it("files into a folder the person can add to", async () => {
        await writeWorkspaceDocument(ctx, {
            title: "Plan",
            markdown: PLAN,
            folder: "Company",
            requestUrl: REQUEST_URL,
        });
        expect((processDocumentUpload as jest.Mock).mock.calls[0][0].category).toBe("Company");
    });

    it("stores nothing when the person cannot add to the folder", async () => {
        (canEditFolder as jest.Mock).mockResolvedValue(false);
        await expect(
            writeWorkspaceDocument(ctx, {
                title: "Plan",
                markdown: PLAN,
                folder: "Board",
                requestUrl: REQUEST_URL,
            })
        ).rejects.toBeInstanceOf(DocumentWriteDenied);
        expect(uploadFile).not.toHaveBeenCalled();
        expect(processDocumentUpload).not.toHaveBeenCalled();
    });

    it("names the file after the title", () => {
        expect(documentFilename("Q4 runway: raise vs. bootstrap")).toBe(
            "Q4-runway-raise-vs-bootstrap.md"
        );
        expect(documentFilename("—")).toBe("document.md");
    });
});

describe("what the model is told", () => {
    it("says to create the document, never to have the person paste it", () => {
        const prompt = documentToolsPrompt();
        expect(prompt).toContain("`create_document`");
        expect(prompt).toContain("never say you cannot create files");
        expect(prompt).toContain("never ask them to copy and paste it");
        expect(prompt).toContain("Their private space is their Private section");
    });

    it("asks for a grounded document and a short answer about it", () => {
        const prompt = documentToolsPrompt();
        expect(prompt).toContain("look through their sources first");
        expect(prompt).toContain("as an assumption to check");
        expect(prompt).toContain("Do not repeat the document in the chat");
    });

    it("without upload access, blames the role, not LaunchStack", () => {
        const prompt = noDocumentToolsPrompt();
        expect(prompt).toContain("role in the workspace cannot add documents");
        expect(prompt).toContain("never that LaunchStack cannot create documents");
    });
});
