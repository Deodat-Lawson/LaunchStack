/**
 * LaunchStack's MCP server, the protocol half: JSON-RPC 2.0 over MCP's
 * Streamable HTTP transport, written against the specification (revisions
 * 2025-03-26, 2025-06-18, 2025-11-25 and 2026-07-28) without an SDK.
 *
 * Pure: it takes the POST body and two request headers, the caller and a tool
 * registry, and answers with an HTTP status and a JSON-RPC body (or none). The
 * route (app/api/mcp/route.ts) owns HTTP methods, authentication and rate
 * limits, so everything here is testable without HTTP.
 *
 * Deliberate choices, all allowed by the transport:
 *
 * - JSON responses only. Every request is answered with one
 *   `application/json` body; the server never opens an SSE stream, so it
 *   never sends server-initiated requests or notifications.
 * - Stateless. No `Mcp-Session-Id` is issued, and one a client sends is
 *   ignored: every request carries its own credential, and `initialize` only
 *   negotiates a version and describes the server.
 * - One message per POST. A JSON array (a 2025-03-26 batch) is refused with
 *   -32600; later revisions removed batching.
 */
import type { ZodError, ZodType, ZodTypeDef } from "zod";

import type { Permission } from "~/lib/authz/permissions";
import type { McpPrincipal } from "./principal";

// ---------------------------------------------------------------------------
// Versions and error codes
// ---------------------------------------------------------------------------

/** Newest first; `initialize` answers with the client's pick when it is here. */
export const SUPPORTED_PROTOCOL_VERSIONS = [
    "2026-07-28",
    "2025-11-25",
    "2025-06-18",
    "2025-03-26",
] as const;
export type ProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];
export const LATEST_PROTOCOL_VERSION: ProtocolVersion = SUPPORTED_PROTOCOL_VERSIONS[0];

export const MCP_SERVER_NAME = "launchstack";
export const MCP_SERVER_TITLE = "LaunchStack";
export const MCP_SERVER_VERSION = "1.0.0";

/** Longer bodies (in characters) are refused before parsing; a 2,000-turn transcript fits. */
export const MAX_MCP_BODY_CHARS = 8 * 1024 * 1024;

export const JSON_RPC = {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603,
    /** Implementation-defined server error (transport-level refusals). */
    SERVER_ERROR: -32000,
} as const;

export function isSupportedProtocolVersion(value: string): value is ProtocolVersion {
    return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// JSON-RPC shapes
// ---------------------------------------------------------------------------

export type JsonRpcId = string | number;

export interface JsonRpcErrorObject {
    code: number;
    message: string;
    data?: unknown;
}

export type JsonRpcResponse =
    | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
    | { jsonrpc: "2.0"; id: JsonRpcId | null; error: JsonRpcErrorObject };

/** What the route turns into a Response. A null body means "no body" (202). */
export interface McpHttpAnswer {
    status: number;
    body: JsonRpcResponse | null;
}

export function jsonRpcError(
    id: JsonRpcId | null,
    code: number,
    message: string,
    data?: unknown
): JsonRpcResponse {
    const error: JsonRpcErrorObject =
        data === undefined ? { code, message } : { code, message, data };
    return { jsonrpc: "2.0", id, error };
}

export function errorAnswer(
    status: number,
    id: JsonRpcId | null,
    code: number,
    message: string,
    data?: unknown
): McpHttpAnswer {
    return { status, body: jsonRpcError(id, code, message, data) };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/** A hand-written JSON Schema object (no `$ref`, no `$schema`: every client reads it). */
export type JsonSchema = { [key: string]: unknown };

export interface McpToolAnnotations {
    title?: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
}

export interface McpToolRateLimit {
    maxRequests: number;
    windowMs: number;
}

export interface McpToolContext {
    principal: McpPrincipal;
    /** The app's origin, for the absolute links tools hand back. */
    origin: string;
}

/** A tool's answer: success with text + structured content, or a message for the model. */
export type McpToolOutcome =
    | { ok: true; text: string; structured: Record<string, unknown> }
    | { ok: false; message: string };

/** What a credential and a membership must both allow before a tool is listed or run. */
export interface McpToolRequirement {
    /** OAuth / access-key scope the credential must carry. */
    scope: string;
    /** Workspace permission the person must hold right now. */
    permission: Permission;
}

export interface McpToolSpec<Args> {
    name: string;
    title: string;
    /** Written for a model: when to use it and what it returns. */
    description: string;
    inputSchema: JsonSchema;
    outputSchema?: JsonSchema;
    annotations: Omit<McpToolAnnotations, "title">;
    requires: McpToolRequirement;
    /** A tighter, per-tool budget on top of the server-wide one. */
    rateLimit?: McpToolRateLimit;
    /** Validates (and normalises) the arguments; mirrors `inputSchema`. */
    args: ZodType<Args, ZodTypeDef, unknown>;
    run(args: Args, context: McpToolContext): Promise<McpToolOutcome>;
}

/** A registered tool, its argument type erased behind `call`. */
export interface McpTool {
    readonly name: string;
    readonly title: string;
    readonly description: string;
    readonly inputSchema: JsonSchema;
    readonly outputSchema?: JsonSchema;
    readonly annotations: McpToolAnnotations;
    readonly requires: McpToolRequirement;
    readonly rateLimit?: McpToolRateLimit;
    /** Validates the raw `arguments`, then runs the tool. */
    call(rawArguments: unknown, context: McpToolContext): Promise<McpToolOutcome>;
}

/**
 * An expected failure inside a tool whose message is written for the model
 * ("that folder does not exist"). Anything else a tool throws is logged and
 * reported with a generic message — never a stack trace.
 */
export class McpToolError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "McpToolError";
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Drops null-valued keys at every depth. Strict-mode function calling
 * (ChatGPT) sends `null` for optional parameters it is not using; an absent
 * key is what those parameters mean.
 */
export function withoutNullFields(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(withoutNullFields);
    if (!isPlainObject(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (entry === null) continue;
        out[key] = withoutNullFields(entry);
    }
    return out;
}

/** "query: Required; limit: Number must be less than or equal to 20". */
export function describeArgumentIssues(error: ZodError): string {
    const parts = error.issues.slice(0, 8).map(issue => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "arguments";
        return `${path}: ${issue.message}`;
    });
    if (error.issues.length > 8) parts.push(`and ${error.issues.length - 8} more`);
    return parts.join("; ");
}

export function defineTool<Args>(spec: McpToolSpec<Args>): McpTool {
    return {
        name: spec.name,
        title: spec.title,
        description: spec.description,
        inputSchema: spec.inputSchema,
        outputSchema: spec.outputSchema,
        annotations: { title: spec.title, ...spec.annotations },
        requires: spec.requires,
        rateLimit: spec.rateLimit,
        async call(rawArguments, context) {
            const parsed = spec.args.safeParse(withoutNullFields(rawArguments ?? {}));
            if (!parsed.success) {
                return {
                    ok: false,
                    message:
                        `Invalid arguments for ${spec.name}: ${describeArgumentIssues(parsed.error)}. ` +
                        `Check the tool's input schema and call it again.`,
                };
            }
            return spec.run(parsed.data, context);
        },
    };
}

/** Whether this credential, for this person, may see and run the tool. */
export function toolAllowed(tool: McpTool, principal: McpPrincipal): boolean {
    return principal.scopes.has(tool.requires.scope) && principal.ctx.can(tool.requires.permission);
}

function describeTool(tool: McpTool): Record<string, unknown> {
    const described: Record<string, unknown> = {
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
    };
    if (tool.outputSchema) described.outputSchema = tool.outputSchema;
    return described;
}

function toolResult(outcome: McpToolOutcome): Record<string, unknown> {
    if (outcome.ok) {
        return {
            content: [{ type: "text", text: outcome.text }],
            structuredContent: outcome.structured,
        };
    }
    return { content: [{ type: "text", text: outcome.message }], isError: true };
}

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

export type ToolCallBudget = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface McpServerOptions {
    principal: McpPrincipal;
    origin: string;
    tools: readonly McpTool[];
    instructions: string;
    /**
     * Consulted before a tool with a `rateLimit` runs. A refusal comes back to
     * the model as an `isError` result it can relay, not as a transport error.
     */
    chargeToolCall?: (tool: McpTool) => Promise<ToolCallBudget>;
}

export interface McpHttpInput {
    /** The raw POST body. */
    body: string;
    /** The `Accept` header, when the client sent one. */
    accept: string | null;
    /** The `MCP-Protocol-Version` header, when the client sent one. */
    protocolVersion: string | null;
}

/**
 * Whether an Accept header admits an `application/json` answer. Clients send
 * `application/json, text/event-stream`; a header that rules JSON out (only
 * `text/event-stream`, or `q=0`) cannot be served by a JSON-only server.
 */
export function acceptsJson(accept: string | null): boolean {
    if (accept === null || accept.trim() === "") return true;
    for (const range of accept.split(",")) {
        const [rawType, ...params] = range.split(";");
        const type = rawType?.trim().toLowerCase() ?? "";
        if (type !== "application/json" && type !== "application/*" && type !== "*/*") continue;
        const q = params
            .map(p => p.trim().toLowerCase())
            .find(p => p.startsWith("q="))
            ?.slice(2);
        if (q === undefined || Number(q) > 0) return true;
    }
    return false;
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
    return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

/** The id to answer with when a message is malformed: its own, if it has a usable one. */
function salvageId(message: Record<string, unknown>): JsonRpcId | null {
    return isJsonRpcId(message.id) ? message.id : null;
}

/** POST /api/mcp, minus HTTP: one JSON-RPC message in, one answer out. */
export async function handleMcpPost(
    input: McpHttpInput,
    options: McpServerOptions
): Promise<McpHttpAnswer> {
    if (!acceptsJson(input.accept)) {
        return errorAnswer(
            406,
            null,
            JSON_RPC.SERVER_ERROR,
            "Not Acceptable: this server answers with application/json only"
        );
    }

    if (input.body.length > MAX_MCP_BODY_CHARS) {
        return errorAnswer(413, null, JSON_RPC.INVALID_REQUEST, "Request body is too large");
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(input.body);
    } catch {
        return errorAnswer(400, null, JSON_RPC.PARSE_ERROR, "Parse error: the body is not JSON");
    }

    if (Array.isArray(parsed)) {
        return errorAnswer(
            400,
            null,
            JSON_RPC.INVALID_REQUEST,
            "Batch requests are not supported; send one JSON-RPC message per request"
        );
    }
    if (!isPlainObject(parsed)) {
        return errorAnswer(
            400,
            null,
            JSON_RPC.INVALID_REQUEST,
            "Invalid Request: expected a JSON-RPC message"
        );
    }
    const message = parsed;

    if (input.protocolVersion !== null && !isSupportedProtocolVersion(input.protocolVersion)) {
        return errorAnswer(
            400,
            salvageId(message),
            JSON_RPC.INVALID_REQUEST,
            `Unsupported MCP-Protocol-Version "${input.protocolVersion}"`,
            { supported: SUPPORTED_PROTOCOL_VERSIONS }
        );
    }

    if (message.jsonrpc !== "2.0") {
        return errorAnswer(
            400,
            salvageId(message),
            JSON_RPC.INVALID_REQUEST,
            'Invalid Request: "jsonrpc" must be "2.0"'
        );
    }

    const hasId = "id" in message;
    if (!("method" in message)) {
        // A response to a server request. This server never sends any, so there
        // is nothing to match it to; it is accepted and dropped.
        if (hasId && ("result" in message || "error" in message)) {
            return { status: 202, body: null };
        }
        return errorAnswer(
            400,
            salvageId(message),
            JSON_RPC.INVALID_REQUEST,
            "Invalid Request: expected a method"
        );
    }

    if (typeof message.method !== "string" || message.method === "") {
        return errorAnswer(
            400,
            salvageId(message),
            JSON_RPC.INVALID_REQUEST,
            'Invalid Request: "method" must be a string'
        );
    }

    // A notification (no id): accepted, never answered. `notifications/initialized`
    // and `notifications/cancelled` need no action from a stateless server.
    if (!hasId) return { status: 202, body: null };

    if (!isJsonRpcId(message.id)) {
        return errorAnswer(
            400,
            null,
            JSON_RPC.INVALID_REQUEST,
            'Invalid Request: "id" must be a string or a number'
        );
    }
    const id = message.id;

    if ("params" in message && message.params !== undefined && !isPlainObject(message.params)) {
        return errorAnswer(200, id, JSON_RPC.INVALID_PARAMS, '"params" must be an object');
    }
    const params = isPlainObject(message.params) ? message.params : {};

    return dispatchRequest(id, message.method, params, options);
}

async function dispatchRequest(
    id: JsonRpcId,
    method: string,
    params: Record<string, unknown>,
    options: McpServerOptions
): Promise<McpHttpAnswer> {
    const ok = (result: unknown): McpHttpAnswer => ({
        status: 200,
        body: { jsonrpc: "2.0", id, result },
    });

    switch (method) {
        case "initialize": {
            const requested = params.protocolVersion;
            if (typeof requested !== "string") {
                return errorAnswer(
                    200,
                    id,
                    JSON_RPC.INVALID_PARAMS,
                    "initialize needs params.protocolVersion"
                );
            }
            return ok({
                protocolVersion: isSupportedProtocolVersion(requested)
                    ? requested
                    : LATEST_PROTOCOL_VERSION,
                capabilities: { tools: { listChanged: false } },
                serverInfo: {
                    name: MCP_SERVER_NAME,
                    title: MCP_SERVER_TITLE,
                    version: MCP_SERVER_VERSION,
                },
                instructions: options.instructions,
            });
        }

        case "ping":
            return ok({});

        case "tools/list":
            return ok({
                tools: options.tools
                    .filter(tool => toolAllowed(tool, options.principal))
                    .map(describeTool),
            });

        case "tools/call":
            return callTool(id, params, options);

        // `ping` aside, nothing else is declared in `capabilities`, so a client
        // asking for resources, prompts, logging or completions is told so.

        default:
            return errorAnswer(200, id, JSON_RPC.METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
}

async function callTool(
    id: JsonRpcId,
    params: Record<string, unknown>,
    options: McpServerOptions
): Promise<McpHttpAnswer> {
    const name = params.name;
    if (typeof name !== "string" || name === "") {
        return errorAnswer(200, id, JSON_RPC.INVALID_PARAMS, "tools/call needs params.name");
    }
    const tool = options.tools.find(candidate => candidate.name === name);
    if (!tool) {
        return errorAnswer(200, id, JSON_RPC.INVALID_PARAMS, `Unknown tool: ${name}`);
    }
    const { principal } = options;
    if (!toolAllowed(tool, principal)) {
        return errorAnswer(
            200,
            id,
            JSON_RPC.INVALID_PARAMS,
            `Tool not available to this connection: ${name} (it needs the ${tool.requires.scope} scope and the ${tool.requires.permission} permission in this workspace)`
        );
    }
    const rawArguments = params.arguments;
    if (rawArguments !== undefined && rawArguments !== null && !isPlainObject(rawArguments)) {
        return errorAnswer(200, id, JSON_RPC.INVALID_PARAMS, "params.arguments must be an object");
    }

    const answer = (outcome: McpToolOutcome): McpHttpAnswer => ({
        status: 200,
        body: { jsonrpc: "2.0", id, result: toolResult(outcome) },
    });

    if (tool.rateLimit && options.chargeToolCall) {
        const budget = await options.chargeToolCall(tool);
        if (!budget.allowed) {
            return answer({
                ok: false,
                message: `Too many ${tool.name} calls from this connection. Try again in ${budget.retryAfterSeconds} seconds.`,
            });
        }
    }

    const started = Date.now();
    let outcome: McpToolOutcome;
    try {
        outcome = await tool.call(rawArguments ?? {}, { principal, origin: options.origin });
    } catch (error) {
        if (error instanceof McpToolError) {
            outcome = { ok: false, message: error.message };
        } else {
            console.error("[mcp] tool failed", {
                tool: tool.name,
                client: principal.label,
                companyId: principal.ctx.companyId.toString(),
                error,
            });
            outcome = {
                ok: false,
                message: `${tool.title} failed because of a problem on LaunchStack's side. Try again in a moment; if it keeps failing, tell the person LaunchStack is having trouble.`,
            };
        }
    }
    console.info("[mcp] tools/call", {
        tool: tool.name,
        client: principal.label,
        family: principal.family,
        credential: principal.credential.kind,
        ok: outcome.ok,
        ms: Date.now() - started,
    });
    return answer(outcome);
}
