import { configureOcr } from "@launchstack/conversion/ocr/config";
import type { ChatQueueItem, ChatSendPayload, ChatTurnMetadata } from "~/lib/chat-turns";
import { appendMessages, changeQueue, createSession } from "~/server/sessions/repository";

const mockSelect = jest.fn();
const mockTransaction = jest.fn();
const mockWrites: Record<string, unknown>[] = [];
const mockSession = {
    id: "s1",
    title: "Chat",
    messageCount: 1,
    contextSourceIds: [],
    companyId: 7n,
    userId: "user_1",
    queueRevision: 0,
    queuedMessages: [] as ChatQueueItem[],
    createdAt: new Date(),
    lastMessageAt: new Date(),
};

jest.mock("~/server/db", () => ({
    db: {
        select: (...args: unknown[]) => mockSelect(...args),
        transaction: (...args: unknown[]) => mockTransaction(...args),
    },
}));
jest.mock("~/env", () => ({
    env: { server: { NEXT_PUBLIC_S3_ENDPOINT: "https://s3.example", S3_BUCKET_NAME: "files" } },
}));

const OWNER = { companyId: 7n, userId: "user_1" };
const CANONICAL = "https://s3.example/files/chat/owned.png";
const ALIAS = "https://s3.example/files/chat/%6fwned.png";
const attachment = (url: string) => ({
    id: "a1",
    name: "owned.png",
    mimeType: "image/png",
    kind: "image" as const,
    size: 20,
    url,
});
const send = (url: string): ChatSendPayload => ({
    text: "See this",
    refs: [],
    attachments: [attachment(url)],
    webSearch: false,
    thinking: false,
    agentKey: null,
});

function ledger(rows: Record<string, unknown>[]) {
    mockSelect.mockReturnValue({ from: () => ({ where: () => Promise.resolve(rows) }) });
}

beforeEach(() => {
    jest.clearAllMocks();
    configureOcr({});
    mockWrites.length = 0;
    mockSession.queuedMessages = [];
    ledger([{ companyId: OWNER.companyId, url: CANONICAL, deletedAt: null }]);
    const tx = {
        select: () => ({
            from: () => ({ where: () => ({ for: () => Promise.resolve([mockSession]) }) }),
        }),
        insert: () => ({
            values: (values: Record<string, unknown> | Record<string, unknown>[]) => {
                mockWrites.push(...(Array.isArray(values) ? values : [values]));
                return { returning: () => Promise.resolve([{ ...mockSession, ...values }]) };
            },
        }),
        update: () => ({
            set: (values: Record<string, unknown>) => {
                mockWrites.push(values);
                return {
                    where: () => ({
                        returning: () => Promise.resolve([{ ...mockSession, ...values }]),
                    }),
                };
            },
        }),
    };
    mockTransaction.mockImplementation((work: (executor: typeof tx) => unknown) => work(tx));
});

afterEach(() => configureOcr({}));

const paths = [
    {
        name: "session creation attachments",
        write: (url: string) =>
            createSession(OWNER, {
                messages: [{ role: "user", text: "See this", attachments: [attachment(url)] }],
            }),
    },
    {
        name: "session creation replay payload",
        write: (url: string) =>
            createSession(OWNER, {
                messages: [{ role: "user", text: "See this", metadata: { send: send(url) } }],
            }),
    },
    {
        name: "appended attachments",
        write: (url: string) =>
            appendMessages(OWNER, "s1", {
                messages: [{ role: "user", text: "See this", attachments: [attachment(url)] }],
            }),
    },
    {
        name: "appended replay payload",
        write: (url: string) =>
            appendMessages(OWNER, "s1", {
                messages: [{ role: "user", text: "See this", metadata: { send: send(url) } }],
            }),
    },
    {
        name: "queued sends",
        write: (url: string) =>
            changeQueue(OWNER, "s1", 0, {
                items: [{ id: "q1", send: send(url) }],
            }),
    },
    {
        name: "claimed queued sends",
        write: (url: string) => {
            mockSession.queuedMessages = [{ id: "q1", send: send(url) }];
            return changeQueue(OWNER, "s1", 0, { claimId: "q1" });
        },
    },
];

describe.each(paths)("$name", ({ write }) => {
    it("rejects an alias of an owned provider object without writing", async () => {
        await expect(write(ALIAS)).rejects.toMatchObject({ status: 404 });
        expect(mockWrites).toEqual([]);
    });

    it("persists the exact owned live URL", async () => {
        await write(CANONICAL);
        const saved = mockWrites.flatMap(row => [
            ...((row.attachments as unknown[] | undefined) ?? []),
            ...((row.metadata as ChatTurnMetadata | undefined)?.send?.attachments ?? []),
            ...((row.queuedMessages as ChatQueueItem[] | undefined)?.flatMap(
                item => item.send.attachments
            ) ?? []),
        ]);
        expect(saved).toContainEqual(attachment(CANONICAL));
    });

    it("rejects a foreign workspace's object", async () => {
        ledger([{ companyId: 99n, url: CANONICAL, deletedAt: null }]);
        await expect(write(CANONICAL)).rejects.toMatchObject({ status: 404 });
        expect(mockWrites).toEqual([]);
    });
});
