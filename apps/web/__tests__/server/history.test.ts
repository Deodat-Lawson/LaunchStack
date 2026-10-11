import type { HistoryEntry, HistoryKind } from "~/lib/workspace-history";
import type { ChatFeedRow } from "~/server/sessions/feed";

import { makeWorkspaceContext } from "../helpers/workspace-context";

/**
 * The merge is the one piece of History with a real failure mode: it fans out
 * across seven tables owned by seven verticals, and any one of them can be
 * mid-migration, slow, or broken. The property worth pinning is that a broken
 * vertical costs you *that vertical* and nothing else — the sidebar still
 * shows your chats, and it says what is missing instead of quietly shortening
 * the list.
 *
 * Since ADR-014 chats also carry the reader's own organisation (pinned,
 * archived, shared, unread); the feed's queries are covered against Postgres
 * in `sessions/chat-sharing.integration.test.ts`, and the merge rules here.
 */

const mockListChatFeed = jest.fn();
const mockLoad: Record<string, jest.Mock> = {};

jest.mock("~/server/sessions/feed", () => ({
    listChatFeed: (...args: unknown[]) => mockListChatFeed(...args),
}));

jest.mock("~/server/history/loaders", () => {
    const kinds: HistoryKind[] = [
        "trend-search",
        "prospector",
        "repo-explainer",
        "distribution",
        "email",
        "weekly-review",
        "vantage",
    ];
    return {
        PIPELINE_LOADERS: kinds.map(kind => ({
            kind,
            load: (...args: unknown[]) => {
                mockLoad[kind] ??= jest.fn().mockResolvedValue([]);
                return mockLoad[kind](...args);
            },
        })),
    };
});

import { loadWorkspaceHistory, parseKindsParam } from "~/server/history";

function run(kind: HistoryKind, entries: HistoryEntry[]) {
    mockLoad[kind] = jest.fn().mockResolvedValue(entries);
}

function entry(id: string, kind: HistoryKind, at: string): HistoryEntry {
    return { id, kind, refId: id, title: id, status: "done", at };
}

function chat(over: Partial<ChatFeedRow> & Pick<ChatFeedRow, "id">): ChatFeedRow {
    return {
        title: over.id,
        messageCount: 2,
        lastMessageAt: "2026-09-05T12:00:00.000Z",
        ownerAuthUserId: "user-a",
        mine: true,
        pinned: false,
        pinRank: null,
        archived: false,
        shared: false,
        unread: false,
        ...over,
    };
}

function feed(rows: ChatFeedRow[], archivedCount: number | null = 0) {
    mockListChatFeed.mockResolvedValue({ rows, archivedCount });
}

const ACTOR = makeWorkspaceContext({ authUserId: "user-a", companyId: BigInt(5) });
const OWNER = { companyId: BigInt(5), userId: "user-a", actor: ACTOR };

beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(mockLoad)) delete mockLoad[key];
    feed([]);
});

describe("loadWorkspaceHistory", () => {
    it("interleaves chats and runs strictly by recency", async () => {
        feed([chat({ id: "s1", title: "Indemnity cap", messageCount: 4 })]);
        run("distribution", [entry("d1", "distribution", "2026-09-05T13:00:00.000Z")]);
        run("email", [entry("e1", "email", "2026-09-05T10:00:00.000Z")]);

        const page = await loadWorkspaceHistory(OWNER);

        expect(page.entries.map(e => e.id)).toEqual(["d1", "chat:s1", "e1"]);
        expect(page.degraded).toEqual([]);
    });

    it("asks the chat feed as the caller, so chats shared with them come back", async () => {
        await loadWorkspaceHistory(OWNER);
        expect(mockListChatFeed).toHaveBeenCalledWith(ACTOR, { limit: 60, archived: undefined });
    });

    it("keeps the feed when one vertical throws, and names the casualty", async () => {
        feed([chat({ id: "s1", title: "Still here" })]);
        mockLoad.distribution = jest.fn().mockRejectedValue(new Error("relation does not exist"));
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const page = await loadWorkspaceHistory(OWNER);

        expect(page.entries.map(e => e.id)).toEqual(["chat:s1"]);
        expect(page.degraded).toEqual(["distribution"]);
        consoleError.mockRestore();
    });

    it("makes a chat row resumable by pointing at its own session link", async () => {
        feed([chat({ id: "s 1/x", messageCount: 1 })]);

        const page = await loadWorkspaceHistory(OWNER);

        // The id lands in a query string, so it has to be escaped there.
        expect(page.entries[0]!.href).toBe("/employer/documents?session=s%201%2Fx");
        expect(page.entries[0]!.messageCount).toBe(1);
    });

    it("carries the reader's own organisation on every chat row", async () => {
        feed(
            [
                chat({ id: "mine", pinned: true, pinRank: -1, shared: true }),
                chat({
                    id: "theirs",
                    mine: false,
                    ownerAuthUserId: "user-b",
                    unread: true,
                    lastMessageAt: "2026-09-05T11:00:00.000Z",
                }),
            ],
            3
        );

        const page = await loadWorkspaceHistory(OWNER);

        expect(page.archivedCount).toBe(3);
        expect(page.entries[0]).toMatchObject({
            id: "chat:mine",
            pinned: true,
            pinRank: -1,
            shared: true,
            archived: false,
        });
        expect(page.entries[0]!.sharedBy).toBeUndefined();
        expect(page.entries[1]).toMatchObject({
            id: "chat:theirs",
            sharedBy: "user-b",
            unread: true,
            shared: false,
        });
    });

    it("never trims a pin, however old, when it caps the feed", async () => {
        feed([
            chat({
                id: "old-pin",
                pinned: true,
                pinRank: 0,
                lastMessageAt: "2020-01-01T00:00:00.000Z",
            }),
        ]);
        run("email", [
            entry("e1", "email", "2026-09-05T13:00:00.000Z"),
            entry("e2", "email", "2026-09-05T12:00:00.000Z"),
        ]);

        const page = await loadWorkspaceHistory({ ...OWNER, limit: 1 });

        expect(page.entries.map(e => e.id)).toEqual(["e1", "chat:old-pin"]);
    });

    it("returns only archived chats in the Archived view, and no runs", async () => {
        feed([chat({ id: "gone", archived: true })], null);
        run("email", [entry("e1", "email", "2026-09-05T13:00:00.000Z")]);

        const page = await loadWorkspaceHistory({ ...OWNER, archived: true });

        expect(page.entries.map(e => e.id)).toEqual(["chat:gone"]);
        expect(mockListChatFeed).toHaveBeenCalledWith(ACTOR, { limit: 60, archived: true });
        expect(mockLoad.email).not.toHaveBeenCalled();
        expect(page.archivedCount).toBeNull();
    });

    it("runs only the kinds asked for", async () => {
        run("email", [entry("e1", "email", "2026-09-05T10:00:00.000Z")]);
        run("distribution", [entry("d1", "distribution", "2026-09-05T13:00:00.000Z")]);

        const page = await loadWorkspaceHistory({ ...OWNER, kinds: ["email"] });

        expect(page.entries.map(e => e.id)).toEqual(["e1"]);
        expect(mockListChatFeed).not.toHaveBeenCalled();
        expect(mockLoad.distribution).not.toHaveBeenCalled();
        expect(page.archivedCount).toBeNull();
    });

    it("caps the merged feed at the requested limit", async () => {
        run("email", [
            entry("e1", "email", "2026-09-05T13:00:00.000Z"),
            entry("e2", "email", "2026-09-05T12:00:00.000Z"),
            entry("e3", "email", "2026-09-05T11:00:00.000Z"),
        ]);

        const page = await loadWorkspaceHistory({ ...OWNER, limit: 2 });

        expect(page.entries.map(e => e.id)).toEqual(["e1", "e2"]);
    });
});

describe("parseKindsParam", () => {
    it("accepts repeated and comma-separated values, and de-duplicates", () => {
        expect(parseKindsParam(["chat,email", "chat"])).toEqual(["chat", "email"]);
    });

    it("drops unknown kinds rather than failing the request", () => {
        expect(parseKindsParam(["chat, nonsense"])).toEqual(["chat"]);
    });

    it("treats an all-garbage filter as no filter, not as an empty feed", () => {
        expect(parseKindsParam(["nonsense"])).toBeUndefined();
        expect(parseKindsParam([])).toBeUndefined();
    });
});
