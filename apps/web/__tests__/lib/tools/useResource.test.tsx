/** @jest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";

jest.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
jest.mock("~/lib/tools/errorText", () => ({
    useErrorText: () => (_e: unknown, fallback: string) => fallback,
}));

import { forgetResources, useResource } from "~/lib/tools/useResource";

beforeEach(() => forgetResources());

describe("useResource across a remount", () => {
    it("shows what it last loaded at once, and refreshes it in the background", async () => {
        let n = 0;
        const fetcher = jest.fn(async () => ({ n: ++n }));
        const first = renderHook(() =>
            useResource("companies:seg-1", fetcher, { keepAcrossMounts: true })
        );
        expect(first.result.current.loading).toBe(true);
        await waitFor(() => expect(first.result.current.data).toEqual({ n: 1 }));
        first.unmount();

        // A tab switch away and back: the screen mounts again.
        const second = renderHook(() =>
            useResource("companies:seg-1", fetcher, { keepAcrossMounts: true })
        );
        expect(second.result.current.loading).toBe(false);
        expect(second.result.current.data).toEqual({ n: 1 });
        await waitFor(() => expect(second.result.current.data).toEqual({ n: 2 }));
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("starts from a skeleton without the option, as before", async () => {
        const fetcher = jest.fn(async () => "x");
        const first = renderHook(() => useResource("deals:seg-1", fetcher));
        await waitFor(() => expect(first.result.current.data).toBe("x"));
        first.unmount();
        const second = renderHook(() => useResource("deals:seg-1", fetcher));
        expect(second.result.current.loading).toBe(true);
        expect(second.result.current.data).toBeNull();
    });

    it("keeps an optimistic change for the next mount, and keys stay apart", async () => {
        const fetcher = jest.fn(async () => ({ stage: "lead" }));
        const first = renderHook(() =>
            useResource("company:a", fetcher, { keepAcrossMounts: true })
        );
        await waitFor(() => expect(first.result.current.data).toEqual({ stage: "lead" }));
        act(() => first.result.current.mutate(() => ({ stage: "won" })));
        first.unmount();
        const again = renderHook(() =>
            useResource("company:a", () => new Promise(() => undefined), {
                keepAcrossMounts: true,
            })
        );
        expect(again.result.current.data).toEqual({ stage: "won" });
        const other = renderHook(() =>
            useResource("company:b", () => new Promise(() => undefined), {
                keepAcrossMounts: true,
            })
        );
        expect(other.result.current.data).toBeNull();
        expect(other.result.current.loading).toBe(true);
    });
});
