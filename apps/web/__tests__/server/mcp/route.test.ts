/**
 * POST /api/mcp as HTTP: authentication failures pass through untouched,
 * GET/DELETE are 405, responses are JSON with no session id, and the rate
 * limits are per person per workspace — two people behind one IP never share
 * a budget.
 */
import type { McpAuthResult, McpPrincipal } from "~/server/mcp/principal";
import { authenticateMcpRequest } from "~/server/mcp/principal";
import { clearRateLimitStore } from "~/lib/rate-limiter";
import { DELETE, GET, POST } from "~/app/api/mcp/route";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

// Runs the work as-is: which workspace's models it gets is not this test's concern.
jest.mock("~/server/workspace-models/scope", () => ({
    withWorkspaceChatModels: (_companyId: unknown, fn: () => unknown) => fn(),
}));

jest.mock("~/server/mcp/principal", () => ({ authenticateMcpRequest: jest.fn() }));
jest.mock("~/server/mcp/config", () => ({
    mcpAvailability: () => ({
        enabled: true,
        origin: "http://localhost:3031",
        resource: "http://localhost:3031/api/mcp",
    }),
}));
// rate-limit-middleware imports the auth module for its session fallback,
// which these requests never reach: every bucket is keyed by the principal.
jest.mock("~/server/auth", () => ({ getSessionFromHeaders: jest.fn() }));
jest.mock("~/server/mcp/tools", () => {
    const { defineTool } = jest.requireActual("~/server/mcp/protocol");
    const { z } = jest.requireActual("zod");
    const annotations = {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
    };
    return {
        MCP_TOOLS: [
            defineTool({
                name: "save_conversation",
                title: "Save",
                description: "Saves.",
                inputSchema: { type: "object", properties: {} },
                annotations,
                requires: { scope: "launchstack:write", permission: "documents.upload" },
                rateLimit: { maxRequests: 30, windowMs: 15 * 60 * 1000 },
                args: z.object({}),
                run: async () => ({ ok: true, text: "saved", structured: { saved: true } }),
            }),
        ],
    };
});

const authenticate = authenticateMcpRequest as jest.MockedFunction<typeof authenticateMcpRequest>;

function principal(person: string): McpPrincipal {
    return {
        ctx: makeWorkspaceContext({ role: "member", authUserId: person }),
        scopes: new Set(["launchstack:read", "launchstack:write"]),
        credential: { kind: "key", keyId: person.length },
        label: `${person}'s key`,
        family: "other",
        rateLimitKey: `mcp:${person}:5`,
    };
}

/** Authenticates by the bearer token's name: `Bearer ada` is Ada. */
function authenticateByToken() {
    authenticate.mockImplementation(async (request: Request): Promise<McpAuthResult> => {
        const person = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
        return { ok: true, principal: principal(person) };
    });
}

function mcpRequest(
    person: string,
    message: unknown,
    headers: Record<string, string> = {}
): Request {
    return new Request("http://localhost:3031/api/mcp", {
        method: "POST",
        headers: {
            authorization: `Bearer ${person}`,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            // Everyone below is behind the same office NAT.
            "x-forwarded-for": "203.0.113.9",
            ...headers,
        },
        body: JSON.stringify(message),
    });
}

const ping = (id = 1) => ({ jsonrpc: "2.0", id, method: "ping" });
const saveCall = (id = 1) => ({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "save_conversation", arguments: {} },
});

beforeEach(() => {
    clearRateLimitStore();
    authenticate.mockReset();
    jest.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("methods", () => {
    it.each([
        ["GET", GET],
        ["DELETE", DELETE],
    ])("answers %s with 405 and Allow: POST", async (_name, handler) => {
        const response = handler();
        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe("POST");
        expect(response.headers.get("content-type")).toContain("application/json");
        expect(await response.json()).toMatchObject({ jsonrpc: "2.0", error: { code: -32000 } });
    });
});

describe("authentication", () => {
    it("returns authenticateMcpRequest's failure response as is", async () => {
        const challenge = new Response(
            JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "nope" }, id: null }),
            {
                status: 401,
                headers: {
                    "content-type": "application/json",
                    "www-authenticate":
                        'Bearer resource_metadata="http://localhost:3031/.well-known/oauth-protected-resource/api/mcp"',
                },
            }
        );
        authenticate.mockResolvedValue({ ok: false, response: challenge });
        const response = await POST(mcpRequest("nobody", ping()));
        expect(response).toBe(challenge);
        expect(response.status).toBe(401);
        expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
    });
});

describe("responses", () => {
    it("answers initialize with JSON and never issues or echoes a session id", async () => {
        authenticateByToken();
        const response = await POST(
            mcpRequest(
                "ada",
                {
                    jsonrpc: "2.0",
                    id: 1,
                    method: "initialize",
                    params: { protocolVersion: "2025-11-25", capabilities: {} },
                },
                { "mcp-session-id": "client-made-this-up" }
            )
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("application/json");
        expect(response.headers.get("mcp-session-id")).toBeNull();
        const body = (await response.json()) as { result: { protocolVersion: string } };
        expect(body.result.protocolVersion).toBe("2025-11-25");
    });

    it("answers a notification with 202 and an empty body", async () => {
        authenticateByToken();
        const response = await POST(
            mcpRequest("ada", { jsonrpc: "2.0", method: "notifications/initialized" })
        );
        expect(response.status).toBe(202);
        expect(await response.text()).toBe("");
    });

    it("answers an unsupported MCP-Protocol-Version header with 400", async () => {
        authenticateByToken();
        const response = await POST(
            mcpRequest("ada", ping(3), { "mcp-protocol-version": "1999-01-01" })
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ id: 3, error: { code: -32600 } });
    });
});

describe("rate limits", () => {
    it("gives two people behind the same IP separate request budgets", async () => {
        authenticateByToken();
        const first = await POST(mcpRequest("ada", ping()));
        const limit = Number(first.headers.get("x-ratelimit-limit"));
        expect(limit).toBe(300);

        for (let i = 1; i < limit; i += 1) {
            expect((await POST(mcpRequest("ada", ping(i)))).status).toBe(200);
        }
        const refused = await POST(mcpRequest("ada", ping(999)));
        expect(refused.status).toBe(429);
        expect(refused.headers.get("retry-after")).toMatch(/^\d+$/);
        expect(await refused.json()).toMatchObject({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32000, message: expect.stringContaining("Rate limit") },
        });

        // Bea shares Ada's IP, not her budget.
        const bea = await POST(mcpRequest("bea", ping()));
        expect(bea.status).toBe(200);
        expect(bea.headers.get("x-ratelimit-remaining")).toBe(String(limit - 1));
    });

    it("holds save_conversation to its own tighter budget, per person", async () => {
        authenticateByToken();
        for (let i = 0; i < 30; i += 1) {
            const body = (await (await POST(mcpRequest("ada", saveCall(i)))).json()) as {
                result: { isError?: boolean };
            };
            expect(body.result.isError).toBeUndefined();
        }
        const refused = (await (await POST(mcpRequest("ada", saveCall(31)))).json()) as {
            result: { isError?: boolean; content: { text: string }[] };
        };
        expect(refused.result.isError).toBe(true);
        expect(refused.result.content[0]?.text).toMatch(/Too many save_conversation calls/);

        // Ada can still read; Bea can still save.
        expect((await POST(mcpRequest("ada", ping()))).status).toBe(200);
        const bea = (await (await POST(mcpRequest("bea", saveCall()))).json()) as {
            result: { isError?: boolean };
        };
        expect(bea.result.isError).toBeUndefined();
    });
});
