/**
 * save_conversation end to end through the service, with the storage and
 * source-lifecycle seams mocked the way the publish route tests mock them:
 * who may save, what a first save creates (a private Unfiled source with the
 * conversation marker), what a re-save does (a new version of the same
 * document, or nothing for an identical transcript), and when the follow-up
 * is queued.
 */

import { document } from "@launchstack/store/schema";
import { saveAssistantConversation } from "~/server/assistant-conversations";
import { runAfterResponse } from "~/server/assistant-conversations/after-response";
import { writeFollowUp } from "~/server/assistant-conversations/follow-up";
import { followUpModelUnavailable } from "~/server/assistant-conversations/follow-up-model";
import { ConversationSaveError } from "~/server/assistant-conversations/types";
import { assistantConversations } from "~/server/db/schema";
import type { McpPrincipal } from "~/server/mcp/principal";
import { uploadFile } from "~/lib/storage";
import { createDocumentVersionLifecycle } from "~/server/services/document-creation";
import { processDocumentUpload } from "~/server/services/document-upload";
import { canEditFolder } from "~/server/services/folder-access";
import { recordUpload } from "~/server/workspace/added-documents";
import { canEditDocument } from "~/server/workspace/item-access";

import { fakeDb } from "../../helpers/fake-db";
import { makeWorkspaceContext } from "../../helpers/workspace-context";

jest.mock("~/server/db", () => ({ db: jest.requireActual("../../helpers/fake-db").fakeDb.db }));
jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));
jest.mock("~/lib/storage", () => ({ uploadFile: jest.fn() }));
jest.mock("@launchstack/conversion/ocr/config", () => ({
    getOcrConfig: () => ({ defaultProvider: "AZURE", appPublicUrl: "https://app.test" }),
}));
jest.mock("~/server/services/internal-file-ref", () => ({
    authorizeInternalFileRef: jest.fn().mockResolvedValue(null),
}));
jest.mock("~/server/services/document-upload", () => ({
    processDocumentUpload: jest.fn(),
    toAbsoluteUrl: (url: string, base: string) => new URL(url, base).toString(),
}));
jest.mock("~/server/services/document-creation", () => ({
    createDocumentVersionLifecycle: jest.fn(),
}));
jest.mock("~/server/services/folder-access", () => ({
    FOLDER_EDIT_DENIED: "You do not have edit access to this folder.",
    DOCUMENT_EDIT_DENIED: "You can view this file but not change it.",
    canEditFolder: jest.fn(),
}));
jest.mock("~/server/workspace/item-access", () => ({ canEditDocument: jest.fn() }));
jest.mock("~/server/workspace/added-documents", () => ({ recordUpload: jest.fn() }));
jest.mock("~/server/assistant-conversations/follow-up-model", () => ({
    followUpModelUnavailable: jest.fn(),
}));
jest.mock("~/server/assistant-conversations/after-response", () => ({
    runAfterResponse: jest.fn(),
}));
jest.mock("~/server/assistant-conversations/follow-up", () => ({
    writeFollowUp: jest.fn().mockResolvedValue("done"),
}));

const ORIGIN = "http://localhost:3031";

function principal(
    overrides: {
        role?: string;
        scopes?: string[];
        label?: string;
        family?: McpPrincipal["family"];
    } = {}
): McpPrincipal {
    return {
        ctx: makeWorkspaceContext({
            authUserId: "ada",
            userPk: BigInt(7),
            companyId: BigInt(5),
            role: overrides.role ?? "member",
        }),
        scopes: new Set(overrides.scopes ?? ["launchstack:read", "launchstack:write"]),
        credential: { kind: "key", keyId: 1 },
        label: overrides.label ?? "Claude Code",
        family: overrides.family ?? "claude",
        rateLimitKey: "mcp:ada:5",
    };
}

const MESSAGES = [
    { role: "user" as const, content: "Should we raise prices?" },
    { role: "assistant" as const, content: "Yes, by 10% for new customers." },
];

function upload(id = 40) {
    const doc = { id, title: "Pricing", url: "/api/files/9", category: "Unfiled" };
    return {
        jobId: "job",
        eventIds: [],
        storageType: "database",
        document: doc,
        createdDocuments: [doc],
        resolvedDocumentUrl: "/api/files/9",
    };
}

async function expectRefusal(promise: Promise<unknown>, code: ConversationSaveError["code"]) {
    const error = await promise.then(
        () => null,
        (e: unknown) => e
    );
    expect(error).toBeInstanceOf(ConversationSaveError);
    expect((error as ConversationSaveError).code).toBe(code);
    return error as ConversationSaveError;
}

beforeEach(() => {
    jest.clearAllMocks();
    fakeDb.reset();
    (uploadFile as jest.Mock).mockResolvedValue({ url: "/api/files/9", provider: "database" });
    (processDocumentUpload as jest.Mock).mockResolvedValue(upload());
    (createDocumentVersionLifecycle as jest.Mock).mockResolvedValue({
        document: { id: 40 },
        jobId: "job-2",
    });
    (canEditFolder as jest.Mock).mockResolvedValue(true);
    (canEditDocument as jest.Mock).mockResolvedValue(true);
    (followUpModelUnavailable as jest.Mock).mockReturnValue(null);
});

describe("who may save", () => {
    it("refuses a role without documents.upload", async () => {
        const error = await expectRefusal(
            saveAssistantConversation({
                principal: principal({ role: "viewer" }),
                origin: ORIGIN,
                title: "Pricing",
                messages: MESSAGES,
            }),
            "forbidden"
        );
        expect(error.message).toMatch(/cannot add files/);
        expect(uploadFile).not.toHaveBeenCalled();
        expect(fakeDb.inserts).toHaveLength(0);
    });

    it("refuses a read-only connection", async () => {
        await expectRefusal(
            saveAssistantConversation({
                principal: principal({ scopes: ["launchstack:read"] }),
                origin: ORIGIN,
                title: "Pricing",
                messages: MESSAGES,
            }),
            "forbidden"
        );
        expect(uploadFile).not.toHaveBeenCalled();
    });

    it("checks permission before validating", async () => {
        await expectRefusal(
            saveAssistantConversation({
                principal: principal({ role: "viewer" }),
                origin: ORIGIN,
                title: "",
                messages: [],
            }),
            "forbidden"
        );
    });

    it("reports invalid input without storing anything", async () => {
        await expectRefusal(
            saveAssistantConversation({
                principal: principal(),
                origin: ORIGIN,
                title: "Pricing",
                messages: [],
            }),
            "invalid"
        );
        expect(uploadFile).not.toHaveBeenCalled();
    });
});

describe("first save", () => {
    it("stores a private Unfiled source with the conversation marker and queues the follow-up", async () => {
        const result = await saveAssistantConversation({
            principal: principal(),
            origin: `${ORIGIN}/`,
            title: "Pricing",
            messages: MESSAGES,
            model: "claude-opus",
        });

        expect(result).toEqual({
            conversationId: 40,
            status: "created",
            title: "Pricing",
            url: "http://localhost:3031/employer/documents?source=d40",
            followUp: "queued",
        });

        const stored = (uploadFile as jest.Mock).mock.calls[0][0];
        expect(stored.contentType).toBe("text/markdown");
        const markdown = (stored.data as Buffer).toString("utf8");
        expect(markdown).toMatch(
            /^# Pricing\n\n> Saved from Claude \(Claude Code\) · .* · 2 messages · model claude-opus\n/
        );

        const params = (processDocumentUpload as jest.Mock).mock.calls[0][0];
        // No folder: Unfiled, which ADR-014 makes private to the saver.
        expect(params.category).toBeUndefined();
        expect(params.mimeType).toBe("text/markdown");
        expect(params.creationKey).toMatch(/^assistant-conversation:7:/);
        expect(params.ocrMetadata).toEqual({
            connector: "assistant-conversations",
            assistant: "claude",
            clientName: "Claude Code",
            model: "claude-opus",
            contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
            savedAt: expect.any(String),
            messageCount: 2,
        });
        expect(canEditFolder).toHaveBeenCalledWith(expect.anything(), "Unfiled");
        expect(recordUpload).toHaveBeenCalledWith(
            expect.objectContaining({ authUserId: "ada", userPk: BigInt(7), companyId: BigInt(5) }),
            upload()
        );

        const [row] = fakeDb.insertedInto(assistantConversations);
        expect(row).toMatchObject({
            companyId: BigInt(5),
            documentId: BigInt(40),
            savedByUserId: BigInt(7),
            client: "claude",
            clientName: "Claude Code",
            title: "Pricing",
            contentHash: params.ocrMetadata.contentHash,
            messageCount: 2,
            followUpStatus: "pending",
            followUpError: null,
        });

        expect(runAfterResponse).toHaveBeenCalledTimes(1);
        const work = (runAfterResponse as jest.Mock).mock.calls[0][1] as () => Promise<unknown>;
        await work();
        expect(writeFollowUp).toHaveBeenCalledWith(
            expect.objectContaining({
                documentId: 40,
                authUserId: "ada",
                title: "Pricing",
                family: "claude",
                contentHash: params.ocrMetadata.contentHash,
            })
        );
    });

    it("labels the conversation with the assistant the caller names", async () => {
        await saveAssistantConversation({
            principal: principal({ label: "My key", family: "other" }),
            origin: ORIGIN,
            title: "Pricing",
            messages: MESSAGES,
            assistant: "chatgpt",
        });
        const params = (processDocumentUpload as jest.Mock).mock.calls[0][0];
        expect(params.ocrMetadata.assistant).toBe("chatgpt");
        expect(fakeDb.insertedInto(assistantConversations)[0]).toMatchObject({
            client: "chatgpt",
            clientName: "My key",
        });
    });

    it("still saves, and skips the follow-up, when no chat model is configured", async () => {
        (followUpModelUnavailable as jest.Mock).mockReturnValue("No chat model is configured");
        const result = await saveAssistantConversation({
            principal: principal(),
            origin: ORIGIN,
            title: "Pricing",
            messages: MESSAGES,
        });
        expect(result.status).toBe("created");
        expect(result.followUp).toBe("skipped");
        expect(fakeDb.insertedInto(assistantConversations)[0]).toMatchObject({
            followUpStatus: "skipped",
            followUpError: "No chat model is configured",
        });
        expect(runAfterResponse).not.toHaveBeenCalled();
    });

    it("points an identical repeat save at the conversation already saved", async () => {
        fakeDb.onSelect(assistantConversations, [{ documentId: BigInt(33), title: "Pricing" }]);
        const result = await saveAssistantConversation({
            principal: principal(),
            origin: ORIGIN,
            title: "Pricing",
            messages: MESSAGES,
        });
        expect(result).toEqual({
            conversationId: 33,
            status: "unchanged",
            title: "Pricing",
            url: "http://localhost:3031/employer/documents?source=d33",
            followUp: "unchanged",
        });
        expect(uploadFile).not.toHaveBeenCalled();
        expect(processDocumentUpload).not.toHaveBeenCalled();
        expect(runAfterResponse).not.toHaveBeenCalled();
    });

    it("refuses a transcript over the size limit before storing it", async () => {
        const big = "x".repeat(150_000);
        await expectRefusal(
            saveAssistantConversation({
                principal: principal(),
                origin: ORIGIN,
                title: "Huge",
                messages: Array.from({ length: 15 }, () => ({
                    role: "user" as const,
                    content: big,
                })),
            }),
            "too_large"
        );
        expect(uploadFile).not.toHaveBeenCalled();
    });
});

describe("saving again with conversationId", () => {
    async function existingRow(contentHash: string) {
        fakeDb.onSelect(assistantConversations, [
            {
                id: 3,
                companyId: BigInt(5),
                documentId: BigInt(40),
                savedByUserId: BigInt(7),
                title: "Pricing",
                contentHash,
                followUpNoteId: 900,
            },
        ]);
        fakeDb.onSelect(document, [{ id: 40, category: "Unfiled" }]);
    }

    /** The hash a first save of MESSAGES stores. */
    async function hashOfFirstSave(): Promise<string> {
        await saveAssistantConversation({
            principal: principal(),
            origin: ORIGIN,
            title: "Pricing",
            messages: MESSAGES,
        });
        const hash = (processDocumentUpload as jest.Mock).mock.calls[0][0].ocrMetadata
            .contentHash as string;
        jest.clearAllMocks();
        fakeDb.reset();
        (uploadFile as jest.Mock).mockResolvedValue({ url: "/api/files/10", provider: "database" });
        (createDocumentVersionLifecycle as jest.Mock).mockResolvedValue({
            document: { id: 40 },
            jobId: "job-2",
        });
        (canEditDocument as jest.Mock).mockResolvedValue(true);
        (followUpModelUnavailable as jest.Mock).mockReturnValue(null);
        return hash;
    }

    it("adds a new version of the same document and re-queues the follow-up", async () => {
        const original = await hashOfFirstSave();
        await existingRow(original);

        const result = await saveAssistantConversation({
            principal: principal(),
            origin: ORIGIN,
            title: "Pricing",
            messages: [...MESSAGES, { role: "user", content: "Do it." }],
            conversationId: 40,
        });

        expect(result).toEqual({
            conversationId: 40,
            status: "updated",
            title: "Pricing",
            url: "http://localhost:3031/employer/documents?source=d40",
            followUp: "queued",
        });
        expect(processDocumentUpload).not.toHaveBeenCalled();
        const version = (createDocumentVersionLifecycle as jest.Mock).mock.calls[0][0];
        expect(version).toMatchObject({
            documentId: 40,
            companyId: BigInt(5),
            userId: "ada",
            title: "Pricing",
            category: "Unfiled",
            url: "/api/files/10",
            processingUrl: "http://localhost:3031/api/files/10",
            mimeType: "text/markdown",
            changelog: "Saved again from Claude (Claude Code)",
        });
        expect(version.creationKey).toMatch(/^assistant-conversation:40:[0-9a-f]{64}:/);

        // The document row carries the new title and marker; the row the new hash.
        expect(fakeDb.updatesOf(document)[0]).toMatchObject({ title: "Pricing" });
        const [rowUpdate] = fakeDb.updatesOf(assistantConversations);
        expect(rowUpdate).toMatchObject({
            messageCount: 3,
            followUpStatus: "pending",
            followUpError: null,
        });
        expect(rowUpdate!.contentHash).not.toBe(original);
        expect(runAfterResponse).toHaveBeenCalledTimes(1);
    });

    it("does nothing for an identical transcript", async () => {
        const original = await hashOfFirstSave();
        await existingRow(original);

        const result = await saveAssistantConversation({
            principal: principal(),
            origin: ORIGIN,
            title: "Pricing",
            messages: MESSAGES,
            conversationId: 40,
        });

        expect(result.status).toBe("unchanged");
        expect(result.followUp).toBe("unchanged");
        expect(uploadFile).not.toHaveBeenCalled();
        expect(createDocumentVersionLifecycle).not.toHaveBeenCalled();
        expect(fakeDb.updates).toHaveLength(0);
        expect(runAfterResponse).not.toHaveBeenCalled();
    });

    it("cannot reach a conversation someone else saved (or none at all)", async () => {
        // The row lookup is scoped to company + saver; nothing comes back.
        const error = await expectRefusal(
            saveAssistantConversation({
                principal: principal(),
                origin: ORIGIN,
                title: "Pricing",
                messages: MESSAGES,
                conversationId: 41,
            }),
            "not_found"
        );
        expect(error.message).toMatch(/Save without conversationId to create a new one/);
        expect(createDocumentVersionLifecycle).not.toHaveBeenCalled();
    });

    it("needs edit access to the source it replaces", async () => {
        await existingRow("different");
        (canEditDocument as jest.Mock).mockResolvedValue(false);
        await expectRefusal(
            saveAssistantConversation({
                principal: principal(),
                origin: ORIGIN,
                title: "Pricing",
                messages: MESSAGES,
                conversationId: 40,
            }),
            "forbidden"
        );
        expect(createDocumentVersionLifecycle).not.toHaveBeenCalled();
    });
});
