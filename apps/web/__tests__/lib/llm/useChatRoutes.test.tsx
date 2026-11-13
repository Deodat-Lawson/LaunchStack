/** @jest-environment jsdom */

import { renderHook, waitFor } from "@testing-library/react";

import { useChatRoutes } from "~/app/employer/documents/hooks/useChatRoutes";

const routes = {
    default: { available: true, vision: { supported: true } },
    fast: { available: true },
    reasoning: { available: false, unavailableReason: "Not configured" },
    vision: { available: true, vision: { supported: true } },
};

describe("useChatRoutes", () => {
    const fetchMock = jest.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    it("lists the workspace's offered models under their admin-given names", async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({
                routes,
                models: [
                    {
                        key: "team-writer",
                        label: "Team writer",
                        available: true,
                        reasoning: { mode: "effort", controllable: true, efforts: ["low"] },
                    },
                    // Malformed entries never reach the menu.
                    { key: "Not A Key!", label: "Broken", available: true },
                    { key: "no-name", label: "  ", available: true },
                    null,
                ],
            }),
        });
        const { result } = renderHook(() => useChatRoutes());
        expect(result.current.loading).toBe(true);
        expect(result.current.offeredModels).toEqual([]);
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.failed).toBe(false);
        expect(result.current.offeredModels).toEqual([
            expect.objectContaining({ key: "team-writer", label: "Team writer" }),
        ]);
        expect(result.current.config.routes.fast.available).toBe(true);
        expect(result.current.config).not.toHaveProperty("models");
    });

    it("offers none when the server lists none", async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ routes }) });
        const { result } = renderHook(() => useChatRoutes());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.failed).toBe(false);
        expect(result.current.offeredModels).toEqual([]);
    });

    it("fails closed with no offered models when the configuration can't be read", async () => {
        fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
        const { result } = renderHook(() => useChatRoutes());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.failed).toBe(true);
        expect(result.current.offeredModels).toEqual([]);
        expect(result.current.config.routes.default.available).toBe(false);
    });
});
