/**
 * LaunchStack's MCP server: Streamable HTTP, JSON responses, stateless.
 * Claude, ChatGPT and Gemini (and their CLIs) POST one JSON-RPC message per
 * request with an OAuth access token or an `lsk_` access key.
 *
 * This file is the HTTP shell: who is calling (`authenticateMcpRequest`, whose
 * 401/403 responses carry the RFC 9728 challenge and are returned untouched),
 * how often (per person per workspace, never per IP), and the methods the
 * transport does not serve. The protocol itself is `~/server/mcp/protocol`.
 */
import { NextResponse } from "next/server";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { createRateLimiter, type RateLimitConfig } from "~/lib/rate-limiter";
import { mcpAvailability } from "~/server/mcp/config";
import { MCP_INSTRUCTIONS } from "~/server/mcp/instructions";
import { authenticateMcpRequest, type McpPrincipal } from "~/server/mcp/principal";
import {
    JSON_RPC,
    MAX_MCP_BODY_CHARS,
    errorAnswer,
    handleMcpPost,
    jsonRpcError,
    type McpHttpAnswer,
    type McpTool,
    type ToolCallBudget,
} from "~/server/mcp/protocol";
import { MCP_TOOLS } from "~/server/mcp/tools";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every request a connection makes, whatever the method. */
const MCP_REQUEST_LIMIT: Pick<RateLimitConfig, "maxRequests" | "windowMs"> = {
    maxRequests: 300,
    windowMs: 15 * 60 * 1000,
};

function toResponse(answer: McpHttpAnswer): NextResponse {
    if (answer.body === null) return new NextResponse(null, { status: answer.status });
    return NextResponse.json(answer.body, { status: answer.status });
}

/** The transport serves POST only: no SSE stream to GET, no session to DELETE. */
function methodNotAllowed(): NextResponse {
    const response = toResponse(
        errorAnswer(
            405,
            null,
            JSON_RPC.SERVER_ERROR,
            "Method not allowed: this MCP server takes POST only (no SSE stream, no sessions)"
        )
    );
    response.headers.set("Allow", "POST");
    return response;
}

/** The per-tool budget (save_conversation's), on its own bucket per tool. */
function toolBudget(request: Request, principal: McpPrincipal) {
    return async (tool: McpTool): Promise<ToolCallBudget> => {
        if (!tool.rateLimit) return { allowed: true };
        const check = createRateLimiter({
            ...tool.rateLimit,
            keyGenerator: () => `${principal.rateLimitKey}:tool:${tool.name}`,
        });
        const info = await check(request);
        return info.allowed
            ? { allowed: true }
            : { allowed: false, retryAfterSeconds: info.retryAfter ?? 60 };
    };
}

/**
 * `withRateLimit` answers 429 with the app's usual JSON; MCP clients expect a
 * JSON-RPC error, so the body is swapped and the rate-limit headers kept.
 */
async function asJsonRpcRateLimit(response: NextResponse): Promise<NextResponse> {
    if (response.status !== 429) return response;
    const retryAfter = Number(response.headers.get("Retry-After") ?? "60");
    const replacement = NextResponse.json(
        jsonRpcError(
            null,
            JSON_RPC.SERVER_ERROR,
            `Rate limit exceeded: too many requests from this connection. Try again in ${retryAfter} seconds.`,
            { retryAfter }
        ),
        { status: 429 }
    );
    for (const name of [
        "Retry-After",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
    ]) {
        const value = response.headers.get(name);
        if (value !== null) replacement.headers.set(name, value);
    }
    return replacement;
}

export async function POST(request: Request) {
    const auth = await authenticateMcpRequest(request);
    if (!auth.ok) return auth.response;
    const { principal } = auth;

    const availability = mcpAvailability();
    if (!availability.enabled) {
        return toResponse(
            errorAnswer(404, null, JSON_RPC.SERVER_ERROR, "The MCP server is turned off")
        );
    }

    const response = await withRateLimit(
        request,
        { ...MCP_REQUEST_LIMIT, keyGenerator: () => principal.rateLimitKey },
        async () => {
            const declared = Number(request.headers.get("content-length") ?? "0");
            if (declared > MAX_MCP_BODY_CHARS) {
                return toResponse(
                    errorAnswer(413, null, JSON_RPC.INVALID_REQUEST, "Request body is too large")
                );
            }
            try {
                const body = await request.text();
                const aiUse = { feature: "mcp", userId: principal.ctx.authUserId } as const;
                // Tool calls (and the follow-up a saved conversation queues after
                // the response) use the caller's workspace models.
                const answer = await withWorkspaceChatModels(principal.ctx.companyId, aiUse, () =>
                    handleMcpPost(
                        {
                            body,
                            accept: request.headers.get("accept"),
                            protocolVersion: request.headers.get("mcp-protocol-version"),
                        },
                        {
                            principal,
                            origin: availability.origin,
                            tools: MCP_TOOLS,
                            instructions: MCP_INSTRUCTIONS,
                            chargeToolCall: toolBudget(request, principal),
                        }
                    )
                );
                return toResponse(answer);
            } catch (error) {
                console.error("[mcp] request failed", error);
                return toResponse(
                    errorAnswer(500, null, JSON_RPC.INTERNAL_ERROR, "Internal error")
                );
            }
        }
    );
    return asJsonRpcRateLimit(response);
}

export function GET() {
    return methodNotAllowed();
}

export function DELETE() {
    return methodNotAllowed();
}
