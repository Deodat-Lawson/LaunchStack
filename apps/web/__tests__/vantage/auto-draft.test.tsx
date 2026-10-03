/** @jest-environment jsdom */

/**
 * Vantage drafts the week on arrival, once. Two screens asking at the same
 * time, a re-render, or React's double effect in development must share one
 * prepare request; a failure must be retryable; and nothing is asked for
 * when the screen says not to.
 */
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { AgendaDto } from "~/app/employer/tools/vantage/api";

const mockPrepare = jest.fn<Promise<{ agenda: AgendaDto }>, [string | undefined]>();
jest.mock("~/app/employer/tools/vantage/api", () => ({
    vantageApi: { prepare: (week?: string) => mockPrepare(week) },
}));

import {
    draftWeekOnce,
    resetAutoDraftForTests,
    useAutoDraft,
} from "~/app/employer/tools/vantage/_lib/useAutoDraft";

import { WEEK, agenda } from "./factories";

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

const drafted = agenda({ id: "a-drafted" });

beforeEach(() => {
    resetAutoDraftForTests();
    mockPrepare.mockReset().mockResolvedValue({ agenda: drafted });
});

describe("useAutoDraft", () => {
    it("drafts once, hands over the agenda, and reports drafting meanwhile", async () => {
        const pending = deferred<{ agenda: AgendaDto }>();
        mockPrepare.mockReturnValue(pending.promise);
        const onDrafted = jest.fn();

        const { result } = renderHook(() => useAutoDraft({ week: WEEK, auto: true, onDrafted }));

        expect(result.current.drafting).toBe(true);
        expect(mockPrepare).toHaveBeenCalledTimes(1);
        expect(mockPrepare).toHaveBeenCalledWith(WEEK);

        await act(async () => pending.resolve({ agenda: drafted }));

        expect(result.current.drafting).toBe(false);
        expect(result.current.error).toBeNull();
        expect(onDrafted).toHaveBeenCalledTimes(1);
        expect(onDrafted).toHaveBeenCalledWith(drafted);
    });

    it("keeps drafting until the screen's reload settles, so no no-agenda flash", async () => {
        const reload = deferred<void>();
        const onDrafted = jest.fn(() => reload.promise);

        const { result } = renderHook(() => useAutoDraft({ week: WEEK, auto: true, onDrafted }));
        await waitFor(() => expect(onDrafted).toHaveBeenCalledWith(drafted));

        // The draft is back but the screen's fresh data is not: still drafting.
        expect(result.current.drafting).toBe(true);

        await act(async () => reload.resolve());
        expect(result.current.drafting).toBe(false);
        expect(result.current.error).toBeNull();
    });

    it("shares one request between two screens and across re-renders", async () => {
        const first = jest.fn();
        const second = jest.fn();

        const a = renderHook(() => useAutoDraft({ week: WEEK, auto: true, onDrafted: first }));
        const b = renderHook(() => useAutoDraft({ week: WEEK, auto: true, onDrafted: second }));
        a.rerender();
        b.rerender();

        await waitFor(() => expect(second).toHaveBeenCalledWith(drafted));
        expect(first).toHaveBeenCalledWith(drafted);
        expect(mockPrepare).toHaveBeenCalledTimes(1);
    });

    it("survives React's double effect in development with one request", async () => {
        const onDrafted = jest.fn();

        renderHook(() => useAutoDraft({ week: WEEK, auto: true, onDrafted }), {
            wrapper: React.StrictMode,
        });

        await waitFor(() => expect(onDrafted).toHaveBeenCalled());
        expect(mockPrepare).toHaveBeenCalledTimes(1);
    });

    it("survives being unmounted and mounted again with one request", async () => {
        const onDrafted = jest.fn();
        const first = renderHook(() => useAutoDraft({ week: WEEK, auto: true, onDrafted }));
        first.unmount();

        renderHook(() => useAutoDraft({ week: WEEK, auto: true, onDrafted }));

        await waitFor(() => expect(onDrafted).toHaveBeenCalled());
        expect(mockPrepare).toHaveBeenCalledTimes(1);
    });

    it("asks nothing when auto is off or the week is not known, until asked", async () => {
        const onDrafted = jest.fn();
        const off = renderHook(() => useAutoDraft({ week: WEEK, auto: false, onDrafted }));
        renderHook(() => useAutoDraft({ week: null, auto: true, onDrafted }));

        expect(mockPrepare).not.toHaveBeenCalled();
        expect(off.result.current.drafting).toBe(false);

        act(() => off.result.current.draft());

        await waitFor(() => expect(onDrafted).toHaveBeenCalledWith(drafted));
        expect(mockPrepare).toHaveBeenCalledTimes(1);
    });

    it("drafts each week once", async () => {
        const onDrafted = jest.fn();
        const { rerender } = renderHook(
            ({ week }: { week: string }) => useAutoDraft({ week, auto: true, onDrafted }),
            { initialProps: { week: WEEK } }
        );
        await waitFor(() => expect(onDrafted).toHaveBeenCalledTimes(1));

        rerender({ week: "2026-10-12" });

        await waitFor(() => expect(onDrafted).toHaveBeenCalledTimes(2));
        expect(mockPrepare.mock.calls).toEqual([[WEEK], ["2026-10-12"]]);
    });

    it("reports a failure, and Retry asks again", async () => {
        mockPrepare.mockRejectedValueOnce(new Error("The model is busy"));
        const onDrafted = jest.fn();

        const { result } = renderHook(() => useAutoDraft({ week: WEEK, auto: true, onDrafted }));

        await waitFor(() => expect(result.current.error).toBe("The model is busy"));
        expect(result.current.drafting).toBe(false);
        expect(onDrafted).not.toHaveBeenCalled();

        act(() => result.current.draft());
        expect(result.current.error).toBeNull();
        expect(result.current.drafting).toBe(true);

        await waitFor(() => expect(onDrafted).toHaveBeenCalledWith(drafted));
        expect(mockPrepare).toHaveBeenCalledTimes(2);
        expect(result.current.drafting).toBe(false);
    });

    it("says the week could not be drafted when the failure has no message", async () => {
        mockPrepare.mockRejectedValueOnce("nope");

        const { result } = renderHook(() =>
            useAutoDraft({ week: WEEK, auto: true, onDrafted: jest.fn() })
        );

        await waitFor(() => expect(result.current.error).toBe("Vantage could not draft the week"));
    });
});

describe("draftWeekOnce", () => {
    it("returns the same promise for the same week until it fails", async () => {
        mockPrepare.mockRejectedValueOnce(new Error("down"));

        const first = draftWeekOnce(WEEK);
        expect(draftWeekOnce(WEEK)).toBe(first);
        await expect(first).rejects.toThrow("down");

        const retry = draftWeekOnce(WEEK);
        expect(retry).not.toBe(first);
        await expect(retry).resolves.toBe(drafted);
        expect(draftWeekOnce(WEEK)).toBe(retry);
        expect(mockPrepare).toHaveBeenCalledTimes(2);
    });
});
