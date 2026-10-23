/**
 * The Gmail sink's blob upload. With the database storage backend the
 * upload becomes a `file_uploads` row, and `/api/files/[id]` denies every
 * session read of a row with no company stamp — so a synced thread nobody
 * stamped could only ever be read by the OCR worker.
 */

jest.mock("~/env", () => ({ env: { server: { APP_PUBLIC_URL: undefined } } }));
jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));
jest.mock("~/lib/storage", () => ({ uploadFile: jest.fn() }));
jest.mock("@launchstack/llm/embeddings", () => ({ resolveIngestIndexKey: jest.fn() }));
jest.mock("~/server/services/document-creation", () => ({
    createDocumentLifecycle: jest.fn(),
    createDocumentVersionLifecycle: jest.fn(),
    findDocumentByCreationKey: jest.fn(),
}));

const mockUpdateWhere = jest.fn();
jest.mock("~/server/db", () => ({
    db: { update: () => ({ set: () => ({ where: mockUpdateWhere }) }) },
}));

import type { KnowledgeItem } from "@launchstack/pipelines/connectors";
import { resolveIngestIndexKey } from "@launchstack/llm/embeddings";

import { uploadFile } from "~/lib/storage";
import {
    createDocumentLifecycle,
    createDocumentVersionLifecycle,
    findDocumentByCreationKey,
} from "~/server/services/document-creation";
import { createGmailSink } from "~/server/services/connectors/gmail/sink";

const mockUploadFile = uploadFile as jest.Mock;

function threadItem(): KnowledgeItem {
    return {
        sourceId: "thread-1",
        connectorId: "gmail",
        title: "Re: Contract renewal",
        kind: "gmail-thread",
        mimeType: "text/markdown",
        bytes: 20,
        modifiedAt: "2026-10-01T00:00:00.000Z",
        location: {
            origin: "https://mail.google.com/mail/u/0/#all/thread-1",
            relativePath: "thread-1",
        },
        metadata: { gmailThreadId: "thread-1", extension: ".md" },
        content: "# Re: Contract renewal",
        contentHash: "hist-2",
    };
}

const context = {
    companyId: 7n,
    connectionId: 4,
    userId: "user_abc",
    category: "Gmail/abc@example.com",
};

beforeEach(() => {
    jest.clearAllMocks();
    (resolveIngestIndexKey as jest.Mock).mockResolvedValue("openai-small");
    mockUploadFile.mockResolvedValue({ url: "https://blob.test/thread.md" });
    (findDocumentByCreationKey as jest.Mock).mockResolvedValue(null);
    (createDocumentLifecycle as jest.Mock).mockResolvedValue({
        documentId: 11,
        versionId: 21,
        jobId: "job-1",
    });
    (createDocumentVersionLifecycle as jest.Mock).mockResolvedValue({
        documentId: 11,
        versionId: 22,
        jobId: "job-2",
    });
});

describe("createGmailSink — upload stamp", () => {
    it("stamps the workspace on a first-sync upload", async () => {
        const sink = await createGmailSink(context);
        await sink.store(threadItem());

        expect(mockUploadFile).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "user_abc", companyId: 7n })
        );
    });

    it("stamps the workspace on a revision's upload", async () => {
        (findDocumentByCreationKey as jest.Mock).mockResolvedValue({
            id: 11,
            ocrMetadata: { contentHash: "hist-1" },
        });

        const sink = await createGmailSink(context);
        const result = await sink.store(threadItem());

        expect(result.revised).toBe(true);
        expect(mockUploadFile).toHaveBeenCalledWith(expect.objectContaining({ companyId: 7n }));
    });
});
