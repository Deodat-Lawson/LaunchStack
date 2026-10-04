/** @jest-environment jsdom */

/**
 * `useOneClick` is how every suggestion is answered: the card leaves at
 * once, the work runs once however often it is clicked, the screen
 * re-reads, and the toast offers an Undo. An Undo that lands tells every
 * open Vantage screen to re-read ("vantage:changed"); one that fails says
 * so and offers to try again.
 */
import { act, renderHook } from "@testing-library/react";
import { toast } from "sonner";

import {
    SET_ASIDE_DAYS,
    setAside,
    undoToast,
    useOneClick,
    type Outcome,
} from "~/app/employer/tools/vantage/_lib/actions";
import { addDaysIso, todayIso } from "~/app/employer/tools/vantage/_lib/format";

jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { error: jest.fn() }) }));
jest.mock("~/app/employer/tools/vantage/api", () => ({ vantageApi: {} }));

const mockToast = jest.mocked(toast);

type Action = { label: string; onClick: () => void };

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/** Let every pending promise chain run. */
const settle = () => act(() => new Promise<void>(r => setTimeout(r, 0)));

function lastAction(mock: jest.Mock): Action {
    const call = mock.mock.calls.at(-1) as [string, { action?: Action }] | undefined;
    if (!call?.[1]?.action) throw new Error("no toast with an action");
    return call[1].action;
}

beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
});

describe("useOneClick", () => {
    it("takes the card away at once, runs the work, re-reads, then lets the data decide", async () => {
        const refresh = jest.fn(() => Promise.resolve());
        const work = deferred<Outcome>();
        const { result } = renderHook(() => useOneClick(refresh));

        act(() => void result.current.act("topic:t1", () => work.promise));
        expect(result.current.gone.has("topic:t1")).toBe(true);
        expect(refresh).not.toHaveBeenCalled();

        await act(async () => work.resolve({ message: "Added to the agenda" }));

        expect(refresh).toHaveBeenCalledTimes(1);
        expect(result.current.gone.has("topic:t1")).toBe(false);
        expect(mockToast).toHaveBeenCalledWith("Added to the agenda", { description: undefined });
    });

    it("ignores a second answer to the same suggestion while the first is in flight", async () => {
        const refresh = jest.fn(() => Promise.resolve());
        const first = deferred<Outcome>();
        const work = jest.fn(() => first.promise);
        const other = jest.fn(() => Promise.resolve({ message: "Ignored" }));
        const { result } = renderHook(() => useOneClick(refresh));

        act(() => {
            // Two clicks in one frame, then a different card.
            void result.current.act("commit:t1", work);
            void result.current.act("commit:t1", work);
            void result.current.act("topic:t2", other);
        });

        expect(work).toHaveBeenCalledTimes(1);
        expect(other).toHaveBeenCalledTimes(1);

        await act(async () => first.resolve({ message: "Committed" }));
        await settle();

        // Settled: the same suggestion can be answered again.
        await act(() => result.current.act("commit:t1", work));
        expect(work).toHaveBeenCalledTimes(2);
    });

    it("puts the card back, says why and does not re-read when the work fails", async () => {
        const refresh = jest.fn(() => Promise.resolve());
        const { result } = renderHook(() => useOneClick(refresh));

        await act(() => result.current.act("topic:t1", () => Promise.reject(new Error("Gone"))));

        expect(result.current.gone.has("topic:t1")).toBe(false);
        expect(mockToast.error).toHaveBeenCalledWith("Gone");
        expect(mockToast).not.toHaveBeenCalled();
        expect(refresh).not.toHaveBeenCalled();

        // A failure does not lock the suggestion.
        const retry = jest.fn(() => Promise.resolve({ message: "Added" }));
        await act(() => result.current.act("topic:t1", retry));
        expect(retry).toHaveBeenCalledTimes(1);
    });

    it("re-reads every open screen when an Undo lands", async () => {
        const here = jest.fn(() => Promise.resolve());
        const elsewhere = jest.fn(() => Promise.resolve());
        const undo = jest.fn(() => Promise.resolve());
        const { result } = renderHook(() => useOneClick(here));
        renderHook(() => useOneClick(elsewhere));

        await act(() =>
            result.current.act("topic:t1", () =>
                Promise.resolve({ message: "Ignored", description: "SSO", undo })
            )
        );
        expect(here).toHaveBeenCalledTimes(1);
        expect(elsewhere).not.toHaveBeenCalled();
        expect(mockToast).toHaveBeenCalledWith(
            "Ignored",
            expect.objectContaining({
                description: "SSO",
                action: expect.objectContaining({ label: "Undo" }),
            })
        );

        act(() => lastAction(mockToast).onClick());
        await settle();

        expect(undo).toHaveBeenCalledTimes(1);
        expect(here).toHaveBeenCalledTimes(2);
        expect(elsewhere).toHaveBeenCalledTimes(1);
    });

    it("stops listening once the screen is gone", async () => {
        const refresh = jest.fn(() => Promise.resolve());
        const { unmount } = renderHook(() => useOneClick(refresh));
        unmount();

        undoToast("Ignored", () => Promise.resolve());
        act(() => lastAction(mockToast).onClick());
        await settle();

        expect(refresh).not.toHaveBeenCalled();
    });
});

describe("undoToast", () => {
    it("offers Try again when the Undo fails, and retrying re-reads the screen", async () => {
        const refresh = jest.fn(() => Promise.resolve());
        renderHook(() => useOneClick(refresh));
        const undo = jest
            .fn<Promise<unknown>, []>()
            .mockRejectedValueOnce(new Error("Network down"))
            .mockResolvedValueOnce(undefined);

        undoToast("Committed — Dana, due 10 Oct", undo, "Ship the SSO beta");
        act(() => lastAction(mockToast).onClick());
        await settle();

        expect(mockToast.error).toHaveBeenCalledWith(
            "Network down",
            expect.objectContaining({
                description: "Ship the SSO beta",
                action: expect.objectContaining({ label: "Try again" }),
            })
        );
        expect(refresh).not.toHaveBeenCalled();

        act(() => lastAction(mockToast.error).onClick());
        await settle();

        expect(undo).toHaveBeenCalledTimes(2);
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(mockToast.error).toHaveBeenCalledTimes(1);
    });

    it("keeps offering Try again while the Undo keeps failing, in plain words without a message", async () => {
        const undo = jest.fn<Promise<unknown>, []>().mockRejectedValue("nope");

        undoToast("Ignored", undo);
        act(() => lastAction(mockToast).onClick());
        await settle();
        act(() => lastAction(mockToast.error).onClick());
        await settle();

        expect(undo).toHaveBeenCalledTimes(2);
        expect(mockToast.error).toHaveBeenCalledTimes(2);
        expect(mockToast.error).toHaveBeenLastCalledWith(
            "Could not undo that",
            expect.objectContaining({ action: expect.objectContaining({ label: "Try again" }) })
        );
    });
});

describe("setting a suggestion aside", () => {
    it("uses the agreed spans", () => {
        expect(SET_ASIDE_DAYS).toEqual({ snooze: 1, nudge: 7, nextStep: 60, conflict: 60 });
    });

    it("hides it on this browser for the span, and Undo shows it again", async () => {
        const outcome = await setAside("commit:t1", SET_ASIDE_DAYS.nextStep, "Ignored");

        const stored = () =>
            JSON.parse(window.localStorage.getItem("vantage:hidden:v1") ?? "{}") as Record<
                string,
                string
            >;
        expect(stored()).toEqual({ "commit:t1": addDaysIso(todayIso(), 60) });
        expect(outcome.message).toBe("Ignored");

        await outcome.undo?.();
        expect(stored()).toEqual({});
    });
});
