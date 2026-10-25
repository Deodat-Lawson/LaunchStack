/** @jest-environment jsdom */

/**
 * `useConnectorSync` is what the Drive and Gmail panels show after "Sync
 * now": a request only queues a job, so the panel polls until the run
 * appears and says plainly when it never does. Production sat on "Not
 * synced yet" for a sync no runner ever picked up (2026-10-17).
 */
import { act, renderHook } from "@testing-library/react";
import { createFormatter, createTranslator } from "use-intl";

import { englishMessages } from "~/i18n/messages";

import {
    SYNC_POLL_MS,
    SYNC_STALL_AFTER_MS,
    syncStatusLabel,
    useConnectorSync,
    type SyncStatusFields,
} from "~/app/employer/documents/_workspace/useConnectorSync";

const t = createTranslator({
    locale: "en",
    messages: englishMessages,
    namespace: "sources.connectorSync",
});
const format = createFormatter({ locale: "en" });

const SYNC_URL = "/api/connectors/google-drive/sync";

function setup(initial: SyncStatusFields | null) {
    const refresh = jest.fn(async () => undefined);
    const hook = renderHook(
        ({ status }: { status: SyncStatusFields | null }) =>
            useConnectorSync(status, refresh, SYNC_URL),
        { initialProps: { status: initial } }
    );
    return { ...hook, refresh };
}

const mockFetch = jest.fn();

beforeEach(() => {
    jest.useFakeTimers();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true });
    global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
    jest.useRealTimers();
});

describe("useConnectorSync", () => {
    it("is idle and does not poll before anything is requested", () => {
        const { result, refresh } = setup({ lastSyncAt: null, lastSyncStatus: null });
        expect(result.current.phase).toBe("idle");
        act(() => jest.advanceTimersByTime(SYNC_POLL_MS * 5));
        expect(refresh).not.toHaveBeenCalled();
    });

    it("posts the request, then polls through starting → running → idle", async () => {
        const { result, refresh, rerender } = setup({ lastSyncAt: null, lastSyncStatus: null });

        let accepted = false;
        await act(async () => {
            accepted = await result.current.requestSync();
        });
        expect(accepted).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith(
            SYNC_URL,
            expect.objectContaining({ method: "POST" })
        );
        expect(result.current.phase).toBe("starting");

        act(() => jest.advanceTimersByTime(SYNC_POLL_MS));
        expect(refresh).toHaveBeenCalledTimes(1);

        rerender({ status: { lastSyncAt: null, lastSyncStatus: "running" } });
        expect(result.current.phase).toBe("running");
        act(() => jest.advanceTimersByTime(SYNC_POLL_MS));
        expect(refresh).toHaveBeenCalledTimes(2);

        rerender({ status: { lastSyncAt: "2026-10-17T16:00:00.000Z", lastSyncStatus: "ok" } });
        expect(result.current.phase).toBe("idle");
        act(() => jest.advanceTimersByTime(SYNC_POLL_MS * 5));
        expect(refresh).toHaveBeenCalledTimes(2);
    });

    it("treats a run that finished between two polls as done", async () => {
        const before = "2026-10-17T15:00:00.000Z";
        const { result, rerender } = setup({ lastSyncAt: before, lastSyncStatus: "ok" });

        await act(async () => {
            await result.current.requestSync();
        });
        expect(result.current.phase).toBe("starting");

        rerender({ status: { lastSyncAt: "2026-10-17T15:05:00.000Z", lastSyncStatus: "ok" } });
        expect(result.current.phase).toBe("idle");
    });

    it("says the sync stalled when no run appears, and stops polling", async () => {
        const { result, refresh } = setup({ lastSyncAt: null, lastSyncStatus: null });

        await act(async () => {
            await result.current.requestSync();
        });
        act(() => jest.advanceTimersByTime(SYNC_STALL_AFTER_MS - 1));
        expect(result.current.phase).toBe("starting");

        act(() => jest.advanceTimersByTime(1));
        expect(result.current.phase).toBe("stalled");

        const polls = refresh.mock.calls.length;
        act(() => jest.advanceTimersByTime(SYNC_POLL_MS * 10));
        expect(refresh).toHaveBeenCalledTimes(polls);
    });

    it("clears a stall once a later refresh shows the run", async () => {
        const { result, rerender } = setup({ lastSyncAt: null, lastSyncStatus: null });

        await act(async () => {
            await result.current.requestSync();
        });
        act(() => jest.advanceTimersByTime(SYNC_STALL_AFTER_MS));
        expect(result.current.phase).toBe("stalled");

        rerender({ status: { lastSyncAt: null, lastSyncStatus: "running" } });
        expect(result.current.phase).toBe("running");
    });

    it("reports a rejected request and stays idle", async () => {
        mockFetch.mockResolvedValue({ ok: false });
        const { result, refresh } = setup({ lastSyncAt: null, lastSyncStatus: null });

        let accepted = true;
        await act(async () => {
            accepted = await result.current.requestSync();
        });
        expect(accepted).toBe(false);
        expect(result.current.phase).toBe("idle");
        act(() => jest.advanceTimersByTime(SYNC_POLL_MS * 5));
        expect(refresh).not.toHaveBeenCalled();
    });
});

describe("syncStatusLabel", () => {
    it("names each phase", () => {
        expect(syncStatusLabel(t, format, "running", null)).toBe("Syncing…");
        expect(syncStatusLabel(t, format, "starting", null)).toBe("Starting sync…");
        expect(syncStatusLabel(t, format, "idle", null)).toBe("Not synced yet");
        expect(syncStatusLabel(t, format, "stalled", null)).toBe("Not synced yet");
        expect(syncStatusLabel(t, format, "idle", "2026-10-17T16:00:00.000Z")).toMatch(
            /^Last sync /
        );
    });
});
