/** @jest-environment jsdom */

import { act, renderHook } from "@testing-library/react";

import type { ProcessingQueueResponse } from "~/lib/processing-queue/types";

import {
    QUEUE_POLL,
    nextQueuePollDelay,
    queueIsActive,
    refreshProcessingQueue,
    resetProcessingQueueForTests,
    useProcessingQueue,
} from "../processing/queueStore";

/**
 * How often the Processing tab asks: every 2 s while anything moves, slower
 * and slower when nothing does, never while the browser tab is hidden, and
 * one poller however many watchers there are.
 */

function answer(
    summary: Partial<ProcessingQueueResponse["summary"]> = {}
): ProcessingQueueResponse {
    return {
        items: [],
        connectors: [],
        summary: { running: 0, waiting: 0, retrying: 0, failed: 0, done: 0, ...summary },
        serverTime: new Date().toISOString(),
    };
}

describe("nextQueuePollDelay", () => {
    it("is 2 s while something moves", () => {
        expect(nextQueuePollDelay({ active: true, idleTicks: 0, errorTicks: 0 })).toBe(2_000);
        expect(QUEUE_POLL.activeMs).toBe(2_000);
    });

    it("backs off when idle, up to a minute", () => {
        const delays = [0, 1, 2, 3, 10].map(idleTicks =>
            nextQueuePollDelay({ active: false, idleTicks, errorTicks: 0 })
        );
        expect(delays).toEqual([10_000, 15_000, 22_500, 33_750, 60_000]);
    });

    it("slows down after failures, whatever else is true", () => {
        expect(nextQueuePollDelay({ active: true, idleTicks: 0, errorTicks: 1 })).toBe(5_000);
        expect(nextQueuePollDelay({ active: true, idleTicks: 0, errorTicks: 3 })).toBe(20_000);
        expect(nextQueuePollDelay({ active: true, idleTicks: 0, errorTicks: 9 })).toBe(60_000);
    });
});

describe("queueIsActive", () => {
    it("counts running, waiting, retrying and a running connector — not failed or done", () => {
        expect(queueIsActive(null)).toBe(false);
        expect(queueIsActive(answer({ failed: 2, done: 5 }))).toBe(false);
        expect(queueIsActive(answer({ retrying: 1 }))).toBe(true);
        expect(
            queueIsActive({
                ...answer(),
                connectors: [
                    {
                        provider: "google-drive",
                        account: null,
                        status: "running",
                        lastSyncAt: null,
                        report: null,
                        error: null,
                    },
                ],
            })
        ).toBe(true);
    });
});

describe("useProcessingQueue", () => {
    let fetchMock: jest.Mock;

    beforeEach(() => {
        jest.useFakeTimers();
        resetProcessingQueueForTests();
        fetchMock = jest.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve(answer({ running: 1 })),
            })
        );
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    async function settle() {
        await act(async () => {
            for (let i = 0; i < 5; i++) await Promise.resolve();
        });
    }

    it("shares one poller, asks every 2 s while busy, and stops when nobody watches", async () => {
        const a = renderHook(() => useProcessingQueue());
        const b = renderHook(() => useProcessingQueue());
        await settle();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(a.result.current.data?.summary.running).toBe(1);
        expect(b.result.current.loading).toBe(false);

        await act(async () => {
            jest.advanceTimersByTime(2_000);
        });
        await settle();
        expect(fetchMock).toHaveBeenCalledTimes(2);

        a.unmount();
        b.unmount();
        await act(async () => {
            jest.advanceTimersByTime(10_000);
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not poll while disabled, and asks at once when told to refresh", async () => {
        renderHook(() => useProcessingQueue(false));
        await settle();
        expect(fetchMock).not.toHaveBeenCalled();

        const watcher = renderHook(() => useProcessingQueue());
        await settle();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await act(async () => {
            await refreshProcessingQueue();
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        watcher.unmount();
    });

    it("keeps the last answer and says why when a request fails", async () => {
        const { result, unmount } = renderHook(() => useProcessingQueue());
        await settle();
        fetchMock.mockImplementationOnce(() =>
            Promise.resolve({
                ok: false,
                status: 503,
                json: () => Promise.resolve({ error: "The queue is unavailable." }),
            })
        );
        await act(async () => {
            jest.advanceTimersByTime(2_000);
        });
        await settle();
        expect(result.current.error).toBe("The queue is unavailable.");
        expect(result.current.data?.summary.running).toBe(1);
        unmount();
    });

    it("pauses while the browser tab is hidden and asks again on return", async () => {
        const { unmount } = renderHook(() => useProcessingQueue());
        await settle();
        const visibility = jest.spyOn(document, "visibilityState", "get");
        visibility.mockReturnValue("hidden");
        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });
        await act(async () => {
            jest.advanceTimersByTime(30_000);
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        visibility.mockReturnValue("visible");
        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });
        await settle();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        visibility.mockRestore();
        unmount();
    });
});
