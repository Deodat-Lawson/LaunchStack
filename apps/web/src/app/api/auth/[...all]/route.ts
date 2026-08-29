/**
 * Better Auth's HTTP surface: sign-in/out/up, session, password reset, and
 * (when configured) social callbacks all live under /api/auth/*. Listed on
 * the middleware public-API allowlist — establishing a session is by
 * definition pre-session.
 *
 * Handlers delegate at request time rather than destructuring
 * toNextJsHandler at module scope, so building the auth instance stays off
 * the build-time import path.
 */
import { auth } from "~/server/auth";

export async function GET(request: Request) {
    return auth.handler(request);
}

export async function POST(request: Request) {
    return auth.handler(request);
}
