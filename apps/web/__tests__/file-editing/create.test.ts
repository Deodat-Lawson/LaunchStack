/**
 * createMarkdownFile — a blank file is a real source from the start: stored
 * as Markdown, seeded with its title as a heading, ingested like an upload.
 */
jest.mock("~/lib/storage", () => ({ uploadFile: jest.fn() }));
jest.mock("~/server/services/document-upload", () => ({ processDocumentUpload: jest.fn() }));

import { uploadFile } from "~/lib/storage";
import { processDocumentUpload } from "~/server/services/document-upload";
import {
    createMarkdownFile,
    markdownFilename,
    seedMarkdown,
} from "~/server/services/file-editing/create";

const mockUpload = uploadFile as jest.Mock;
const mockProcess = processDocumentUpload as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    mockUpload.mockResolvedValue({ url: "/api/files/3", provider: "database" });
    mockProcess.mockResolvedValue({
        document: { id: 61, title: "Q3: plan / draft", url: "/api/files/3", category: "Strategy" },
        createdDocuments: [],
    });
});

describe("createMarkdownFile", () => {
    it("stores the seeded Markdown and ingests it under the title as typed", async () => {
        const result = await createMarkdownFile({
            companyId: BigInt(9),
            authUserId: "auth-1",
            title: "Q3: plan / draft",
            category: "Strategy",
            requestUrl: "https://app.test/api/files",
        });

        expect(mockUpload).toHaveBeenCalledWith({
            filename: "Q3 plan draft.md",
            data: Buffer.from("# Q3: plan / draft\n", "utf8"),
            contentType: "text/markdown",
            userId: "auth-1",
            companyId: BigInt(9),
        });
        expect(mockProcess).toHaveBeenCalledWith(
            expect.objectContaining({
                user: { userId: "auth-1", companyId: BigInt(9) },
                documentName: "Q3: plan / draft",
                rawDocumentUrl: "/api/files/3",
                category: "Strategy",
                explicitStorageType: "database",
                mimeType: "text/markdown",
                originalFilename: "Q3 plan draft.md",
                creationKey: expect.stringMatching(/^file:create:[0-9a-f-]{36}$/),
            })
        );
        expect(result).toMatchObject({ documentId: 61, title: "Q3: plan / draft" });
    });

    it("gives every create its own creation key", async () => {
        const params = {
            companyId: BigInt(9),
            authUserId: "auth-1",
            title: "Same",
            category: "Unfiled",
            requestUrl: "https://app.test/api/files",
        };
        await createMarkdownFile(params);
        await createMarkdownFile(params);
        const [a, b] = mockProcess.mock.calls.map(
            ([arg]) => (arg as { creationKey: string }).creationKey
        );
        expect(a).not.toBe(b);
    });
});

describe("markdownFilename / seedMarkdown", () => {
    it.each([
        ["Plan", "Plan.md"],
        ["notes.md", "notes.md"],
        ['a<b>:"c"|?*', "a b c.md"],
        ["   ", "untitled.md"],
        ["无标题文档", "无标题文档.md"],
    ])("names %j as %j", (title, filename) => {
        expect(markdownFilename(title)).toBe(filename);
    });

    it("keeps the heading on one line", () => {
        expect(seedMarkdown("A\nB")).toBe("# A B\n");
    });
});
