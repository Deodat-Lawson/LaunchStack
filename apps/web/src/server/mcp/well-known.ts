/**
 * OAuth discovery documents for MCP clients.
 *
 * An assistant that gets a 401 from /api/mcp follows the challenge to the
 * protected-resource metadata (RFC 9728), reads the authorization server
 * from it, then fetches that server's metadata (RFC 8414 / OIDC discovery).
 * better-auth produces all three, but its handler lives under /api/auth, and
 * these documents must also answer at the origin root:
 *
 *   /.well-known/oauth-protected-resource[/api/mcp]
 *   /.well-known/oauth-authorization-server[/api/auth]
 *   /.well-known/openid-configuration[/api/auth]
 *   /api/auth/.well-known/openid-configuration   (issuer-relative form)
 *
 * Clients probe several of these forms; each route below answers every form
 * it is reachable under. All 404 while the MCP server is off. CORS is open:
 * these are public documents, and browser-based clients (e.g. the MCP
 * Inspector) fetch them cross-origin.
 */
import {
    oauthProviderAuthServerMetadata,
    oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";

import { auth } from "~/server/auth";
import { isMcpEnabled } from "./config";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
};

function notFound(): Response {
    return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
    });
}

export function preflight(): Response {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function authorizationServerMetadata(request: Request): Promise<Response> {
    if (!isMcpEnabled()) return notFound();
    return oauthProviderAuthServerMetadata(auth, { headers: CORS_HEADERS })(request);
}

export async function openIdConfiguration(request: Request): Promise<Response> {
    if (!isMcpEnabled()) return notFound();
    return oauthProviderOpenIdConfigMetadata(auth, { headers: CORS_HEADERS })(request);
}

/**
 * The mcp() plugin serves this document itself from better-auth's request
 * hook, matching on the root well-known path, so the request is handed to
 * the auth handler unchanged.
 */
export async function protectedResourceMetadata(request: Request): Promise<Response> {
    if (!isMcpEnabled()) return notFound();
    const response = await auth.handler(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
    return new Response(response.body, { status: response.status, headers });
}
