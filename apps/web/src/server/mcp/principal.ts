/**
 * Who is calling the MCP server: one person, in one workspace, with the
 * scopes their credential carries and the permissions their membership has
 * right now.
 *
 * Two credentials, told apart by prefix:
 *
 * - `lsk_…` — an access key from Settings (access-keys.ts).
 * - anything else — an OAuth access token: a JWT from this app's own OAuth
 *   provider, verified by better-auth's resource-server check (signature,
 *   issuer, audience = this server, expiry, DPoP when bound). It carries the
 *   workspace in a claim; the consent must still exist (Settings › Revoke
 *   ends it immediately) and the membership must still be active.
 *
 * Failures answer the way MCP clients expect: 401 with an RFC 9728
 * `WWW-Authenticate` challenge pointing at the protected-resource metadata
 * (that is how an assistant knows to start the OAuth flow), and 403 for a
 * valid credential whose person is no longer in the workspace.
 */
import { createMcpProtectedRequestHandler } from "@better-auth/mcp";
import { createResourceServerChallenge } from "@better-auth/oauth-provider";
import { APIError } from "better-auth/api";
import { createDpopReplayStore } from "better-auth/oauth2";

import { auth } from "~/server/auth";
import { resolveMemberContext, type WorkspaceContext } from "~/lib/require-workspace-context";
import type { AssistantClient } from "~/server/db/schema/mcp";
import { verifyAccessKey, looksLikeAccessKey } from "./access-keys";
import { MCP_SCOPE_READ, MCP_WORKSPACE_CLAIM, filled, mcpAvailability } from "./config";
import { assistantFamily, clientDisplayName, hasLiveConsent } from "./connections";

/** jose's JWTPayload, by way of better-auth (jose is not a direct dependency). */
type JWTPayload = Parameters<Parameters<typeof createMcpProtectedRequestHandler>[1]>[1];

export type McpCredential = { kind: "oauth"; clientId: string } | { kind: "key"; keyId: number };

export interface McpPrincipal {
    ctx: WorkspaceContext;
    /** Scopes the credential carries (`launchstack:read`, `launchstack:write`, …). */
    scopes: ReadonlySet<string>;
    credential: McpCredential;
    /** What to call the caller in labels: the OAuth client's name or the key's name. */
    label: string;
    /** Best guess at the assistant family, from the label. Labels only. */
    family: AssistantClient;
    /** Rate-limit bucket: per person per workspace, never per IP. */
    rateLimitKey: string;
}

export type McpAuthResult =
    | { ok: true; principal: McpPrincipal }
    | { ok: false; response: Response };

function jsonRpcError(status: number, message: string, headers?: HeadersInit): Response {
    const h = new Headers(headers);
    h.set("Content-Type", "application/json");
    return new Response(
        JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }),
        { status, headers: h }
    );
}

/** 401 + RFC 9728 challenge, the same shape better-auth emits for a bad JWT. */
function unauthorized(resource: string, message: string): Response {
    const challenge = createResourceServerChallenge(
        new APIError("UNAUTHORIZED", { message }),
        resource,
        { challengeScopes: [MCP_SCOPE_READ] }
    );
    return jsonRpcError(401, message, challenge?.headers);
}

function forbidden(message: string): Response {
    return jsonRpcError(403, message);
}

function bearerToken(request: Request): string | null {
    const header = request.headers.get("authorization");
    if (!header) return null;
    const match = /^(?:Bearer|DPoP)\s+(.+)$/i.exec(header.trim());
    return filled(match?.[1]) ?? null;
}

async function verifyOAuthToken(
    request: Request,
    resource: string
): Promise<{ claims: JWTPayload } | { response: Response }> {
    const context = await auth.$context;
    let claims: JWTPayload | null = null;
    const check = createMcpProtectedRequestHandler(
        {
            // better-auth's baseURL includes its /api/auth base path; that is
            // the issuer its tokens carry.
            issuer: context.baseURL,
            audience: resource,
            jwksUrl: filled(process.env.MCP_JWKS_URL) ?? `${context.baseURL}/jwks`,
            challengeScopes: [MCP_SCOPE_READ],
            dpop: { replayStore: createDpopReplayStore(context.internalAdapter) },
        },
        (_request, verified) => {
            claims = verified;
            return new Response(null, { status: 204 });
        }
    );
    const response = await check(request);
    return claims ? { claims } : { response };
}

function scopeSet(claims: JWTPayload): Set<string> {
    const raw = claims.scope;
    if (typeof raw === "string") return new Set(raw.split(/\s+/).filter(Boolean));
    if (Array.isArray(raw)) return new Set(raw.filter((s): s is string => typeof s === "string"));
    return new Set();
}

export async function authenticateMcpRequest(request: Request): Promise<McpAuthResult> {
    const availability = mcpAvailability();
    if (!availability.enabled) {
        return { ok: false, response: jsonRpcError(404, "The MCP server is turned off") };
    }
    const { resource } = availability;
    const token = bearerToken(request);

    if (token && looksLikeAccessKey(token)) {
        const key = await verifyAccessKey(token);
        if (!key)
            return { ok: false, response: unauthorized(resource, "Unknown or revoked access key") };
        const ctx = await resolveMemberContext(key.authUserId, key.companyId);
        if (!ctx) {
            return {
                ok: false,
                response: forbidden("This access key's owner is no longer in the workspace"),
            };
        }
        return {
            ok: true,
            principal: {
                ctx,
                scopes: new Set(key.scopes),
                credential: { kind: "key", keyId: key.keyId },
                label: key.keyName,
                family: assistantFamily(key.keyName),
                rateLimitKey: `mcp:${key.authUserId}:${key.companyId}`,
            },
        };
    }

    const verified = await verifyOAuthToken(request, resource);
    if ("response" in verified) return { ok: false, response: verified.response };
    const { claims } = verified;

    const workspace = claims[MCP_WORKSPACE_CLAIM];
    const sub = claims.sub;
    const clientId =
        (typeof claims.azp === "string" && claims.azp) ||
        (typeof claims.client_id === "string" && claims.client_id) ||
        null;
    if (typeof workspace !== "string" || !/^\d+$/.test(workspace) || !sub || !clientId) {
        return {
            ok: false,
            response: unauthorized(resource, "This token is not bound to a LaunchStack workspace"),
        };
    }
    const companyId = BigInt(workspace);
    if (!(await hasLiveConsent({ authUserId: sub, companyId, clientId }))) {
        return {
            ok: false,
            response: unauthorized(resource, "This connection was revoked; connect again"),
        };
    }
    const ctx = await resolveMemberContext(sub, companyId);
    if (!ctx) {
        return { ok: false, response: forbidden("You are no longer a member of this workspace") };
    }
    const label = (await clientDisplayName(clientId)) ?? "Assistant";
    return {
        ok: true,
        principal: {
            ctx,
            scopes: scopeSet(claims),
            credential: { kind: "oauth", clientId },
            label,
            family: assistantFamily(label),
            rateLimitKey: `mcp:${sub}:${companyId}`,
        },
    };
}
