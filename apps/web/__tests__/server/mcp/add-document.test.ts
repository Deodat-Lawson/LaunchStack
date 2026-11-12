/**
 * add_document's conversation with the assistant: it never guesses a folder,
 * asks in words (draftId) or with a form (2026-07-28 `input_required`), asks
 * about a same-title document, files on the answer, and refuses forged or
 * stale answers. Storage and filing are mocked; their own tests and the live
 * runs cover the database.
 */
import type { McpPrincipal } from "~/server/mcp/principal";
import { isInputRequired, type McpToolContext, type McpToolOutcome } from "~/server/mcp/protocol";
import { argumentsDigest, signRequestState } from "~/server/mcp/request-state";
import { addDocumentTool } from "~/server/mcp/tools/add-document";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

jest.mock("~/server/assistant-documents", () => {
    class AssistantDocumentError extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    }
    return {
        AssistantDocumentError,
        listFolderChoices: jest.fn(),
        resolveDestination: jest.fn(),
        findSameTitle: jest.fn(),
        fileStagedDocument: jest.fn(),
    };
});

jest.mock("~/server/mcp/staging", () => {
    class StagingError extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    }
    return {
        StagingError,
        MAX_STAGED_BYTES: 128 * 1024 * 1024,
        stageDraft: jest.fn(),
        loadStagedFile: jest.fn(),
        discardStagedFile: jest.fn(),
        readBodyWithLimit: jest.fn(),
    };
});

jest.mock("~/server/mcp/remote-file", () => {
    class RemoteFileError extends Error {}
    return { RemoteFileError, downloadAssistantFile: jest.fn() };
});

const documents = jest.requireMock<
    Record<string, jest.Mock> & {
        AssistantDocumentError: new (code: string, message: string) => Error;
    }
>("~/server/assistant-documents");
const staging = jest.requireMock<
    Record<string, jest.Mock> & {
        StagingError: new (code: string, message: string) => Error;
    }
>("~/server/mcp/staging");
const remote = jest.requireMock<Record<string, jest.Mock>>("~/server/mcp/remote-file");

const ORIGIN = "https://launchstack.test";
const DRAFT = "draft_abcdefghijklmnop";
const previousSecret = process.env.BETTER_AUTH_SECRET;

function principal(): McpPrincipal {
    return {
        ctx: makeWorkspaceContext({ role: "member", authUserId: "user-a", companyId: BigInt(5) }),
        scopes: new Set(["launchstack:read", "launchstack:write"]),
        credential: { kind: "oauth", clientId: "client-1" },
        label: "Claude Code",
        family: "claude",
        rateLimitKey: "mcp:user-a:5",
    };
}

function staged(overrides: Record<string, unknown> = {}) {
    return {
        id: DRAFT,
        companyId: BigInt(5),
        userId: BigInt(7),
        kind: "draft",
        status: "ready",
        uploadTokenHash: null,
        uploadExpiresAt: null,
        filename: "Plan.md",
        mimeType: "text/markdown",
        sizeBytes: 12,
        storageUrl: "s3:staged/plan.md",
        storageProvider: "s3",
        details: {
            suggestedTitle: "Plan",
            ingestMimeType: "text/markdown",
            artifactType: null,
            origin: "chatgpt",
            sourceUrl: null,
        },
        expiresAt: new Date(Date.now() + 3_600_000),
        usedAt: null,
        documentId: null,
        createdAt: new Date(),
        ...overrides,
    };
}

const CHOICES = [
    { path: "Unfiled", audience: "private", whoCanSee: "only you", documentCount: 2 },
    {
        path: "Research",
        audience: "workspace",
        whoCanSee: "everyone in the workspace",
        documentCount: 9,
    },
];

type Client = McpToolContext["client"];
const LEGACY: Client = { era: "legacy", formElicitation: false };
const FORMS: Client = { era: "modern", formElicitation: true };

function call(
    args: Record<string, unknown>,
    client: Client = LEGACY,
    roundTrip: McpToolContext["roundTrip"] = null
): Promise<McpToolOutcome> {
    return addDocumentTool.call(args, {
        principal: principal(),
        origin: ORIGIN,
        client,
        roundTrip,
        rawArguments: args,
    });
}

function structured(outcome: McpToolOutcome): Record<string, unknown> {
    if (isInputRequired(outcome) || !outcome.ok) {
        throw new Error(`expected a result, got ${JSON.stringify(outcome)}`);
    }
    return outcome.structured;
}

function textOf(outcome: McpToolOutcome): string {
    if (isInputRequired(outcome)) throw new Error("expected a result");
    return outcome.ok ? outcome.text : outcome.message;
}

function stateFor(args: Record<string, unknown>, data: Record<string, unknown>) {
    return signRequestState(
        {
            tool: "add_document",
            authUserId: "user-a",
            companyId: BigInt(5),
            argumentsDigest: argumentsDigest(args),
        },
        data
    );
}

beforeAll(() => {
    process.env.BETTER_AUTH_SECRET = "add-document-test-secret";
});
afterAll(() => {
    process.env.BETTER_AUTH_SECRET = previousSecret;
});

beforeEach(() => {
    jest.clearAllMocks();
    documents.listFolderChoices!.mockResolvedValue(CHOICES);
    documents.resolveDestination!.mockImplementation(async (_ctx: unknown, folder: string) => ({
        path: folder,
        created: folder === "Brand new",
    }));
    documents.findSameTitle!.mockResolvedValue([]);
    documents.fileStagedDocument!.mockImplementation(
        async (_ctx: unknown, _origin: string, input: Record<string, unknown>) => ({
            documentId: (input.documentId as number | undefined) ?? 41,
            title: input.title,
            folder:
                typeof input.folder === "string" && input.folder !== "" ? input.folder : "Research",
            status: input.documentId ? "version_added" : "created",
            url: `${ORIGIN}/employer/documents?source=d41`,
            whoCanSee: "everyone in the workspace",
        })
    );
    staging.stageDraft!.mockResolvedValue(staged());
    staging.loadStagedFile!.mockResolvedValue(staged());
});

describe("asking in words (any client)", () => {
    it("stores the content as a draft, files nothing and lists the folders with who can see them", async () => {
        const outcome = await call({
            content: "# Plan\n\nBody",
            format: "markdown",
            origin: "chatgpt",
        });
        expect(staging.stageDraft).toHaveBeenCalledWith(
            expect.objectContaining({ companyId: BigInt(5) }),
            expect.objectContaining({ mimeType: "text/markdown", filename: "Plan.md" })
        );
        expect(documents.fileStagedDocument).not.toHaveBeenCalled();
        expect(structured(outcome)).toMatchObject({
            status: "needs_input",
            question: "folder",
            draftId: DRAFT,
            suggestedTitle: "Plan",
            folders: [
                { path: "Unfiled", whoCanSee: "only you" },
                { path: "Research", whoCanSee: "everyone in the workspace" },
            ],
        });
        const text = textOf(outcome);
        expect(text).toContain("Nothing was added yet");
        expect(text).toContain("Research (everyone in the workspace)");
        expect(text).toContain(`draftId "${DRAFT}"`);
        expect(text).toContain("Do not send the content again");
    });

    it("files the draft when called back with draftId and a folder", async () => {
        const outcome = await call({ draftId: DRAFT, folder: "Research", title: "Plan v1" });
        expect(staging.loadStagedFile).toHaveBeenCalledWith(expect.anything(), DRAFT);
        expect(staging.stageDraft).not.toHaveBeenCalled();
        expect(documents.fileStagedDocument).toHaveBeenCalledWith(
            expect.anything(),
            ORIGIN,
            expect.objectContaining({
                folder: "Research",
                title: "Plan v1",
                ingestMimeType: "text/markdown",
                artifact: null,
                fromLabel: "Claude Code",
                metadata: {
                    addedFrom: {
                        assistant: "claude",
                        clientName: "Claude Code",
                        origin: "chatgpt",
                    },
                },
            })
        );
        expect(structured(outcome)).toMatchObject({
            status: "created",
            documentId: 41,
            folder: "Research",
            whoCanSee: "everyone in the workspace",
        });
        expect(textOf(outcome)).toContain(
            "Link: https://launchstack.test/employer/documents?source=d41"
        );
    });

    it("files at once when the first call already names a folder", async () => {
        await call({ content: "# Plan", folder: "Research" });
        expect(staging.stageDraft).toHaveBeenCalled();
        expect(documents.fileStagedDocument).toHaveBeenCalledTimes(1);
    });

    it("says when it made a new folder", async () => {
        const outcome = await call({ draftId: DRAFT, folder: "Brand new" });
        expect(structured(outcome).createdFolder).toBe(true);
        expect(textOf(outcome)).toContain("(a new folder)");
    });

    it("asks about a same-title document, and adds it as new only when told to", async () => {
        documents.findSameTitle!.mockResolvedValue([{ id: 12, title: "Plan", isArtifact: false }]);
        const asked = await call({ draftId: DRAFT, folder: "Research" });
        expect(documents.fileStagedDocument).not.toHaveBeenCalled();
        expect(structured(asked)).toMatchObject({
            status: "needs_input",
            question: "duplicate",
            sameTitle: [{ documentId: 12, title: "Plan" }],
        });
        expect(textOf(asked)).toContain("documentId 12");

        await call({ draftId: DRAFT, folder: "Research", addAsNew: true });
        expect(documents.fileStagedDocument).toHaveBeenCalledWith(
            expect.anything(),
            ORIGIN,
            expect.not.objectContaining({ documentId: expect.anything() })
        );
    });

    it("adds a new version when given documentId, without asking for a folder", async () => {
        const outcome = await call({ draftId: DRAFT, documentId: "d12" });
        expect(documents.resolveDestination).not.toHaveBeenCalled();
        expect(documents.fileStagedDocument).toHaveBeenCalledWith(
            expect.anything(),
            ORIGIN,
            expect.objectContaining({ documentId: 12 })
        );
        expect(structured(outcome).status).toBe("version_added");
    });

    it("passes an artifact's type and source link through to filing", async () => {
        staging.loadStagedFile!.mockResolvedValue(
            staged({
                details: {
                    suggestedTitle: "Calculator",
                    ingestMimeType: "text/html",
                    artifactType: "html",
                    origin: "claude-artifact",
                    sourceUrl: "https://claude.ai/public/artifacts/abc",
                },
            })
        );
        await call({ draftId: DRAFT, folder: "Research" });
        expect(documents.fileStagedDocument).toHaveBeenCalledWith(
            expect.anything(),
            ORIGIN,
            expect.objectContaining({
                artifact: { type: "html", sourceUrl: "https://claude.ai/public/artifacts/abc" },
                ingestMimeType: "text/html",
            })
        );
    });

    it("tells the model plainly when a draft was already used or expired", async () => {
        staging.loadStagedFile!.mockRejectedValue(
            new staging.StagingError("used", "That draft was already added as document 41.")
        );
        const outcome = await call({ draftId: DRAFT, folder: "Research" });
        expect(isInputRequired(outcome) || outcome.ok).toBe(false);
        expect(textOf(outcome)).toContain("already added as document 41");
    });

    it("refuses a call carrying more than one thing to add, or none", async () => {
        for (const args of [{ content: "a", draftId: DRAFT }, { folder: "Research" }]) {
            const outcome = await call(args);
            expect(textOf(outcome)).toMatch(/^Invalid arguments for add_document: /);
        }
        expect(staging.stageDraft).not.toHaveBeenCalled();
    });
});

describe("QA round 1 fixes", () => {
    it("refuses content that is only whitespace", async () => {
        const outcome = await call({ content: "   \n\t ", folder: "Research" });
        expect(textOf(outcome)).toMatch(
            /^Invalid arguments for add_document: content: must not be empty/
        );
        expect(staging.stageDraft).not.toHaveBeenCalled();
    });

    it("keeps a document's name on a version unless a title was given", async () => {
        await call({ draftId: DRAFT, documentId: "12" });
        expect(documents.fileStagedDocument).toHaveBeenLastCalledWith(
            expect.anything(),
            ORIGIN,
            expect.objectContaining({ documentId: 12, renameOnVersion: false })
        );
        await call({ draftId: DRAFT, documentId: "12", title: "Plan, revised" });
        expect(documents.fileStagedDocument).toHaveBeenLastCalledWith(
            expect.anything(),
            ORIGIN,
            expect.objectContaining({ title: "Plan, revised", renameOnVersion: true })
        );
    });

    it("suggests a separate document when the same-title one is a different kind", async () => {
        documents.findSameTitle!.mockResolvedValue([{ id: 12, title: "Plan", isArtifact: true }]);
        const words = await call({ draftId: DRAFT, folder: "Research" });
        expect(structured(words)).toMatchObject({
            question: "duplicate",
            suggestedAnswer: "separate",
        });
        expect(textOf(words)).toContain("a separate document is the likelier answer");

        const form = await call(
            { content: "# Plan", format: "markdown", folder: "Research" },
            FORMS
        );
        if (!isInputRequired(form)) throw new Error("expected a form");
        const schema = form.inputRequired.inputRequests.duplicate!.params.requestedSchema as {
            properties: { choice: { default: string; oneOf: { title: string }[] } };
        };
        expect(schema.properties.choice.default).toBe("new");
        expect(schema.properties.choice.oneOf[0]!.title).toContain("interactive page");
    });

    it("suggests a version when the same-title one is the same kind", async () => {
        documents.findSameTitle!.mockResolvedValue([{ id: 12, title: "Plan", isArtifact: false }]);
        const words = await call({ draftId: DRAFT, folder: "Research" });
        expect(structured(words).suggestedAnswer).toBe("version");
    });

    it("tells the truth about a new folder's audience in both ways of asking", async () => {
        const words = await call({ content: "# Plan" });
        expect(textOf(words)).toContain("inside another folder it follows that folder's sharing");
        const form = await call({ content: "# Plan" }, FORMS);
        if (!isInputRequired(form)) throw new Error("expected a form");
        expect(JSON.stringify(form.inputRequired.inputRequests)).toContain(
            "inside another folder it follows that folder's sharing"
        );
    });
});

describe("ChatGPT file arguments", () => {
    it("downloads the attached file, types it by name and stages it", async () => {
        remote.downloadAssistantFile!.mockResolvedValue({
            data: Buffer.from("%PDF-1.7"),
            contentType: "application/pdf",
        });
        const file = {
            download_url: "https://files.oaiusercontent.com/file-1",
            file_id: "file-1",
            file_name: "Board deck.pdf",
        };
        const outcome = await call({ file });
        expect(remote.downloadAssistantFile).toHaveBeenCalledWith(file.download_url);
        expect(staging.stageDraft).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                filename: "Board-deck.pdf",
                mimeType: "application/pdf",
                details: expect.objectContaining({
                    suggestedTitle: "Board deck",
                    origin: "chatgpt",
                }),
            })
        );
        expect(structured(outcome).status).toBe("needs_input");
    });

    it("refuses a kind of file LaunchStack cannot read", async () => {
        remote.downloadAssistantFile!.mockResolvedValue({
            data: Buffer.from("MZ"),
            contentType: null,
        });
        const outcome = await call({
            file: { download_url: "https://files.oaiusercontent.com/x", file_name: "setup.exe" },
        });
        expect(textOf(outcome)).toContain("cannot read that kind of file");
        expect(staging.stageDraft).not.toHaveBeenCalled();
    });

    it("declares the file argument for ChatGPT", () => {
        expect(addDocumentTool.meta).toEqual({ "openai/fileParams": ["file"] });
    });
});

describe("asking with a form (2026-07-28 clients that declared elicitation)", () => {
    const first = { content: "# Plan\n\nBody", format: "markdown" };

    it("returns input_required with folder choices labelled by audience, and a signed state", async () => {
        const outcome = await call(first, FORMS);
        if (!isInputRequired(outcome)) throw new Error("expected input_required");
        const request = outcome.inputRequired.inputRequests.destination!;
        expect(request.method).toBe("elicitation/create");
        const schema = request.params.requestedSchema as {
            properties: Record<string, { oneOf?: unknown; default?: unknown }>;
            required: string[];
        };
        expect(schema.properties.folder?.oneOf).toEqual([
            { const: "Unfiled", title: "Unfiled (only you)" },
            { const: "Research", title: "Research (everyone in the workspace)" },
        ]);
        expect(schema.properties.title?.default).toBe("Plan");
        expect(schema.required).toEqual(["folder"]);
        expect(outcome.inputRequired.requestState).toMatch(/^[\w-]+\.[\w-]+$/);
        expect(documents.fileStagedDocument).not.toHaveBeenCalled();
    });

    it("files the staged draft on the retry with the person's answers, without staging again", async () => {
        const asked = await call(first, FORMS);
        if (!isInputRequired(asked)) throw new Error("expected input_required");
        jest.clearAllMocks();
        staging.loadStagedFile!.mockResolvedValue(staged());
        documents.findSameTitle!.mockResolvedValue([]);
        documents.resolveDestination!.mockResolvedValue({ path: "Research", created: false });
        documents.fileStagedDocument!.mockResolvedValue({
            documentId: 41,
            title: "Plan v2",
            folder: "Research",
            status: "created",
            url: `${ORIGIN}/employer/documents?source=d41`,
            whoCanSee: "everyone in the workspace",
        });

        const outcome = await call(first, FORMS, {
            inputResponses: {
                destination: {
                    action: "accept",
                    content: { folder: "Research", title: "Plan v2" },
                },
            },
            requestState: asked.inputRequired.requestState,
        });
        expect(staging.stageDraft).not.toHaveBeenCalled();
        expect(staging.loadStagedFile).toHaveBeenCalledWith(expect.anything(), DRAFT);
        expect(documents.resolveDestination).toHaveBeenCalledWith(expect.anything(), "Research");
        expect(documents.fileStagedDocument).toHaveBeenCalledWith(
            expect.anything(),
            ORIGIN,
            expect.objectContaining({ title: "Plan v2", folder: "Research" })
        );
        expect(structured(outcome).status).toBe("created");
    });

    it("uses a new folder name over the picked folder", async () => {
        const state = stateFor(first, { stagedId: DRAFT, stage: "destination" });
        await call(first, FORMS, {
            inputResponses: {
                destination: {
                    action: "accept",
                    content: { folder: "Unfiled", newFolder: "Brand new" },
                },
            },
            requestState: state,
        });
        expect(documents.resolveDestination).toHaveBeenCalledWith(expect.anything(), "Brand new");
    });

    it("files nothing on decline or dismiss, but keeps the draft so the model can still ask in words", async () => {
        for (const [action, status] of [
            ["decline", "declined"],
            ["cancel", "cancelled"],
        ]) {
            jest.clearAllMocks();
            const outcome = await call(first, FORMS, {
                inputResponses: { destination: { action } },
                requestState: stateFor(first, { stagedId: DRAFT, stage: "destination" }),
            });
            expect(staging.discardStagedFile).not.toHaveBeenCalled();
            expect(documents.fileStagedDocument).not.toHaveBeenCalled();
            expect(structured(outcome)).toEqual({ status, draftId: DRAFT });
            expect(textOf(outcome)).toContain(`draftId "${DRAFT}"`);
            expect(textOf(outcome)).toContain("ask them in chat");
        }
    });

    it("asks again when the retry carries no answer for the question", async () => {
        const outcome = await call(first, FORMS, {
            inputResponses: {},
            requestState: stateFor(first, { stagedId: DRAFT, stage: "destination" }),
        });
        expect(isInputRequired(outcome)).toBe(true);
        expect(documents.fileStagedDocument).not.toHaveBeenCalled();
    });

    it("refuses answers whose state is forged, for other arguments, or missing", async () => {
        const forged = stateFor(
            { content: "something else" },
            { stagedId: DRAFT, stage: "destination" }
        );
        for (const requestState of [forged, "not-a-state", null]) {
            const outcome = await call(first, FORMS, {
                inputResponses: {
                    destination: { action: "accept", content: { folder: "Research" } },
                },
                requestState,
            });
            expect(textOf(outcome)).toContain("could not accept those answers");
        }
        expect(staging.loadStagedFile).not.toHaveBeenCalled();
        expect(documents.fileStagedDocument).not.toHaveBeenCalled();
    });

    it("asks about a same-title document with a second form, then adds a version on the answer", async () => {
        documents.findSameTitle!.mockResolvedValue([{ id: 12, title: "Plan", isArtifact: false }]);
        const second = await call(first, FORMS, {
            inputResponses: { destination: { action: "accept", content: { folder: "Research" } } },
            requestState: stateFor(first, { stagedId: DRAFT, stage: "destination" }),
        });
        if (!isInputRequired(second)) throw new Error("expected a second form");
        const schema = second.inputRequired.inputRequests.duplicate!.params.requestedSchema as {
            properties: { choice: { oneOf: { const: string }[] } };
        };
        expect(schema.properties.choice.oneOf.map(option => option.const)).toEqual([
            "version:12",
            "new",
        ]);

        const done = await call(first, FORMS, {
            inputResponses: { duplicate: { action: "accept", content: { choice: "version:12" } } },
            requestState: second.inputRequired.requestState,
        });
        expect(documents.fileStagedDocument).toHaveBeenCalledWith(
            expect.anything(),
            ORIGIN,
            expect.objectContaining({ documentId: 12 })
        );
        expect(structured(done).status).toBe("version_added");
    });

    it("asks a client without forms in words even on 2026-07-28", async () => {
        const outcome = await call(first, { era: "modern", formElicitation: false });
        expect(structured(outcome).status).toBe("needs_input");
    });
});
