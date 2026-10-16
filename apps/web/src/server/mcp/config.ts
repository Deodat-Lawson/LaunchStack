/**
 * Where the MCP server lives and whether it is on.
 *
 * Read from process.env directly, not ~/env: the auth module (which builds
 * the OAuth provider from this) sits in the middleware bundle.
 *
 * The resource URL is the token audience. OAuth for assistants requires it to
 * be HTTPS, or plain HTTP on a loopback host for local development; a
 * self-hosted instance on a LAN address over HTTP gets the MCP server switched
 * off with a warning instead of a better-auth startup error that would take
 * sign-in down with it.
 */

const MCP_PATH = "/api/mcp";

export const MCP_SCOPE_READ = "launchstack:read";
export const MCP_SCOPE_WRITE = "launchstack:write";
export const MCP_RESOURCE_SCOPES = [MCP_SCOPE_READ, MCP_SCOPE_WRITE] as const;

/** Scopes the OAuth provider offers. ChatGPT requires offline_access. */
export const MCP_OAUTH_SCOPES = [
    "openid",
    "profile",
    "email",
    "offline_access",
    ...MCP_RESOURCE_SCOPES,
] as const;

/** JWT claim that carries the workspace (company id) a token is bound to. */
export const MCP_WORKSPACE_CLAIM = "launchstack_workspace";

/** Access keys start with this, which is also how the route tells them apart. */
export const ACCESS_KEY_PREFIX = "lsk_";

/** The same loopback set @better-auth/mcp accepts for an HTTP resource. */
function isLoopbackHost(hostname: string): boolean {
    return hostname === "localhost" || hostname === "[::1]" || /^127(\.\d{1,3}){3}$/.test(hostname);
}

function appOrigin(): string | null {
    const raw = process.env.BETTER_AUTH_URL?.trim();
    if (!raw) return null;
    try {
        return new URL(raw).origin;
    } catch {
        return null;
    }
}

export type McpAvailability =
    | { enabled: true; origin: string; resource: string }
    | { enabled: false; reason: "disabled" | "no-base-url" | "insecure-base-url" };

let warned = false;

export function mcpAvailability(): McpAvailability {
    if (process.env.MCP_SERVER_ENABLED?.trim().toLowerCase() === "false") {
        return { enabled: false, reason: "disabled" };
    }
    const origin = appOrigin();
    if (!origin) return { enabled: false, reason: "no-base-url" };
    const url = new URL(origin);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
        if (!warned) {
            warned = true;
            console.warn(
                `[mcp] MCP server off: BETTER_AUTH_URL (${origin}) must be HTTPS, or HTTP on localhost, for assistants to sign in.`
            );
        }
        return { enabled: false, reason: "insecure-base-url" };
    }
    return { enabled: true, origin, resource: `${origin}${MCP_PATH}` };
}

export function isMcpEnabled(): boolean {
    return mcpAvailability().enabled;
}
