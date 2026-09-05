/**
 * The starters route is thin on purpose: auth, a rate-limit tier that
 * depends on whether a model call is guaranteed, and the generator. These pin
 * the three seams.
 */

import { GET } from "~/app/api/ask/starters/route";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { makeWorkspaceContext } from "../helpers/workspace-context";
import { RateLimitPresets, type RateLimitConfig } from "~/lib/rate-limiter";
import { getAskStarters } from "~/server/ask-starters";
import { NextResponse } from "next/server";

// The route only needs the one helper; the real module reaches the engine,
// which cannot be built in a unit test.
jest.mock("~/lib/require-workspace-context", () => ({ requireWorkspaceContext: jest.fn() }));

jest.mock("~/server/ask-starters", () => ({ getAskStarters: jest.fn() }));

const limiterCalls: RateLimitConfig[] = [];
jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (
        _request: Request,
        config: RateLimitConfig,
        handler: () => Promise<NextResponse>
    ) => {
        limiterCalls.push(config);
        return handler();
    },
}));

const CTX: WorkspaceContext = makeWorkspaceContext({
    authUserId: "user_1",
    userPk: BigInt(1),
    companyId: BigInt(42),
    role: "employee",
});

const PAYLOAD = {
    starters: [
        { id: "g1", question: "Summarize the Globex MSA", hint: "the MSA", documentIds: [17] },
    ],
    basis: {
        companyName: "Acme",
        sourceCount: 1,
        hasProfile: true,
        mode: "generated" as const,
        generatedAt: "2026-09-02T00:00:00.000Z",
    },
};

beforeEach(() => {
    limiterCalls.length = 0;
    jest.mocked(requireWorkspaceContext).mockReset();
    jest.mocked(getAskStarters).mockReset();
});

describe("GET /api/ask/starters", () => {
    it("passes an auth failure through untouched", async () => {
        const denied = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        jest.mocked(requireWorkspaceContext).mockResolvedValue({
            success: false,
            response: denied,
        });

        const response = await GET(new Request("http://localhost/api/ask/starters"));

        expect(response.status).toBe(401);
        expect(getAskStarters).not.toHaveBeenCalled();
    });

    it("returns the workspace's starters under the standard limiter", async () => {
        jest.mocked(requireWorkspaceContext).mockResolvedValue({ success: true, data: CTX });
        jest.mocked(getAskStarters).mockResolvedValue(PAYLOAD);

        const response = await GET(new Request("http://localhost/api/ask/starters"));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ success: true, data: PAYLOAD });
        expect(getAskStarters).toHaveBeenCalledWith({
            companyId: BigInt(42),
            scope: { kind: "everything" },
            refresh: false,
        });
        expect(limiterCalls).toEqual([RateLimitPresets.standard]);
    });

    it("treats refresh=1 as a guaranteed model call and applies the burst limiter", async () => {
        jest.mocked(requireWorkspaceContext).mockResolvedValue({ success: true, data: CTX });
        jest.mocked(getAskStarters).mockResolvedValue(PAYLOAD);

        await GET(new Request("http://localhost/api/ask/starters?refresh=1"));

        expect(getAskStarters).toHaveBeenCalledWith({
            companyId: BigInt(42),
            scope: { kind: "everything" },
            refresh: true,
        });
        expect(limiterCalls).toEqual([RateLimitPresets.burst]);
    });

    it("never leaks a generator failure to the client", async () => {
        jest.mocked(requireWorkspaceContext).mockResolvedValue({ success: true, data: CTX });
        jest.mocked(getAskStarters).mockRejectedValue(new Error("pg: connection refused"));
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await GET(new Request("http://localhost/api/ask/starters"));

        expect(response.status).toBe(500);
        const body = (await response.json()) as { message: string };
        expect(body.message).toBe("Request failed");
        expect(body.message).not.toContain("pg:");
        consoleError.mockRestore();
    });
});
