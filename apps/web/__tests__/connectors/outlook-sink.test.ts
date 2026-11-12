/**
 * The Outlook sink: where a synced conversation or attachment becomes a
 * document. What matters: the identity (`connector:outlook:<conn>:<source>`),
 * the metadata the rest of the app reads back (connector, connection,
 * conversation, the Outlook web link), the workspace stamp on the upload
 * (without it only the OCR worker could read the file), and that mail which
 * has gone from Outlook is flagged, never deleted.
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

const mockUpdateSet = jest.fn();
const mockUpdateWhere = jest.fn();
const mockDelete = jest.fn();
jest.mock("~/server/db", () => ({
    db: {
        update: () => ({
            set: (values: unknown) => {
                mockUpdateSet(values);
                return { where: mockUpdateWhere };
            },
        }),
        delete: (...args: unknown[]) => mockDelete(...args),
    },
}));

import type { KnowledgeItem } from "@launchstack/pipelines/connectors";
import { resolveIngestIndexKey } from "@launchstack/llm/embeddings";

import { uploadFile } from "~/lib/storage";
import {
    createDocumentLifecycle,
    createDocumentVersionLifecycle,
    findDocumentByCreationKey,
} from "~/server/services/document-creation";
import { createOutlookSink, markMissingDocuments } from "~/server/services/connectors/outlook/sink";

const mockUploadFile = uploadFile as jest.Mock;
const WEB_LINK = "https://outlook.office365.com/owa/?ItemID=AAMkMsg2&exvsurl=1";

function conversationItem(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
    return {
        sourceId: "AAQkConv1",
        connectorId: "outlook",
        title: "Re: Contract renewal",
        kind: "outlook-conversation",
        mimeType: "text/markdown",
        bytes: 22,
        modifiedAt: "2026-11-01T00:00:00.000Z",
        location: { origin: WEB_LINK, relativePath: "AAQkConv1.md" },
        metadata: {
            outlookConversationId: "AAQkConv1",
            outlookLink: WEB_LINK,
            subject: "Contract renewal",
            participants: ["Ada <ada@acme.com>"],
            lastMessageAt: "2026-11-01T00:00:00.000Z",
            extension: ".md",
        },
        content: "# Re: Contract renewal",
        contentHash: "msgs:abc",
        ...overrides,
    };
}

function attachmentItem(): KnowledgeItem {
    return {
        sourceId: "AAQkConv1:AAMkMsg2:AAMkAtt1",
        connectorId: "outlook",
        title: "Renewal terms.pdf",
        kind: "outlook-attachment",
        mimeType: "application/pdf",
        bytes: 4,
        modifiedAt: "2026-11-01T00:00:00.000Z",
        location: { origin: WEB_LINK, relativePath: "AAQkConv1/Renewal terms.pdf" },
        metadata: {
            outlookConversationId: "AAQkConv1",
            outlookMessageId: "AAMkMsg2",
            outlookAttachmentId: "AAMkAtt1",
            outlookLink: WEB_LINK,
            subject: "Contract renewal",
            extension: ".pdf",
        },
        content: new Uint8Array([37, 80, 68, 70]),
        contentHash: "att:AAMkMsg2:AAMkAtt1",
    };
}

const context = {
    companyId: 7n,
    connectionId: 4,
    userId: "user_abc",
    category: "Outlook/ada@acme.com",
};

beforeEach(() => {
    jest.clearAllMocks();
    (resolveIngestIndexKey as jest.Mock).mockResolvedValue("openai-small");
    mockUploadFile.mockResolvedValue({ url: "https://blob.test/conversation.md" });
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

describe("createOutlookSink", () => {
    it("files a new conversation in the owner's folder under its own identity", async () => {
        const sink = await createOutlookSink(context);
        const stored = await sink.store(conversationItem());

        expect(stored).toMatchObject({ sourceId: "AAQkConv1", documentId: 11, revised: false });
        expect(findDocumentByCreationKey).toHaveBeenCalledWith(7n, "connector:outlook:4:AAQkConv1");
        expect(createDocumentLifecycle).toHaveBeenCalledWith(
            expect.objectContaining({
                companyId: 7n,
                userId: "user_abc",
                category: "Outlook/ada@acme.com",
                creationKey: "connector:outlook:4:AAQkConv1",
                mimeType: "text/markdown",
                ocrMetadata: expect.objectContaining({
                    connector: "outlook",
                    connectionId: "4",
                    sourceId: "AAQkConv1",
                    contentHash: "msgs:abc",
                    outlookKind: "conversation",
                    outlookConversationId: "AAQkConv1",
                    outlookMessageId: null,
                    outlookLink: WEB_LINK,
                }),
                processing: expect.objectContaining({
                    originalFilename: "Re-Contract-renewal.md",
                    embeddingIndexKey: "openai-small",
                }),
            })
        );
    });

    it("stamps the workspace on the upload, first sync and revision alike", async () => {
        const sink = await createOutlookSink(context);
        await sink.store(conversationItem());
        expect(mockUploadFile).toHaveBeenLastCalledWith(
            expect.objectContaining({ userId: "user_abc", companyId: 7n })
        );

        (findDocumentByCreationKey as jest.Mock).mockResolvedValue({
            id: 11,
            ocrMetadata: { contentHash: "msgs:old" },
        });
        const revised = await sink.store(conversationItem({ contentHash: "msgs:new" }));

        expect(revised.revised).toBe(true);
        expect(mockUploadFile).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: 7n }));
        // The message set is part of the version's key, so a repeat converges.
        expect(createDocumentVersionLifecycle).toHaveBeenCalledWith(
            expect.objectContaining({
                documentId: 11,
                creationKey: "connector:outlook:4:AAQkConv1:v:msgs:new",
            })
        );
        // The fingerprint that drives change detection moves with the version.
        expect(mockUpdateSet).toHaveBeenCalledWith({
            ocrMetadata: expect.objectContaining({ contentHash: "msgs:new", connector: "outlook" }),
        });
    });

    it("keeps an attachment as its own document, tied to its conversation and message", async () => {
        const sink = await createOutlookSink(context);
        await sink.store(attachmentItem());

        expect(createDocumentLifecycle).toHaveBeenCalledWith(
            expect.objectContaining({
                creationKey: "connector:outlook:4:AAQkConv1:AAMkMsg2:AAMkAtt1",
                mimeType: "application/pdf",
                ocrMetadata: expect.objectContaining({
                    outlookKind: "attachment",
                    outlookConversationId: "AAQkConv1",
                    outlookMessageId: "AAMkMsg2",
                    outlookLink: WEB_LINK,
                }),
                processing: expect.objectContaining({ originalFilename: "Renewal-terms.pdf" }),
            })
        );
    });

    it("stores no link when Outlook sent none: a bare conversation id is not an address", async () => {
        const sink = await createOutlookSink(context);
        await sink.store(
            conversationItem({
                location: { origin: "AAQkConv1", relativePath: "AAQkConv1.md" },
                metadata: { outlookConversationId: "AAQkConv1", outlookLink: null },
            })
        );

        expect(createDocumentLifecycle).toHaveBeenCalledWith(
            expect.objectContaining({
                ocrMetadata: expect.objectContaining({ outlookLink: null }),
            })
        );
    });

    it("answers the last synced fingerprint, so an unchanged conversation is skipped", async () => {
        (findDocumentByCreationKey as jest.Mock).mockResolvedValue({
            id: 11,
            ocrMetadata: { contentHash: "msgs:abc" },
        });
        const sink = await createOutlookSink(context);

        await expect(sink.lastSyncedHash!(conversationItem())).resolves.toBe("msgs:abc");
    });
});

describe("markMissingDocuments", () => {
    it("flags mail that is gone from Outlook and deletes nothing", async () => {
        await markMissingDocuments(7n, 4, ["AAQkConv1", "AAQkConv1:AAMkMsg2:AAMkAtt1"]);

        expect(mockUpdateSet).toHaveBeenCalledTimes(1);
        expect(mockUpdateWhere).toHaveBeenCalledTimes(1);
        expect(mockDelete).not.toHaveBeenCalled();
    });

    it("does nothing for an empty list", async () => {
        await markMissingDocuments(7n, 4, []);
        expect(mockUpdateSet).not.toHaveBeenCalled();
    });
});
