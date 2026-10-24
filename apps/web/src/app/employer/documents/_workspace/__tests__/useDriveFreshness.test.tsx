/** @jest-environment jsdom */

import { act, renderHook } from "@testing-library/react";

import { useDriveFreshness } from "../useDriveFreshness";

/**
 * An open Drive-backed document has to notice Drive's edits by itself: a
 * linked file is pulled when it opens and when the reader comes back to the
 * tab, and any Drive-backed file is checked for a new version every minute.
 */

const fetchMock = jest.fn();

function setVisibility(state: DocumentVisibilityState) {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
}

function comeBack() {
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
}

async function flush() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}

beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(() => {
    jest.useFakeTimers();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    setVisibility("visible");
});

afterEach(() => {
    jest.useRealTimers();
});

function pulls() {
    return fetchMock.mock.calls.filter(([url]) => url === "/api/documents/7/google-docs/sync");
}

describe("useDriveFreshness", () => {
    it("pulls a linked file on open, then shows what the pull brought", async () => {
        const onPulled = jest.fn();
        const onCheck = jest.fn();
        renderHook(() =>
            useDriveFreshness({ documentId: 7, linked: true, watch: true, onPulled, onCheck })
        );
        await flush();

        expect(pulls()).toHaveLength(1);
        expect(onPulled).toHaveBeenCalledTimes(1);
        expect(onCheck).toHaveBeenCalledTimes(1);
    });

    it("pulls again on coming back to the tab, at most once a minute", async () => {
        const onCheck = jest.fn();
        renderHook(() =>
            useDriveFreshness({
                documentId: 7,
                linked: true,
                watch: true,
                onPulled: jest.fn(),
                onCheck,
            })
        );
        await flush();

        // Straight back from another tab: too soon to pull, still checked.
        setVisibility("hidden");
        comeBack();
        await flush();
        expect(pulls()).toHaveLength(1);
        expect(onCheck).toHaveBeenCalledTimes(2);

        // Back after editing in Google Docs for a while.
        setVisibility("hidden");
        act(() => {
            jest.setSystemTime(Date.now() + 61_000);
        });
        comeBack();
        await flush();
        expect(pulls()).toHaveLength(2);
    });

    it("never pulls a connector import, but checks it every minute while visible", async () => {
        const onCheck = jest.fn();
        renderHook(() =>
            useDriveFreshness({
                documentId: 7,
                linked: false,
                watch: true,
                onPulled: jest.fn(),
                onCheck,
            })
        );
        await flush();
        // Opening read the versions already; nothing new to look for yet.
        expect(onCheck).not.toHaveBeenCalled();

        act(() => {
            jest.advanceTimersByTime(60_000);
        });
        expect(onCheck).toHaveBeenCalledTimes(1);

        setVisibility("hidden");
        act(() => {
            jest.advanceTimersByTime(60_000);
        });
        expect(onCheck).toHaveBeenCalledTimes(1);
        expect(pulls()).toHaveLength(0);
    });

    it("does nothing for a document Drive does not back", async () => {
        const onCheck = jest.fn();
        renderHook(() =>
            useDriveFreshness({
                documentId: 7,
                linked: false,
                watch: false,
                onPulled: jest.fn(),
                onCheck,
            })
        );
        await flush();
        act(() => {
            jest.advanceTimersByTime(120_000);
        });
        comeBack();
        await flush();

        expect(fetchMock).not.toHaveBeenCalled();
        expect(onCheck).not.toHaveBeenCalled();
    });
});
