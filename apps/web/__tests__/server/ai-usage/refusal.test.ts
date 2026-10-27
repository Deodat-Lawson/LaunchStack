/**
 * Refusing before work starts: the 429 a route answers with, the error a
 * service throws, and the shared route error handlers turning that error into
 * the same 429 rather than an English 4xx or a 500.
 */

const mockLoad = jest.fn();
jest.mock("~/server/workspace-models/scope", () => ({
    loadAiAllowance: (...args: unknown[]) => mockLoad(...args),
}));

import { handleRouteError as handleGrowthRouteError } from "~/server/distribution/http";
import { handleRouteError } from "~/server/api/responses";
import { AiAllowanceExceededError } from "~/server/ai-usage/errors";
import type { AiAllowance } from "~/server/ai-usage/quota";
import { assertWithinAiAllowance, refuseAtAiAllowance } from "~/server/ai-usage/refusal";

function allowance(overrides: Partial<AiAllowance> = {}): AiAllowance {
    return {
        start: "2026-10-01",
        resetsAt: "2026-11-01T00:00:00.000Z",
        used: 500_000,
        workspace: { limit: 500_000, source: "member" },
        server: null,
        binding: "workspace",
        percent: 100,
        blocked: true,
        ...overrides,
    };
}

beforeEach(() => mockLoad.mockReset());

describe("refuseAtAiAllowance", () => {
    it("answers 429 with which limit, when it resets and who can raise it", async () => {
        mockLoad.mockResolvedValue(allowance());
        const response = await refuseAtAiAllowance(5n, "u-1", "en");
        expect(response?.status).toBe(429);
        const body = (await response!.json()) as Record<string, unknown>;
        expect(body).toMatchObject({ success: false, code: "ai_allowance_reached" });
        expect(body.error).toBe(body.message);
        expect(body.message).toBe(
            "You've reached your AI limit in this workspace for this month (500,000 of 500,000 tokens). It resets on November 1, 2026. A workspace admin can raise it in Workspace › Usage and costs."
        );
        expect(mockLoad).toHaveBeenCalledWith(5n, "u-1");
    });

    it("names the server's limit, in Chinese for a Chinese reader", async () => {
        mockLoad.mockResolvedValue(
            allowance({ binding: "server", server: { limit: 2_000_000, used: 2_000_001 } })
        );
        const body = (await (await refuseAtAiAllowance(5n, "u-1", "zh-CN"))!.json()) as {
            message: string;
        };
        expect(body.message).toContain("这台服务器");
        expect(body.message).toContain("2,000,001 / 2,000,000");
        expect(body.message).toContain("2026");
    });

    it("lets the request through below the limit, without a person, or when the read fails", async () => {
        mockLoad.mockResolvedValue(allowance({ blocked: false }));
        await expect(refuseAtAiAllowance(5n, "u-1", "en")).resolves.toBeNull();
        await expect(refuseAtAiAllowance(5n, null, "en")).resolves.toBeNull();
        jest.spyOn(console, "warn").mockImplementation(() => {});
        mockLoad.mockRejectedValue(new Error("db down"));
        await expect(refuseAtAiAllowance(5n, "u-1", "en")).resolves.toBeNull();
    });
});

describe("assertWithinAiAllowance and the shared route handlers", () => {
    it("throws the allowance error at the limit", async () => {
        mockLoad.mockResolvedValue(allowance());
        await expect(assertWithinAiAllowance(5n, "u-1")).rejects.toBeInstanceOf(
            AiAllowanceExceededError
        );
        mockLoad.mockResolvedValue(allowance({ blocked: false }));
        await expect(assertWithinAiAllowance(5n, "u-1")).resolves.toBeUndefined();
    });

    it.each([
        ["~/server/api/responses", handleRouteError],
        ["~/server/distribution/http", handleGrowthRouteError],
    ])("%s answers it with the same 429", async (_name, handle) => {
        const request = new Request("http://localhost/api/x", {
            headers: { cookie: "ls-locale=zh-CN" },
        });
        const response = handle("test", new AiAllowanceExceededError(allowance()), request);
        expect(response.status).toBe(429);
        const body = (await response.json()) as { code: string; error: string };
        expect(body.code).toBe("ai_allowance_reached");
        expect(body.error).toContain("工作区");
    });
});
