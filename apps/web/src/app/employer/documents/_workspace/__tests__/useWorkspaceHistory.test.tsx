/** @jest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";

import type { HistoryEntry } from "~/lib/workspace-history";

import { useWorkspaceHistory } from "../useWorkspaceHistory";

/**
 * Organising History is optimistic (ADR-014 §5): a pin, an archive or a
 * reorder shows at once and quietly undoes itself, with a toast, when the
 * server says no. The archived view is its own fetch.
 */

const mockApi = {
    fetchHistory: jest.fn(),
    updateSessionState: jest.fn(),
    orderPins: jest.fn(),
};
jest.mock("../sessionApi", () => ({
    fetchHistory: (...args: unknown[]) => mockApi.fetchHistory(...args),
    updateSessionState: (...args: unknown[]) => mockApi.updateSessionState(...args),
    orderPins: (...args: unknown[]) => mockApi.orderPins(...args),
}));
const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock("sonner", () => ({
    toast: {
        success: (...args: unknown[]) => mockToast.success(...args),
        error: (...args: unknown[]) => mockToast.error(...args),
    },
}));

function chat(refId: string, over: Partial<HistoryEntry> = {}): HistoryEntry {
    return {
        id: `chat:${refId}`,
        kind: "chat",
        refId,
        title: refId,
        status: "done",
        at: "2026-10-10T10:00:00.000Z",
        pinned: false,
        pinRank: null,
        archived: false,
        ...over,
    };
}

const A = chat("a", { pinned: true, pinRank: 0 });
const B = chat("b", { pinned: true, pinRank: 1, at: "2026-10-10T09:00:00.000Z" });
const C = chat("c", { sharedBy: "user-b", unread: true, at: "2026-10-10T11:00:00.000Z" });

async function mounted() {
    const hook = renderHook(() => useWorkspaceHistory(true));
    await waitFor(() => expect(hook.result.current.entries).toHaveLength(3));
    return hook;
}

const find = (entries: HistoryEntry[], refId: string) => entries.find(e => e.refId === refId);

beforeEach(() => {
    jest.clearAllMocks();
    mockApi.fetchHistory.mockImplementation((options?: { archived?: boolean }) =>
        Promise.resolve(
            options?.archived
                ? { entries: [chat("old", { archived: true })], degraded: [], archivedCount: null }
                : { entries: [A, B, C], degraded: [], archivedCount: 4 }
        )
    );
    mockApi.updateSessionState.mockResolvedValue({
        pinned: true,
        pinRank: -1,
        archived: false,
        lastSeenAt: null,
    });
    mockApi.orderPins.mockResolvedValue(["b", "a"]);
});

it("knows how many chats are archived from the feed", async () => {
    const { result } = await mounted();
    expect(result.current.archived.count).toBe(4);
});

it("pins on top at once, and keeps the server's rank", async () => {
    const { result } = await mounted();
    act(() => result.current.setPinned(find(result.current.entries, "c")!, true));
    expect(find(result.current.entries, "c")).toMatchObject({ pinned: true, pinRank: -1 });
    await waitFor(() =>
        expect(mockApi.updateSessionState).toHaveBeenCalledWith("c", { pinned: true })
    );
});

it("puts a pin back when the server refuses it", async () => {
    mockApi.updateSessionState.mockRejectedValue(new Error("Session not found"));
    const { result } = await mounted();
    act(() => result.current.setPinned(find(result.current.entries, "c")!, true));
    await waitFor(() => expect(find(result.current.entries, "c")?.pinned).toBe(false));
    expect(mockToast.error).toHaveBeenCalledWith("Session not found");
});

it("archives out of the list into the archived view, and restores on failure", async () => {
    mockApi.updateSessionState.mockRejectedValueOnce(new Error("nope"));
    const { result } = await mounted();
    act(() => result.current.setArchived(find(result.current.entries, "b")!, true));
    expect(find(result.current.entries, "b")).toBeUndefined();
    expect(result.current.archived.count).toBe(5);
    await waitFor(() => expect(find(result.current.entries, "b")).toBeDefined());
    expect(result.current.archived.count).toBe(4);
    expect(mockToast.error).toHaveBeenCalled();
});

it("offers Undo after an archive", async () => {
    mockApi.updateSessionState.mockResolvedValue({
        pinned: false,
        pinRank: null,
        archived: true,
        lastSeenAt: null,
    });
    const { result } = await mounted();
    act(() => result.current.setArchived(find(result.current.entries, "b")!, true));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
    const [, options] = mockToast.success.mock.calls[0] as [
        string,
        { action: { onClick: () => void } },
    ];
    act(() => options.action.onClick());
    expect(find(result.current.entries, "b")).toMatchObject({ archived: false });
    expect(mockApi.updateSessionState).toHaveBeenLastCalledWith("b", { archived: false });
});

it("loads the archived view when it opens", async () => {
    const { result } = await mounted();
    act(() => result.current.setArchivedOpen(true));
    await waitFor(() => expect(result.current.archived.entries).toHaveLength(1));
    expect(mockApi.fetchHistory).toHaveBeenLastCalledWith({ archived: true });
    expect(result.current.archived.open).toBe(true);
});

it("reorders pins at once and rolls back when the save fails", async () => {
    mockApi.orderPins.mockRejectedValue(new Error("Couldn't reorder"));
    const { result } = await mounted();
    act(() => result.current.reorderPins(["b", "a"]));
    expect(find(result.current.entries, "b")?.pinRank).toBe(0);
    expect(find(result.current.entries, "a")?.pinRank).toBe(1);
    await waitFor(() => expect(find(result.current.entries, "a")?.pinRank).toBe(0));
    expect(mockToast.error).toHaveBeenCalledWith("Couldn't reorder");
});

it("clears the unread dot when a shared chat is opened", async () => {
    const { result } = await mounted();
    act(() => result.current.markSeen("c"));
    expect(find(result.current.entries, "c")?.unread).toBe(false);
    expect(mockApi.updateSessionState).toHaveBeenCalledWith("c", { seen: true });
});
