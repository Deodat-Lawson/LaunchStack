import type { HistoryEntry, HistoryKind } from "~/lib/workspace-history";

/**
 * The merge is the one piece of History with a real failure mode: it fans out
 * across seven tables owned by seven verticals, and any one of them can be
 * mid-migration, slow, or broken. The property worth pinning is that a broken
 * vertical costs you *that vertical* and nothing else — the sidebar still
 * shows your chats, and it says what is missing instead of quietly shortening
 * the list.
 */

const mockListSessions = jest.fn();
const mockLoad: Record<string, jest.Mock> = {};

jest.mock("~/server/sessions/repository", () => ({
    listSessions: (...args: unknown[]) => mockListSessions(...args),
}));

jest.mock("~/server/history/loaders", () => {
    const kinds: HistoryKind[] = [
        "trend-search",
        "prospector",
        "repo-explainer",
        "distribution",
        "email",
        "weekly-review",
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

const OWNER = { companyId: BigInt(5), userId: "user-a" };

beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(mockLoad)) delete mockLoad[key];
    mockListSessions.mockResolvedValue([]);
});

describe("loadWorkspaceHistory", () => {
    it("interleaves chats and runs strictly by recency", async () => {
        mockListSessions.mockResolvedValue([
            {
                id: "s1",
                title: "Indemnity cap",
                messageCount: 4,
                pinned: false,
                contextSourceIds: [],
                lastMessageAt: "2026-09-05T12:00:00.000Z",
                createdAt: "2026-09-05T11:00:00.000Z",
            },
        ]);
        run("distribution", [entry("d1", "distribution", "2026-09-05T13:00:00.000Z")]);
        run("email", [entry("e1", "email", "2026-09-05T10:00:00.000Z")]);

        const page = await loadWorkspaceHistory(OWNER);

        expect(page.entries.map(e => e.id)).toEqual(["d1", "chat:s1", "e1"]);
        expect(page.degraded).toEqual([]);
    });

    it("keeps the feed when one vertical throws, and names the casualty", async () => {
        mockListSessions.mockResolvedValue([
            {
                id: "s1",
                title: "Still here",
                messageCount: 2,
                pinned: false,
                contextSourceIds: [],
                lastMessageAt: "2026-09-05T12:00:00.000Z",
                createdAt: "2026-09-05T12:00:00.000Z",
            },
        ]);
        mockLoad.distribution = jest.fn().mockRejectedValue(new Error("relation does not exist"));
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const page = await loadWorkspaceHistory(OWNER);

        expect(page.entries.map(e => e.id)).toEqual(["chat:s1"]);
        expect(page.degraded).toEqual(["distribution"]);
        consoleError.mockRestore();
    });

    it("makes a chat row resumable by pointing at its own session link", async () => {
        mockListSessions.mockResolvedValue([
            {
                id: "s 1/x",
                title: "Odd id",
                messageCount: 1,
                pinned: false,
                contextSourceIds: [],
                lastMessageAt: "2026-09-05T12:00:00.000Z",
                createdAt: "2026-09-05T12:00:00.000Z",
            },
        ]);

        const page = await loadWorkspaceHistory(OWNER);

        // The id lands in a query string, so it has to be escaped there.
        expect(page.entries[0]!.href).toBe("/employer/documents?session=s%201%2Fx");
        expect(page.entries[0]!.messageCount).toBe(1);
    });

    it("runs only the kinds asked for", async () => {
        run("email", [entry("e1", "email", "2026-09-05T10:00:00.000Z")]);
        run("distribution", [entry("d1", "distribution", "2026-09-05T13:00:00.000Z")]);

        const page = await loadWorkspaceHistory({ ...OWNER, kinds: ["email"] });

        expect(page.entries.map(e => e.id)).toEqual(["e1"]);
        expect(mockListSessions).not.toHaveBeenCalled();
        expect(mockLoad.distribution).not.toHaveBeenCalled();
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
