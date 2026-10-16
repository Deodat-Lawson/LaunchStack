/**
 * Better Auth's HTTP surface: sign-in/out/up, session, password reset, and
 * (when configured) social callbacks all live under /api/auth/*. Listed on
 * the middleware public-API allowlist — establishing a session is by
 * definition pre-session.
 *
 * Handlers delegate at request time rather than destructuring
 * toNextJsHandler at module scope, so building the auth instance stays off
 * the build-time import path.
 *
 * The OAuth provider for assistants (see ~/server/mcp) also ships
 * self-service client management for any signed-in user. LaunchStack does
 * not use it — assistants register through dynamic registration or a client
 * metadata document, and admins create clients from Settings through the
 * server API — so those endpoints answer 404 here.
 */
import { auth } from "~/server/auth";

const UNUSED_CLIENT_MANAGEMENT = new Set([
    "/api/auth/oauth2/create-client",
    "/api/auth/oauth2/update-client",
    "/api/auth/oauth2/delete-client",
    "/api/auth/oauth2/client/rotate-secret",
    "/api/auth/oauth2/get-client",
    "/api/auth/oauth2/get-clients",
]);

function notFound(request: Request): Response | null {
    const { pathname } = new URL(request.url);
    return UNUSED_CLIENT_MANAGEMENT.has(pathname.replace(/\/+$/, ""))
        ? Response.json({ error: "not_found" }, { status: 404 })
        : null;
}

export async function GET(request: Request) {
    return notFound(request) ?? auth.handler(request);
}

export async function POST(request: Request) {
    return notFound(request) ?? auth.handler(request);
}
