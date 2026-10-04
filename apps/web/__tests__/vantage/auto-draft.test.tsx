/** @jest-environment jsdom */

/**
 * Vantage drafts the week on arrival, and only once. While a draft is in
 * flight every caller shares it — two screens, a re-render, React's double
 * effect in development. A screen drafts a week on its own at most once
 * while it is open, so an answer that does not show up in the next read (a
 * workspace switched mid-draft) cannot loop. A finished or failed draft is
 * forgotten: Retry and "Draft it now" really ask the server again.
 */
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { AgendaDto } from "~/app/employer/tools/vantage/api";

const mockPrepare = jest.fn<Promise<{ agenda: AgendaDto }>, [string | undefined]>();
jest.mock("~/app/employer/tools/vantage/api", () => ({
    vantageApi: { prepare: (week?: string) => mockPrepare(week) },
}));

import {
    draftWeek,
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

    it("keeps drafting until the screen's reload after the draft settles", async () => {
        const reload = deferred<void>();
        const { result } = renderHook(() =>
            useAutoDraft({ week: WEEK, auto: true, onDrafted: () => reload.promise })
        );

        await act(async () => {});
        expect(mockPrepare).toHaveBeenCalledTimes(1);
        expect(result.current.drafting).toBe(true);

        await act(async () => reload.resolve());
        expect(result.current.drafting).toBe(false);
    });

    it("shares one request between two screens and across re-renders while it is in flight", async () => {
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

    it("shares the draft with a screen opened again while it is still in flight", async () => {
        const pending = deferred<{ agenda: AgendaDto }>();
        mockPrepare.mockReturnValue(pending.promise);
        const onDrafted = jest.fn();
        renderHook(() => useAutoDraft({ week: WEEK, auto: true, onDrafted })).unmount();

        renderHook(() => useAutoDraft({ week: WEEK, auto: true, onDrafted }));
        await act(async () => pending.resolve({ agenda: drafted }));

        expect(onDrafted).toHaveBeenCalledWith(drafted);
        expect(mockPrepare).toHaveBeenCalledTimes(1);
    });

    it("drafts once per open screen when the agenda keeps not showing up (workspace switch)", async () => {
        const onDrafted = jest.fn();
        const { rerender } = renderHook(
            ({ auto }: { auto: boolean }) => useAutoDraft({ week: WEEK, auto, onDrafted }),
            { initialProps: { auto: true } }
        );
        await waitFor(() => expect(onDrafted).toHaveBeenCalledTimes(1));

        // The read after the draft has an agenda (auto off), then — another
        // workspace's data — none again (auto on), over and over.
        for (let i = 0; i < 3; i++) {
            rerender({ auto: false });
            rerender({ auto: true });
            await act(async () => {});
        }

        expect(mockPrepare).toHaveBeenCalledTimes(1);
        expect(onDrafted).toHaveBeenCalledTimes(1);
    });

    it("asks the server again when drafted by hand after a successful draft", async () => {
        const onDrafted = jest.fn();
        const { result } = renderHook(() => useAutoDraft({ week: WEEK, auto: true, onDrafted }));
        await waitFor(() => expect(onDrafted).toHaveBeenCalledTimes(1));

        act(() => result.current.draft());

        await waitFor(() => expect(onDrafted).toHaveBeenCalledTimes(2));
        expect(mockPrepare).toHaveBeenCalledTimes(2);
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

    it("drafts a new week on its own when the week changes", async () => {
        const onDrafted = jest.fn();
        const { rerender } = renderHook(
            ({ week }: { week: string }) => useAutoDraft({ week, auto: true, onDrafted }),
            { initialProps: { week: WEEK } }
        );
        await waitFor(() => expect(onDrafted).toHaveBeenCalledTimes(1));

        rerender({ week: "2026-10-12" });
        await waitFor(() => expect(onDrafted).toHaveBeenCalledTimes(2));

        rerender({ week: WEEK });
        await act(async () => {});

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

    it("does not retry a failure on its own when auto flips", async () => {
        mockPrepare.mockRejectedValueOnce(new Error("The model is busy"));
        const { result, rerender } = renderHook(
            ({ auto }: { auto: boolean }) =>
                useAutoDraft({ week: WEEK, auto, onDrafted: jest.fn() }),
            { initialProps: { auto: true } }
        );
        await waitFor(() => expect(result.current.error).toBe("The model is busy"));

        rerender({ auto: false });
        rerender({ auto: true });
        await act(async () => {});

        expect(mockPrepare).toHaveBeenCalledTimes(1);
    });

    it("says the week could not be drafted when the failure has no message", async () => {
        mockPrepare.mockRejectedValueOnce("nope");

        const { result } = renderHook(() =>
            useAutoDraft({ week: WEEK, auto: true, onDrafted: jest.fn() })
        );

        await waitFor(() => expect(result.current.error).toBe("Vantage could not draft the week"));
    });
});

describe("draftWeek", () => {
    it("shares a request only while it is in flight", async () => {
        const pending = deferred<{ agenda: AgendaDto }>();
        mockPrepare.mockReturnValueOnce(pending.promise);

        const first = draftWeek(WEEK);
        expect(draftWeek(WEEK)).toBe(first);
        pending.resolve({ agenda: drafted });
        await expect(first).resolves.toBe(drafted);

        const later = draftWeek(WEEK);
        expect(later).not.toBe(first);
        await expect(later).resolves.toBe(drafted);
        expect(mockPrepare).toHaveBeenCalledTimes(2);
    });

    it("forgets a failed request, so the next call asks again", async () => {
        mockPrepare.mockRejectedValueOnce(new Error("down"));

        await expect(draftWeek(WEEK)).rejects.toThrow("down");
        await expect(draftWeek(WEEK)).resolves.toBe(drafted);
        expect(mockPrepare).toHaveBeenCalledTimes(2);
    });

    it("keeps weeks apart", async () => {
        await Promise.all([draftWeek(WEEK), draftWeek("2026-10-12"), draftWeek(WEEK)]);

        expect(mockPrepare.mock.calls).toEqual([[WEEK], ["2026-10-12"]]);
    });
});
