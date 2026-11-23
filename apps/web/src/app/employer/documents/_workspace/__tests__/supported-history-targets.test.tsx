/** @jest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import type { HistoryEntry } from "~/lib/workspace-history";
import { withSupportedHistoryTarget } from "../supported-history-targets";
import { useWorkspaceHistory } from "../useWorkspaceHistory";

const mockFetchHistory = jest.fn();
jest.mock("../sessionApi", () => ({
    fetchHistory: (...args: unknown[]) => mockFetchHistory(...args),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

function entry(href?: string, kind: HistoryEntry["kind"] = "vantage"): HistoryEntry {
    return {
        id: "vantage:recorded",
        refId: "recorded",
        kind,
        title: "Recorded meeting",
        status: "done",
        at: "2026-11-16T12:00:00Z",
        href,
    };
}

it.each([
    "/employer/tools/vantage/agenda?week=2026-11-09",
    "/employer/tools/vantage/agenda/recorded?view=report",
    "/employer/tools/vantage/unknown/?week=2026-11-09",
    "/employer/documents?feature=vantage&at=%2Fagenda%3Fweek%3D2026-11-09",
    "/employer/documents?at=%2Fagenda%2Frecorded%3Fview%3Dreport&feature=vantage",
    "/employer/documents?feature=vantage&at=/unknown?week=2026-11-09",
])("removes unsupported Vantage targets while retaining the recorded entry: %s", href => {
    const recorded = entry(href);
    expect(withSupportedHistoryTarget(recorded)).toEqual({ ...recorded, href: undefined });
    expect(recorded.href).toBe(href);
});

it.each([
    "/employer/tools/vantage?week=2026-11-09",
    "/employer/tools/vantage/context?week=2026-11-09",
    "/employer/documents?feature=vantage&at=%2F%3Fweek%3D2026-11-09",
    "/employer/documents?feature=vantage&at=%2Fcontext%3Fweek%3D2026-11-09",
    "/employer/documents?feature=vantage&at=%2Fcommitments",
    "/employer/documents?feature=vantage&at=%2Fevidence",
    "/employer/documents?feature=vantage&at=%2Fmetrics",
    "/employer/documents?feature=vantage&at=%2Fprogram",
    "/employer/tools/growth/unknown?week=2026-11-09",
    "/employer/documents?feature=growth&at=%2Fagenda",
    "/employer/documents?feature=vantage",
    "http://[invalid",
    undefined,
])("preserves current Vantage routes and unrelated targets: %s", href => {
    const recorded = entry(href);
    expect(withSupportedHistoryTarget(recorded)).toBe(recorded);
});

it("does not change another history kind even if its href points at a removed Vantage screen", () => {
    const recorded = entry("/employer/tools/vantage/agenda", "chat");
    expect(withSupportedHistoryTarget(recorded)).toBe(recorded);
});

it("normalizes both active and archived loads without dropping recorded work", async () => {
    const unsupported = entry("/employer/tools/vantage/agenda?week=2026-11-09");
    const supported = {
        ...entry("/employer/tools/vantage/context"),
        id: "vantage:current",
        refId: "current",
    };
    mockFetchHistory.mockImplementation(async (options?: { archived?: boolean }) => ({
        entries: [unsupported, supported].map(recorded => ({
            ...recorded,
            archived: Boolean(options?.archived),
        })),
        degraded: [],
        archivedCount: 2,
    }));
    const { result } = renderHook(() => useWorkspaceHistory(true));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(result.current.entries[0]).toMatchObject({
        id: unsupported.id,
        title: unsupported.title,
        href: undefined,
    });
    expect(result.current.entries[1]?.href).toBe(supported.href);
    act(() => result.current.setArchivedOpen(true));
    await waitFor(() => expect(result.current.archived.entries).toHaveLength(2));
    expect(result.current.archived.entries[0]).toMatchObject({
        id: unsupported.id,
        title: unsupported.title,
        href: undefined,
        archived: true,
    });
    expect(result.current.archived.entries[1]?.href).toBe(supported.href);
    expect(mockFetchHistory).toHaveBeenLastCalledWith({ archived: true });
});
