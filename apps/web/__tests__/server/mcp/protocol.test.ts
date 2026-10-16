/**
 * The MCP dispatcher without HTTP: version negotiation, the transport's
 * accept/version/notification rules, JSON-RPC error codes, which tools a
 * credential sees, and how tool failures reach the model.
 */
import { z } from "zod";

import type { Permission } from "~/lib/authz/permissions";
import type { McpPrincipal } from "~/server/mcp/principal";
import {
    JSON_RPC,
    LATEST_PROTOCOL_VERSION,
    McpToolError,
    SUPPORTED_PROTOCOL_VERSIONS,
    acceptsJson,
    defineTool,
    handleMcpPost,
    type McpServerOptions,
    type McpTool,
    type ToolCallBudget,
} from "~/server/mcp/protocol";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const READ_ONLY = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
};

const echoTool = defineTool({
    name: "echo",
    title: "Echo",
    description: "Repeats text.",
    inputSchema: {
        type: "object",
        properties: { text: { type: "string" }, times: { type: "integer" } },
        required: ["text"],
    },
    outputSchema: {
        type: "object",
        properties: { echo: { type: "string" } },
        required: ["echo"],
    },
    annotations: READ_ONLY,
    requires: { scope: "launchstack:read", permission: "documents.read" },
    args: z.object({
        text: z.string().min(1),
        times: z.number().int().min(1).max(3).default(1),
    }),
    async run({ text, times }) {
        const structured = { echo: text.repeat(times) };
        return { ok: true, text: JSON.stringify(structured), structured };
    },
});

const writeTool = defineTool({
    name: "write",
    title: "Write",
    description: "Writes.",
    inputSchema: { type: "object", properties: {} },
    annotations: { ...READ_ONLY, readOnlyHint: false, idempotentHint: false },
    requires: { scope: "launchstack:write", permission: "documents.upload" },
    rateLimit: { maxRequests: 1, windowMs: 1000 },
    args: z.object({}),
    async run() {
        return { ok: true, text: "written", structured: { written: true } };
    },
});

const brokenTool = defineTool({
    name: "broken",
    title: "Broken",
    description: "Always fails.",
    inputSchema: { type: "object", properties: {} },
    annotations: READ_ONLY,
    requires: { scope: "launchstack:read", permission: "documents.read" },
    args: z.object({}),
    async run(): Promise<never> {
        throw new Error("connection refused at /var/secret/db.sock");
    },
});

const refusingTool = defineTool({
    name: "refusing",
    title: "Refusing",
    description: "Refuses with a message for the model.",
    inputSchema: { type: "object", properties: {} },
    annotations: READ_ONLY,
    requires: { scope: "launchstack:read", permission: "documents.read" },
    args: z.object({}),
    async run(): Promise<never> {
        throw new McpToolError("That folder does not exist.");
    },
});

const TOOLS: readonly McpTool[] = [echoTool, writeTool, brokenTool, refusingTool];

function principal(
    options: { scopes?: string[]; role?: string; permissions?: Permission[] } = {}
): McpPrincipal {
    return {
        ctx: makeWorkspaceContext({ role: options.role ?? "member", permissions: options.permissions }),
        scopes: new Set(options.scopes ?? ["launchstack:read", "launchstack:write"]),
        credential: { kind: "key", keyId: 1 },
        label: "Test key",
        family: "other",
        rateLimitKey: "mcp:test:5",
    };
}

interface PostOptions {
    raw?: string;
    accept?: string | null;
    protocolVersion?: string | null;
    principal?: McpPrincipal;
    chargeToolCall?: McpServerOptions["chargeToolCall"];
}

function post(message: unknown, options: PostOptions = {}) {
    return handleMcpPost(
        {
            body: options.raw ?? JSON.stringify(message),
            accept:
                options.accept === undefined
                    ? "application/json, text/event-stream"
                    : options.accept,
            protocolVersion: options.protocolVersion ?? null,
        },
        {
            principal: options.principal ?? principal(),
            origin: "https://launchstack.test",
            tools: TOOLS,
            instructions: "Search, then fetch.",
            chargeToolCall: options.chargeToolCall,
        }
    );
}

function request(method: string, params?: Record<string, unknown>, id: number | string = 1) {
    return { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
}

/** The result of a successful answer, typed loosely for assertions. */
function resultOf(answer: Awaited<ReturnType<typeof post>>): Record<string, unknown> {
    expect(answer.status).toBe(200);
    expect(answer.body).not.toBeNull();
    expect(answer.body).not.toHaveProperty("error");
    return (answer.body as { result: Record<string, unknown> }).result;
}

function errorOf(answer: Awaited<ReturnType<typeof post>>) {
    expect(answer.body).toHaveProperty("error");
    return answer.body as { id: unknown; error: { code: number; message: string } };
}

describe("initialize", () => {
    it.each(SUPPORTED_PROTOCOL_VERSIONS)("echoes the supported version %s", async version => {
        const result = resultOf(
            await post(
                request("initialize", {
                    protocolVersion: version,
                    capabilities: {},
                    clientInfo: { name: "test", version: "1" },
                })
            )
        );
        expect(result.protocolVersion).toBe(version);
    });

    it("answers with the newest version when the client asks for one it does not support", async () => {
        const result = resultOf(
            await post(request("initialize", { protocolVersion: "2024-11-05", capabilities: {} }))
        );
        expect(result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
        expect(LATEST_PROTOCOL_VERSION).toBe("2026-07-28");
    });

    it("describes the server: tools only, no list changes, name, title, version, instructions", async () => {
        const result = resultOf(
            await post(request("initialize", { protocolVersion: "2025-06-18", capabilities: {} }))
        );
        expect(result.capabilities).toEqual({ tools: { listChanged: false } });
        expect(result.serverInfo).toEqual({
            name: "launchstack",
            title: "LaunchStack",
            version: expect.any(String),
        });
        expect(result.instructions).toBe("Search, then fetch.");
    });

    it("refuses an initialize without a protocolVersion as invalid params", async () => {
        const answer = await post(request("initialize", { capabilities: {} }, "init-1"));
        expect(answer.status).toBe(200);
        expect(errorOf(answer)).toMatchObject({
            id: "init-1",
            error: { code: JSON_RPC.INVALID_PARAMS },
        });
    });
});

describe("transport rules", () => {
    it("answers 400 with a JSON-RPC error when MCP-Protocol-Version is unsupported", async () => {
        const answer = await post(request("ping", undefined, 7), { protocolVersion: "2099-01-01" });
        expect(answer.status).toBe(400);
        expect(errorOf(answer)).toMatchObject({
            jsonrpc: "2.0",
            id: 7,
            error: { code: JSON_RPC.INVALID_REQUEST },
        });
        expect(errorOf(answer).error.message).toContain("2099-01-01");
    });

    it("accepts every supported MCP-Protocol-Version header", async () => {
        for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
            expect(resultOf(await post(request("ping"), { protocolVersion: version }))).toEqual({});
        }
    });

    it.each([
        ["notifications/initialized", undefined],
        ["notifications/cancelled", { requestId: 3, reason: "user stopped" }],
        ["notifications/roots/list_changed", undefined],
    ])("answers the notification %s with 202 and no body", async (method, params) => {
        const answer = await post({ jsonrpc: "2.0", method, ...(params ? { params } : {}) });
        expect(answer).toEqual({ status: 202, body: null });
    });

    it("answers client responses (result or error, no method) with 202 and no body", async () => {
        expect(await post({ jsonrpc: "2.0", id: 4, result: {} })).toEqual({
            status: 202,
            body: null,
        });
        expect(
            await post({ jsonrpc: "2.0", id: 5, error: { code: -1, message: "declined" } })
        ).toEqual({ status: 202, body: null });
    });

    it("rejects a batch with -32600", async () => {
        for (const batch of [[request("ping", undefined, 1), request("ping", undefined, 2)], []]) {
            const answer = await post(batch);
            expect(answer.status).toBe(400);
            expect(errorOf(answer)).toMatchObject({
                id: null,
                error: { code: JSON_RPC.INVALID_REQUEST },
            });
        }
    });

    it("rejects malformed JSON with -32700", async () => {
        for (const raw of ['{"jsonrpc":"2.0","id":1,', "", "not json"]) {
            const answer = await post(null, { raw });
            expect(answer.status).toBe(400);
            expect(errorOf(answer)).toMatchObject({
                id: null,
                error: { code: JSON_RPC.PARSE_ERROR },
            });
        }
    });

    it("rejects JSON that is not a JSON-RPC message with -32600", async () => {
        for (const message of [
            42,
            "ping",
            null,
            { jsonrpc: "1.0", id: 1, method: "ping" },
            { jsonrpc: "2.0", id: null, method: "ping" },
            { jsonrpc: "2.0", id: 1, method: 12 },
            { jsonrpc: "2.0", id: 1 },
        ]) {
            const answer = await post(message);
            expect(answer.status).toBe(400);
            expect(errorOf(answer).error.code).toBe(JSON_RPC.INVALID_REQUEST);
        }
    });

    it("answers 406 when Accept rules out JSON, and serves the usual MCP Accept header", async () => {
        for (const accept of ["text/event-stream", "text/html", "application/json;q=0"]) {
            const answer = await post(request("ping"), { accept });
            expect(answer.status).toBe(406);
            expect(errorOf(answer).id).toBeNull();
        }
        for (const accept of [
            "application/json, text/event-stream",
            "text/event-stream, application/json;q=0.5",
            "*/*",
            "application/*",
            null,
        ]) {
            expect(resultOf(await post(request("ping"), { accept }))).toEqual({});
        }
        expect(acceptsJson("")).toBe(true);
    });

    it("answers ping with an empty result", async () => {
        const answer = await post(request("ping", undefined, "p-1"));
        expect(answer.body).toEqual({ jsonrpc: "2.0", id: "p-1", result: {} });
    });

    it("answers an unknown method with -32601 and the request's id", async () => {
        for (const method of ["resources/list", "prompts/list", "sampling/createMessage"]) {
            const answer = await post(request(method, undefined, 9));
            expect(answer.status).toBe(200);
            expect(errorOf(answer)).toMatchObject({
                id: 9,
                error: { code: JSON_RPC.METHOD_NOT_FOUND },
            });
        }
    });

    it("refuses params that are not an object", async () => {
        const answer = await post({ jsonrpc: "2.0", id: 1, method: "tools/list", params: [1] });
        expect(errorOf(answer).error.code).toBe(JSON_RPC.INVALID_PARAMS);
    });
});

describe("tools/list", () => {
    async function listedNames(who: McpPrincipal): Promise<string[]> {
        const result = resultOf(await post(request("tools/list"), { principal: who }));
        return (result.tools as { name: string }[]).map(tool => tool.name);
    }

    it("lists everything to a read-write credential whose person may read and upload", async () => {
        expect(await listedNames(principal({ role: "member" }))).toEqual([
            "echo",
            "write",
            "broken",
            "refusing",
        ]);
    });

    it("hides write tools from a read-only credential, however senior the person", async () => {
        expect(
            await listedNames(principal({ role: "owner", scopes: ["launchstack:read"] }))
        ).toEqual(["echo", "broken", "refusing"]);
    });

    it("hides write tools from a person without documents.upload, whatever the credential", async () => {
        expect(await listedNames(principal({ role: "viewer" }))).toEqual([
            "echo",
            "broken",
            "refusing",
        ]);
    });

    it("hides read tools from a credential without the read scope or a person without documents.read", async () => {
        expect(
            await listedNames(principal({ role: "member", scopes: ["launchstack:write"] }))
        ).toEqual(["write"]);
        expect(
            await listedNames(principal({ permissions: ["documents.upload"], role: "custom" }))
        ).toEqual(["write"]);
        expect(await listedNames(principal({ permissions: [], role: "custom" }))).toEqual([]);
    });

    it("describes each tool with name, title, description, schemas and annotations", async () => {
        const result = resultOf(await post(request("tools/list")));
        const [echo] = result.tools as Record<string, unknown>[];
        expect(echo).toEqual({
            name: "echo",
            title: "Echo",
            description: "Repeats text.",
            inputSchema: expect.objectContaining({ type: "object" }),
            outputSchema: expect.objectContaining({ type: "object" }),
            annotations: {
                title: "Echo",
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        });
    });
});

describe("tools/call", () => {
    function call(name: string, args?: unknown, options: PostOptions = {}) {
        return post(
            request("tools/call", { name, ...(args === undefined ? {} : { arguments: args }) }),
            options
        );
    }

    it("returns text content and structuredContent on success", async () => {
        const result = resultOf(await call("echo", { text: "ab", times: 2 }));
        expect(result).toEqual({
            content: [{ type: "text", text: '{"echo":"abab"}' }],
            structuredContent: { echo: "abab" },
        });
    });

    it("answers an unknown tool with -32602", async () => {
        const answer = await call("nope", {});
        expect(errorOf(answer)).toMatchObject({ error: { code: JSON_RPC.INVALID_PARAMS } });
        expect(errorOf(answer).error.message).toContain("nope");
    });

    it("answers a tool this credential may not use with -32602", async () => {
        const answer = await call("write", {}, { principal: principal({ scopes: ["launchstack:read"] }) });
        expect(errorOf(answer)).toMatchObject({ error: { code: JSON_RPC.INVALID_PARAMS } });
        const viewer = await call("write", {}, { principal: principal({ role: "viewer" }) });
        expect(errorOf(viewer).error.code).toBe(JSON_RPC.INVALID_PARAMS);
    });

    it("reports invalid arguments as an isError result the model can act on", async () => {
        for (const args of [{}, { text: "" }, { text: "a", times: 9 }, { text: 5 }]) {
            const result = resultOf(await call("echo", args));
            expect(result.isError).toBe(true);
            const [content] = result.content as { type: string; text: string }[];
            expect(content?.type).toBe("text");
            expect(content?.text).toMatch(/^Invalid arguments for echo: /);
        }
        const missing = resultOf(await call("echo", {}));
        expect((missing.content as { text: string }[])[0]?.text).toContain("text: Required");
    });

    it("treats null optional arguments as absent and missing arguments as {}", async () => {
        expect(resultOf(await call("echo", { text: "x", times: null })).structuredContent).toEqual({
            echo: "x",
        });
        expect(resultOf(await call("write")).structuredContent).toEqual({ written: true });
    });

    it("refuses arguments that are not an object with -32602", async () => {
        const answer = await call("echo", ["x"]);
        expect(errorOf(answer).error.code).toBe(JSON_RPC.INVALID_PARAMS);
    });

    it("turns an unexpected failure into a generic isError result and logs the detail", async () => {
        const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);
        const result = resultOf(await call("broken", {}));
        expect(result.isError).toBe(true);
        const text = (result.content as { text: string }[])[0]?.text ?? "";
        expect(text).toContain("LaunchStack");
        expect(text).not.toContain("secret");
        expect(text).not.toContain("connection refused");
        expect(logged).toHaveBeenCalledWith(
            "[mcp] tool failed",
            expect.objectContaining({ tool: "broken" })
        );
        logged.mockRestore();
    });

    it("passes an McpToolError's message through to the model", async () => {
        const result = resultOf(await call("refusing", {}));
        expect(result).toEqual({
            content: [{ type: "text", text: "That folder does not exist." }],
            isError: true,
        });
    });

    it("charges only rate-limited tools, and a refusal is an isError result with the wait", async () => {
        const charge = jest.fn(
            async (): Promise<ToolCallBudget> => ({ allowed: false, retryAfterSeconds: 42 })
        );
        const refused = resultOf(await call("write", {}, { chargeToolCall: charge }));
        expect(refused.isError).toBe(true);
        expect((refused.content as { text: string }[])[0]?.text).toContain("42 seconds");
        expect(charge).toHaveBeenCalledWith(expect.objectContaining({ name: "write" }));

        charge.mockClear();
        resultOf(await call("echo", { text: "a" }, { chargeToolCall: charge }));
        expect(charge).not.toHaveBeenCalled();
    });
});
