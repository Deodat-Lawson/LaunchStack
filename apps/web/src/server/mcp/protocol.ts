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
 *
 * Two eras on one endpoint, told apart by how the client opens:
 *
 * - **2026-07-28** (stateless by design): no `initialize`. Every request
 *   names its version in `_meta` and in the `MCP-Protocol-Version` header
 *   (they must agree), its method in `Mcp-Method` and, for `tools/call`, the
 *   tool in `Mcp-Name`. Results carry `resultType`. A tool may answer
 *   `input_required` with a form for the person (multi round-trip requests):
 *   the client asks, then retries the same call with `inputResponses` and the
 *   `requestState` it was given — all plain JSON, no stream.
 * - **2025-03-26 / 2025-06-18 / 2025-11-25**: `initialize` + `ping` +
 *   `tools/*`, exactly as before. These clients are never asked anything.
 */
import type { ZodError, ZodType, ZodTypeDef } from "zod";

import type { Permission } from "~/lib/authz/permissions";
import type { McpPrincipal } from "./principal";

// ---------------------------------------------------------------------------
// Versions and error codes
// ---------------------------------------------------------------------------

/**
 * The stateless revision: every request names its version and the client's
 * capabilities in `_meta`, and results say whether they are complete or need
 * the person's input.
 */
export const MODERN_PROTOCOL_VERSION = "2026-07-28";

/** The handshake revisions, newest first; `initialize` answers with the client's pick when it is here. */
export const LEGACY_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
export type LegacyProtocolVersion = (typeof LEGACY_PROTOCOL_VERSIONS)[number];
export const LATEST_LEGACY_PROTOCOL_VERSION: LegacyProtocolVersion = LEGACY_PROTOCOL_VERSIONS[0];

/** Every revision served, newest first: `server/discover` lists them and version errors name them. */
export const SUPPORTED_PROTOCOL_VERSIONS = [
    MODERN_PROTOCOL_VERSION,
    ...LEGACY_PROTOCOL_VERSIONS,
] as const;
export type ProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];

/** `_meta` keys of the 2026-07-28 revision. */
export const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
export const META_CLIENT_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
export const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

/** How long a client may reuse a `server/discover` or `tools/list` answer. */
export const DISCOVER_TTL_MS = 60 * 60 * 1000;
export const TOOLS_LIST_TTL_MS = 5 * 60 * 1000;

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
    /** 2026-07-28: a required header is missing or disagrees with the body. */
    HEADER_MISMATCH: -32020,
    /** 2026-07-28: the request needs a client capability it did not declare. */
    MISSING_CLIENT_CAPABILITY: -32021,
    /** 2026-07-28: the protocol version is not one this server speaks. */
    UNSUPPORTED_PROTOCOL_VERSION: -32022,
} as const;

export function isSupportedProtocolVersion(value: string): value is ProtocolVersion {
    return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(value);
}

export function isLegacyProtocolVersion(value: string): value is LegacyProtocolVersion {
    return (LEGACY_PROTOCOL_VERSIONS as readonly string[]).includes(value);
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
export type JsonSchema = Record<string, unknown>;

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

/** What the calling client can be asked to show the person (2026-07-28 only). */
export interface McpClientAbilities {
    /** The revision the request came in under. Legacy clients are never asked anything. */
    era: "modern" | "legacy";
    /** The client declared form-mode elicitation for this request. */
    formElicitation: boolean;
}

/** The answers on a multi round-trip retry: the client's input and the state it echoed. */
export interface McpRoundTrip {
    inputResponses: Record<string, unknown>;
    requestState: string | null;
}

export interface McpToolContext {
    principal: McpPrincipal;
    /** The app's origin, for the absolute links tools hand back. */
    origin: string;
    client: McpClientAbilities;
    /** Set when this call is a retry carrying the person's answers. */
    roundTrip: McpRoundTrip | null;
    /** The call's arguments after null-stripping, for binding a `requestState`. */
    rawArguments: Record<string, unknown>;
}

/** A tool's answer: success with text + structured content, or a message for the model. */
export type McpToolAnswer =
    | { ok: true; text: string; structured: Record<string, unknown> }
    | { ok: false; message: string };

/** One thing to ask the person, as a 2026-07-28 `inputRequests` entry. */
export interface McpInputRequest {
    method: "elicitation/create";
    params: Record<string, unknown>;
}

/** The tool needs the person's answers before it can finish (2026-07-28 clients only). */
export interface McpInputRequired {
    inputRequired: {
        inputRequests: Record<string, McpInputRequest>;
        requestState: string;
    };
}

export type McpToolOutcome = McpToolAnswer | McpInputRequired;

export function isInputRequired(outcome: McpToolOutcome): outcome is McpInputRequired {
    return "inputRequired" in outcome;
}

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
    /** The tool definition's `_meta` (e.g. ChatGPT's `openai/fileParams`). */
    meta?: Record<string, unknown>;
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
    readonly meta?: Record<string, unknown>;
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
        meta: spec.meta,
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
    if (tool.meta) described._meta = tool.meta;
    return described;
}

function toolResult(outcome: McpToolAnswer): Record<string, unknown> {
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
    /** The `Mcp-Method` header (2026-07-28), when the client sent one. */
    method?: string | null;
    /** The `Mcp-Name` header (2026-07-28), when the client sent one. */
    name?: string | null;
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

/**
 * An `Mcp-Name` header's value. Clients send names that are not plain ASCII
 * as `=?base64?<base64>?=`; anything else is taken as written.
 */
export function decodeMcpNameHeader(raw: string): string | null {
    const match = /^=\?base64\?([A-Za-z0-9+/=_-]*)\?=$/.exec(raw.trim());
    if (!match) return raw.trim();
    try {
        return Buffer.from(match[1]!, "base64").toString("utf8");
    } catch {
        return null;
    }
}

/** A request's `_meta`, when it has one. */
function requestMeta(message: Record<string, unknown>): Record<string, unknown> | null {
    const params = message.params;
    if (!isPlainObject(params)) return null;
    return isPlainObject(params._meta) ? params._meta : null;
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

    // Which era: `initialize` is the handshake revisions' opening; a request
    // naming 2026-07-28 (header) or carrying its `_meta` version is the
    // stateless revision. Anything else is served as before.
    const metaVersion = requestMeta(message)?.[META_PROTOCOL_VERSION];
    const modern =
        message.method !== "initialize" &&
        (input.protocolVersion === MODERN_PROTOCOL_VERSION || metaVersion !== undefined);

    if (modern) {
        const refusal = checkModernEnvelope(message, input, metaVersion);
        if (refusal) return refusal;
    } else if (
        input.protocolVersion !== null &&
        message.method !== "initialize" &&
        !isLegacyProtocolVersion(input.protocolVersion)
    ) {
        return errorAnswer(
            400,
            salvageId(message),
            JSON_RPC.UNSUPPORTED_PROTOCOL_VERSION,
            `Unsupported MCP-Protocol-Version "${input.protocolVersion}"`,
            { supported: SUPPORTED_PROTOCOL_VERSIONS, requested: input.protocolVersion }
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
        return errorAnswer(
            modern ? 400 : 200,
            id,
            JSON_RPC.INVALID_PARAMS,
            '"params" must be an object'
        );
    }
    const params = isPlainObject(message.params) ? message.params : {};

    return modern
        ? dispatchModern(id, message.method, params, options)
        : dispatchLegacy(id, message.method, params, options);
}

/**
 * The 2026-07-28 envelope: the version in the header and in `_meta` agree
 * and are supported, `Mcp-Method` names the method, and `_meta` carries the
 * client's capabilities. Null when the request may proceed.
 */
function checkModernEnvelope(
    message: Record<string, unknown>,
    input: McpHttpInput,
    metaVersion: unknown
): McpHttpAnswer | null {
    const id = salvageId(message);
    const header = input.protocolVersion;
    if (header === null) {
        return errorAnswer(
            400,
            id,
            JSON_RPC.HEADER_MISMATCH,
            "The MCP-Protocol-Version header is required and must match _meta's protocol version"
        );
    }
    if (typeof metaVersion === "string" && metaVersion !== header) {
        return errorAnswer(
            400,
            id,
            JSON_RPC.HEADER_MISMATCH,
            `MCP-Protocol-Version "${header}" does not match _meta's "${metaVersion}"`
        );
    }
    const requested = typeof metaVersion === "string" ? metaVersion : header;
    if (requested !== MODERN_PROTOCOL_VERSION) {
        return errorAnswer(
            400,
            id,
            JSON_RPC.UNSUPPORTED_PROTOCOL_VERSION,
            `Unsupported protocol version "${requested}"`,
            { supported: SUPPORTED_PROTOCOL_VERSIONS, requested }
        );
    }
    const method = typeof message.method === "string" ? message.method : null;
    if (method !== null && (input.method ?? null) !== method) {
        return errorAnswer(
            400,
            id,
            JSON_RPC.HEADER_MISMATCH,
            `The Mcp-Method header must be "${method}"`
        );
    }
    // Notifications carry no params to check; requests must carry `_meta`.
    if (!("id" in message)) return null;
    const meta = requestMeta(message);
    if (!meta || typeof metaVersion !== "string") {
        return errorAnswer(
            400,
            id,
            JSON_RPC.INVALID_PARAMS,
            `params._meta must carry "${META_PROTOCOL_VERSION}" and "${META_CLIENT_CAPABILITIES}"`
        );
    }
    if (!isPlainObject(meta[META_CLIENT_CAPABILITIES])) {
        return errorAnswer(
            400,
            id,
            JSON_RPC.INVALID_PARAMS,
            `params._meta["${META_CLIENT_CAPABILITIES}"] must be an object`
        );
    }
    if (method === "tools/call") {
        const params = message.params as Record<string, unknown>;
        const headerName = input.name ? decodeMcpNameHeader(input.name) : null;
        if (typeof params.name !== "string" || headerName !== params.name) {
            return errorAnswer(
                400,
                id,
                JSON_RPC.HEADER_MISMATCH,
                "The Mcp-Name header must name the tool being called"
            );
        }
    }
    return null;
}

/** What a 2026-07-28 client declared it can show the person, for this request only. */
function modernAbilities(params: Record<string, unknown>): McpClientAbilities {
    const meta = isPlainObject(params._meta) ? params._meta : {};
    const capabilities = isPlainObject(meta[META_CLIENT_CAPABILITIES])
        ? meta[META_CLIENT_CAPABILITIES]
        : {};
    const elicitation = capabilities.elicitation;
    // `{}` means form mode; otherwise the client lists the modes it supports.
    const form =
        isPlainObject(elicitation) &&
        (Object.keys(elicitation).length === 0 || "form" in elicitation);
    return { era: "modern", formElicitation: form };
}

const LEGACY_ABILITIES: McpClientAbilities = { era: "legacy", formElicitation: false };

function serverInfo() {
    return { name: MCP_SERVER_NAME, title: MCP_SERVER_TITLE, version: MCP_SERVER_VERSION };
}

function listedTools(options: McpServerOptions) {
    return options.tools.filter(tool => toolAllowed(tool, options.principal)).map(describeTool);
}

async function dispatchLegacy(
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
                protocolVersion: isLegacyProtocolVersion(requested)
                    ? requested
                    : LATEST_LEGACY_PROTOCOL_VERSION,
                capabilities: { tools: { listChanged: false } },
                serverInfo: serverInfo(),
                instructions: options.instructions,
            });
        }

        case "ping":
            return ok({});

        case "tools/list":
            return ok({ tools: listedTools(options) });

        case "tools/call":
            return callTool(id, params, options, LEGACY_ABILITIES);

        // `ping` aside, nothing else is declared in `capabilities`, so a client
        // asking for resources, prompts, logging or completions is told so.

        default:
            return errorAnswer(200, id, JSON_RPC.METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
}

async function dispatchModern(
    id: JsonRpcId,
    method: string,
    params: Record<string, unknown>,
    options: McpServerOptions
): Promise<McpHttpAnswer> {
    const complete = (result: Record<string, unknown>): McpHttpAnswer => ({
        status: 200,
        body: { jsonrpc: "2.0", id, result: { resultType: "complete", ...result } },
    });

    switch (method) {
        case "server/discover":
            return complete({
                supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
                capabilities: { tools: {} },
                instructions: options.instructions,
                ttlMs: DISCOVER_TTL_MS,
                cacheScope: "public",
                _meta: { [META_SERVER_INFO]: serverInfo() },
            });

        case "tools/list":
            return complete({
                tools: listedTools(options),
                ttlMs: TOOLS_LIST_TTL_MS,
                // Which tools show depends on the caller's grant and role.
                cacheScope: "private",
            });

        case "tools/call":
            return callTool(id, params, options, modernAbilities(params));

        default:
            // 2026-07-28 has no `initialize`/`ping`; anything not served is a 404.
            return errorAnswer(404, id, JSON_RPC.METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
}

/** The answers on a 2026-07-28 retry, when the call carries any. */
function roundTripOf(params: Record<string, unknown>): McpRoundTrip | null {
    const responses = params.inputResponses;
    const state = params.requestState;
    if (responses === undefined && state === undefined) return null;
    return {
        inputResponses: isPlainObject(responses) ? responses : {},
        requestState: typeof state === "string" ? state : null,
    };
}

async function callTool(
    id: JsonRpcId,
    params: Record<string, unknown>,
    options: McpServerOptions,
    client: McpClientAbilities
): Promise<McpHttpAnswer> {
    const modern = client.era === "modern";
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
    const roundTrip = modern ? roundTripOf(params) : null;

    const answer = (outcome: McpToolAnswer): McpHttpAnswer => {
        const result = toolResult(outcome);
        return {
            status: 200,
            body: {
                jsonrpc: "2.0",
                id,
                result: modern ? { resultType: "complete", ...result } : result,
            },
        };
    };

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
        outcome = await tool.call(rawArguments ?? {}, {
            principal,
            origin: options.origin,
            client,
            roundTrip,
            rawArguments: (withoutNullFields(rawArguments ?? {}) ?? {}) as Record<string, unknown>,
        });
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

    if (isInputRequired(outcome) && !(modern && client.formElicitation)) {
        // A tool only asks a client that declared it can show a form; one
        // that asks anyway is a bug, reported as such rather than sent on.
        console.error("[mcp] tool asked a client that cannot be asked", { tool: tool.name });
        outcome = {
            ok: false,
            message: `${tool.title} failed because of a problem on LaunchStack's side.`,
        };
    }

    console.info("[mcp] tools/call", {
        tool: tool.name,
        client: principal.label,
        family: principal.family,
        credential: principal.credential.kind,
        era: client.era,
        result: isInputRequired(outcome) ? "input_required" : outcome.ok ? "ok" : "error",
        roundTrip: roundTrip !== null,
        ms: Date.now() - started,
    });

    if (isInputRequired(outcome)) {
        return {
            status: 200,
            body: {
                jsonrpc: "2.0",
                id,
                result: {
                    resultType: "input_required",
                    inputRequests: outcome.inputRequired.inputRequests,
                    requestState: outcome.inputRequired.requestState,
                },
            },
        };
    }
    return answer(outcome);
}
