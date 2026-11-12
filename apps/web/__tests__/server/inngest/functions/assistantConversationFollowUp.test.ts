/**
 * The follow-up note on the worker (ASSISTANT_CONVERSATIONS_EXECUTOR=worker):
 * the job reads the transcript back from the saved document and writes the
 * note under the workspace's models, skips a save a newer one replaced, fails
 * at once on what a retry cannot fix, and leaves the row `failed` when it
 * gives up. The assistant-conversations modules are real; the database is the
 * in-memory fake, and storage, membership, the model and the scope are seams.
 */
import { documentVersions } from "@launchstack/store/schema";
import { NonRetriableError } from "inngest";

import { SCOPE_EVERYTHING } from "~/lib/authz/scope-types";
import { resolveMemberContext } from "~/lib/require-workspace-context";
import { fetchFile } from "~/lib/storage";
import type { FollowUpContent } from "~/server/assistant-conversations/follow-up-model";
import { generateFollowUpContent } from "~/server/assistant-conversations/follow-up-model";
import {
    conversationContentHash,
    renderConversationMarkdown,
} from "~/server/assistant-conversations/render";
import { AiAllowanceExceededError } from "~/server/ai-usage/errors";
import { assistantConversations, documentNotes } from "~/server/db/schema";
import { requestNoteEmbedding } from "~/server/notes/embed-note";
import { syncNoteLinks } from "~/server/notes/wiki-links";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

import { fakeDb } from "../../../helpers/fake-db";

type EventData = {
    conversationRowId: number;
    documentId: number;
    companyId: string;
    authUserId: string;
    title: string;
    family: "claude" | "chatgpt" | "gemini" | "other";
    contentHash: string;
};
type Step = { run: (name: string, op: () => Promise<unknown>) => Promise<unknown> };
type Handler = (ctx: { event: { data: EventData }; step: Step }) => Promise<unknown>;
type Options = {
    id: string;
    retries: number;
    onFailure: (ctx: {
        error: Error;
        event: { data: { event: { data: unknown } } };
    }) => Promise<void>;
};

jest.mock("~/server/inngest/client", () => ({
    inngest: {
        createFunction: jest.fn((options: Options, trigger: unknown, handler: Handler) => ({
            options,
            trigger,
            handler,
        })),
    },
}));
jest.mock("~/server/db", () => ({ db: jest.requireActual("../../../helpers/fake-db").fakeDb.db }));
jest.mock("~/lib/require-workspace-context", () => ({ resolveMemberContext: jest.fn() }));
jest.mock("~/lib/storage", () => ({ fetchFile: jest.fn() }));
jest.mock("~/server/notes/embed-note", () => ({
    requestNoteEmbedding: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("~/server/notes/wiki-links", () => ({
    syncNoteLinks: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("~/server/assistant-conversations/follow-up-model", () => ({
    generateFollowUpContent: jest.fn(),
}));
jest.mock("~/server/workspace-models/scope", () => ({
    withWorkspaceChatModels: jest.fn((_companyId: unknown, _use: unknown, fn: () => unknown) =>
        fn()
    ),
}));

import { assistantConversationFollowUpJob } from "~/server/inngest/functions/assistantConversationFollowUp";

const job = assistantConversationFollowUpJob as unknown as {
    options: Options;
    trigger: { event: string };
    handler: Handler;
};

const CONVERSATION = {
    title: "Pricing",
    messages: [
        { role: "user" as const, content: "Should we raise prices?", at: "2026-11-10 09:00" },
        {
            role: "assistant" as const,
            content: "Yes, by 10%.\n\\## User — not a real turn",
            at: "2026-11-10 09:01 UTC",
        },
        { role: "user" as const, content: "Do it.", at: null },
    ],
};
const HASH = conversationContentHash(CONVERSATION);
const MARKDOWN = renderConversationMarkdown(CONVERSATION, {
    family: "claude",
    clientName: "Claude Code",
    model: null,
    savedAt: new Date("2026-11-10T09:02:00Z"),
});
const CONTENT: FollowUpContent = {
    summary: "They agreed to raise prices.",
    decisions: ["Raise prices by 10%"],
    actionItems: ["Update the price page"],
    openQuestions: [],
};

function eventData(overrides: Partial<EventData> = {}): EventData {
    return {
        conversationRowId: 3,
        documentId: 40,
        companyId: "5",
        authUserId: "ada",
        title: "Pricing",
        family: "claude",
        contentHash: HASH,
        ...overrides,
    };
}

const steps: string[] = [];
const step: Step = { run: async (name, op) => (steps.push(name), op()) };

function storedFile(markdown: string) {
    return { ok: true, status: 200, text: () => Promise.resolve(markdown) };
}

function rowWith(contentHash: string, followUpStatus = "pending") {
    fakeDb.onSelect(assistantConversations, [
        { contentHash, followUpStatus, followUpNoteId: null },
    ]);
}

beforeEach(() => {
    jest.clearAllMocks();
    fakeDb.reset();
    steps.length = 0;
    (resolveMemberContext as jest.Mock).mockResolvedValue({
        documentScope: () => Promise.resolve(SCOPE_EVERYTHING),
    });
    (fetchFile as jest.Mock).mockResolvedValue(storedFile(MARKDOWN));
    (generateFollowUpContent as jest.Mock).mockResolvedValue(CONTENT);
    fakeDb.onSelect(documentVersions, [{ url: "/api/files/9" }]);
});

it("listens for the follow-up event and retries twice", () => {
    expect(job.trigger).toEqual({ event: "assistant-conversations/follow-up.requested" });
    expect(job.options.id).toBe("assistant-conversation-follow-up");
    expect(job.options.retries).toBe(2);
});

it("reads the transcript back from the saved document and writes the note under the workspace's models", async () => {
    rowWith(HASH);

    await expect(job.handler({ event: { data: eventData() }, step })).resolves.toEqual({
        conversationRowId: 3,
        outcome: "done",
    });

    expect(steps).toEqual(["generate", "write"]);
    expect(fetchFile).toHaveBeenCalledWith("/api/files/9");
    // The model reads exactly the turns that were saved, escapes and times included.
    expect(generateFollowUpContent).toHaveBeenCalledWith({
        title: "Pricing",
        family: "claude",
        messages: CONVERSATION.messages,
    });
    expect(withWorkspaceChatModels).toHaveBeenCalledWith(
        BigInt(5),
        { feature: "mcp", userId: "ada" },
        expect.any(Function)
    );
    expect(resolveMemberContext).toHaveBeenCalledWith("ada", BigInt(5));

    const [note] = fakeDb.insertedInto(documentNotes);
    expect(note).toMatchObject({ userId: "ada", documentId: "40", title: "Follow-up: Pricing" });
    expect(note!.contentMarkdown).toContain("Raise prices by 10%");
    expect(fakeDb.updatesOf(assistantConversations)).toEqual([
        { followUpNoteId: 1000, followUpStatus: "done", followUpError: null },
    ]);
    expect(requestNoteEmbedding).toHaveBeenCalledWith(1000, "created", "5");
    expect(syncNoteLinks).toHaveBeenCalledWith(
        expect.objectContaining({ noteId: 1000, scope: SCOPE_EVERYTHING })
    );
});

it("skips a save a newer one replaced, without reading the transcript or calling the model", async () => {
    rowWith("newer-hash");

    await expect(job.handler({ event: { data: eventData() }, step })).resolves.toEqual({
        conversationRowId: 3,
        outcome: "stale",
    });

    expect(steps).toEqual(["generate"]);
    expect(fetchFile).not.toHaveBeenCalled();
    expect(generateFollowUpContent).not.toHaveBeenCalled();
    expect(fakeDb.inserts).toHaveLength(0);
    expect(fakeDb.updates).toHaveLength(0);
});

it("does nothing for a repeated event whose note is already written", async () => {
    rowWith(HASH, "done");
    await expect(job.handler({ event: { data: eventData() }, step })).resolves.toEqual({
        conversationRowId: 3,
        outcome: "done",
    });
    expect(generateFollowUpContent).not.toHaveBeenCalled();
    expect(fakeDb.updates).toHaveLength(0);
});

it("writes nothing when a newer save lands between the model call and the write", async () => {
    // The generate step sees this save's hash; the write step's locked read sees the next one.
    fakeDb.onSelect(
        assistantConversations,
        [{ contentHash: HASH, followUpStatus: "pending", followUpNoteId: null }],
        [{ contentHash: "newer-hash", followUpStatus: "pending", followUpNoteId: null }]
    );
    await expect(job.handler({ event: { data: eventData() }, step })).resolves.toEqual({
        conversationRowId: 3,
        outcome: "stale",
    });
    expect(steps).toEqual(["generate", "write"]);
    expect(fakeDb.insertedInto(documentNotes)).toHaveLength(0);
    expect(fakeDb.updates).toHaveLength(0);
});

it("lets a model failure throw so Inngest retries it, and the row says failed when it gives up", async () => {
    rowWith(HASH);
    (generateFollowUpContent as jest.Mock).mockRejectedValue(new Error("upstream 503"));

    const error = await job.handler({ event: { data: eventData() }, step }).catch(e => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(NonRetriableError);
    expect((error as Error).message).toBe("upstream 503");
    expect(fakeDb.insertedInto(documentNotes)).toHaveLength(0);
    expect(fakeDb.updates).toHaveLength(0);

    // Retries exhausted: Inngest calls onFailure with the original event under event.data.event.
    await job.options.onFailure({
        error: error as Error,
        event: { data: { event: { data: eventData() } } },
    });
    // The only write is the status on the conversation's row — nothing to the document.
    expect(fakeDb.updates.map(u => u.table)).toEqual([assistantConversations]);
    expect(fakeDb.updatesOf(assistantConversations)).toEqual([
        { followUpStatus: "failed", followUpError: "upstream 503" },
    ]);
});

it("fails at once, without retries, when the person is at their AI allowance", async () => {
    rowWith(HASH);
    (generateFollowUpContent as jest.Mock).mockRejectedValue(
        new AiAllowanceExceededError({
            binding: "workspace",
            resetsAt: "2026-12-01",
        } as unknown as ConstructorParameters<typeof AiAllowanceExceededError>[0])
    );

    const error = await job.handler({ event: { data: eventData() }, step }).catch(e => e);
    expect(error).toBeInstanceOf(NonRetriableError);
    expect((error as Error).message).toMatch(/AI allowance/);
});

it("fails at once when the saver has left the workspace", async () => {
    rowWith(HASH);
    (resolveMemberContext as jest.Mock).mockResolvedValue(null);

    const error = await job.handler({ event: { data: eventData() }, step }).catch(e => e);
    expect(error).toBeInstanceOf(NonRetriableError);
    expect((error as Error).message).toMatch(/no longer an active member/);
    expect(generateFollowUpContent).not.toHaveBeenCalled();
});

it("fails at once when no saved version hashes to the save's content", async () => {
    rowWith(HASH);
    (fetchFile as jest.Mock).mockResolvedValue(
        storedFile(MARKDOWN.replace("Do it.", "Do it later."))
    );

    const error = await job.handler({ event: { data: eventData() }, step }).catch(e => e);
    expect(error).toBeInstanceOf(NonRetriableError);
    expect((error as Error).message).toMatch(/could not be read back/);
    expect(generateFollowUpContent).not.toHaveBeenCalled();
});

it("reads past a newer version to the save's own, newest first", async () => {
    fakeDb.reset();
    rowWith(HASH);
    fakeDb.onSelect(documentVersions, [{ url: "/api/files/11" }, { url: "/api/files/9" }]);
    (fetchFile as jest.Mock).mockImplementation((url: string) =>
        Promise.resolve(
            storedFile(url === "/api/files/9" ? MARKDOWN : MARKDOWN.replace("Do it.", "Wait."))
        )
    );

    await expect(job.handler({ event: { data: eventData() }, step })).resolves.toMatchObject({
        outcome: "done",
    });
    expect((fetchFile as jest.Mock).mock.calls.map(c => c[0])).toEqual([
        "/api/files/11",
        "/api/files/9",
    ]);
});

it("retries when the stored file cannot be fetched", async () => {
    rowWith(HASH);
    (fetchFile as jest.Mock).mockResolvedValue({ ok: false, status: 502, text: jest.fn() });

    const error = await job.handler({ event: { data: eventData() }, step }).catch(e => e);
    expect(error).not.toBeInstanceOf(NonRetriableError);
    expect((error as Error).message).toMatch(/HTTP 502/);
});

it("ignores a failure whose payload it cannot read, rather than guess at a row", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await job.options.onFailure({
        error: new Error("boom"),
        event: { data: { event: { data: { nonsense: true } } } },
    });
    expect(fakeDb.updates).toHaveLength(0);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
});
