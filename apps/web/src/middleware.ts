import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, count } from "drizzle-orm";
import { users, userCompanyMemberships } from "~/server/db/schema";
import { getSessionFromHeaders } from "~/server/auth";

// Same matching semantics as the Clerk helper this file used to import:
// a literal path, or a "(.*)"-suffixed prefix (which, like path-to-regexp,
// matches the bare prefix and anything after it).
const createRouteMatcher = (patterns: string[]) => {
    const matchers = patterns.map(pattern =>
        pattern.endsWith("(.*)") ? { prefix: pattern.slice(0, -"(.*)".length) } : { exact: pattern }
    );
    return (req: NextRequest) => {
        const pathname = req.nextUrl.pathname;
        return matchers.some(m =>
            "exact" in m ? pathname === m.exact : pathname.startsWith(m.prefix)
        );
    };
};

const shouldLogPerf =
    process.env.NODE_ENV === "development" &&
    (process.env.DEBUG_PERF === "1" || process.env.DEBUG_PERF === "true");
const middlewareUserCacheTtlMs = 10_000;
const middlewareUserCacheMaxSize = 500;

// Routes that require authentication
const isProtectedRoute = createRouteMatcher(["/employer(.*)", "/employee(.*)", "/workspaces(.*)"]);

// Page routes that are always public. API routes are governed by
// isPublicApiRoute below, not by this list.
//
// Note this matcher is currently inert: its only use is the
// `isProtectedRoute(req) && !isPublicRoute(req)` guard below, and
// isProtectedRoute (/employer, /employee, /workspaces) has no overlap with
// either entry — so the condition is `X && true` for every request. It is kept
// because it documents intent and would start doing real work the moment a
// public path is nested under a protected prefix.
//
// /pricing, /deployment, /contact and /about were removed here when the public
// site moved to apps/landing; / was removed because it now redirects.
const isPublicRoute = createRouteMatcher(["/signup", "/signin"]);

// Everything under /api requires a session unless it is listed here.
// Adding a route to this list means "no session required" — the route itself
// is then responsible for whatever authentication it needs.
const isPublicApiRoute = createRouteMatcher([
    // Session establishment is by definition pre-session: sign-in/out/up,
    // password reset, and social callbacks all live here.
    "/api/auth(.*)",
    // Uptime probes.
    "/api/health",
    // Authenticated by provider signature, not by a session.
    "/api/webhooks(.*)",
    // Authenticated by the Inngest signing key.
    "/api/inngest",
    // Pre-auth join UX: an invitation or join link is previewed (workspace
    // name, role) before the person has an account. Neither route consumes
    // anything; accepting requires a session.
    "/api/workspace/invitations/preview",
    "/api/workspace/join-links/preview",
    // CI-only extractor, refuses to run unless OCR_BENCHMARK_ENABLED=true.
    "/api/ocr/benchmark",
    // Prometheus scrapes without a session; the route requires
    // Authorization: Bearer $METRICS_SCRAPE_TOKEN (fail-closed in production).
    "/api/metrics",
    // UploadThing posts its onUploadComplete callback here server-to-server
    // with no session. Every branch of the file router calls auth() itself.
    "/api/uploadthing(.*)",
    // Serves database-backed files to both the browser and the OCR worker;
    // the route accepts a session or a signed per-file token.
    "/api/files(.*)",
    // Machine auth via COLLAB_HUB_SECRET HMAC, not a session.
    "/api/collab/hub(.*)",
    // Slack Events API verifies the signing secret on the raw body.
    "/api/collab/slack/events",
    // Clicked from a mail client, which has no session — the route's own
    // docblock says so. Without this entry the /api/* default-deny below
    // answered every unsubscribe click with a JSON 401, which is also an
    // RFC 8058 one-click compliance problem. The token is an HMAC we issued
    // over (companyId, email), so the route authenticates the request itself.
    "/api/email-pipeline/unsubscribe(.*)",
]);

// Routes where authenticated users should be redirected to their dashboard
const isAuthRedirectRoute = createRouteMatcher(["/", "/signup", "/signin"]);

const isEmployeePath = (pathname: string) => pathname.startsWith("/employee");

// The employee area is gone: one app, and what a person can do is decided by
// their membership's permissions, not by which URL prefix they were sent to.
// Old bookmarks and emails still land on the right page.
const employerTwin = (pathname: string): string => {
    const rest = pathname.slice("/employee".length);
    if (rest === "" || rest === "/" || rest === "/home") return "/employer/documents";
    return `/employer${rest}`;
};

// Lazy singleton for middleware (postgres.js works with standard PostgreSQL)
let _middlewareDb: ReturnType<
    typeof drizzle<{ users: typeof users; userCompanyMemberships: typeof userCompanyMemberships }>
> | null = null;
const getDb = () => {
    if (!_middlewareDb) {
        const client = postgres(process.env.DATABASE_URL!, { max: 5 });
        _middlewareDb = drizzle(client, { schema: { users, userCompanyMemberships } });
    }
    return _middlewareDb;
};

type CachedUserValue = {
    userPk: number;
    membershipCount: number;
    activeCount: number;
    pendingCount: number;
};

const middlewareUserCache = new Map<
    string,
    {
        value: CachedUserValue;
        expiresAt: number;
    }
>();

const getCachedMiddlewareUser = (userId: string): CachedUserValue | undefined => {
    const cached = middlewareUserCache.get(userId);
    if (!cached) {
        return undefined;
    }
    if (cached.expiresAt < Date.now()) {
        middlewareUserCache.delete(userId);
        return undefined;
    }
    return cached.value;
};

const setCachedMiddlewareUser = (userId: string, value: CachedUserValue) => {
    // Evict oldest entry when at capacity to prevent unbounded memory growth
    if (middlewareUserCache.size >= middlewareUserCacheMaxSize) {
        const oldestKey = middlewareUserCache.keys().next().value;
        if (oldestKey) middlewareUserCache.delete(oldestKey);
    }
    middlewareUserCache.set(userId, {
        value,
        expiresAt: Date.now() + middlewareUserCacheTtlMs,
    });
};

export default async function middleware(req: NextRequest) {
    const requestStart = Date.now();
    let dbQueryMs: number | null = null;
    // Fast-path: no session cookie at all means anonymous — skip the session
    // lookup entirely. With a cookie present, getSession answers from the
    // signed cookie cache most of the time and hits Postgres only when the
    // cache has expired.
    let userId: string | null = null;
    if (getSessionCookie(req)) {
        try {
            const session = await getSessionFromHeaders(req.headers);
            userId = session?.user.id ?? null;
        } catch (error) {
            // An unreadable session is treated as signed out, mirroring how
            // the DB-failure catch below degrades instead of erroring.
            console.error("Middleware session read failed:", error);
        }
    }
    const pathname = req.nextUrl.pathname;

    try {
        // API routes: default-deny. Anything not on the allowlist needs a
        // session, answered with a JSON 401 rather than the page-shaped
        // redirect below — a redirect is the wrong shape for an API client.
        // Resolution stops at "is there a session"; company and role checks
        // belong in the handlers, via requireWorkspaceContext.
        if (pathname.startsWith("/api/")) {
            if (!userId && !isPublicApiRoute(req)) {
                return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            }
            return;
        }

        // Static assets: no redirect logic.
        if (pathname.startsWith("/_next/")) {
            return;
        }

        // Anonymous visitor at the root. This origin is the product — the
        // public site lives in apps/landing — so the front door is sign-in.
        //
        // Handled here rather than only in app/page.tsx so the redirect happens
        // BEFORE the database lookup below. A signed-in session plus an
        // unreachable database falls through that lookup's catch, and if the
        // page component were the only redirect, / -> /signin -> (the signin
        // page bounces an active session back) -> / would loop forever.
        if (!userId && pathname === "/") {
            return NextResponse.redirect(new URL("/signin", req.url));
        }

        // Protect routes that require authentication
        if (!userId && isProtectedRoute(req) && !isPublicRoute(req)) {
            return NextResponse.redirect(new URL("/signin", req.url));
        }

        // Route authenticated users based on their DB role + status
        if (userId && (isAuthRedirectRoute(req) || isProtectedRoute(req))) {
            const hasCodeParam = pathname === "/signup" && req.nextUrl.searchParams.has("code");

            try {
                const cachedUser = getCachedMiddlewareUser(userId);
                let existingUser = cachedUser;
                if (cachedUser === undefined) {
                    const db = getDb();
                    const dbStart = Date.now();
                    const [queriedUser] = await db
                        .select({ id: users.id })
                        .from(users)
                        .where(eq(users.userId, userId));
                    if (queriedUser) {
                        const rows = await db
                            .select({
                                status: userCompanyMemberships.status,
                                c: count(userCompanyMemberships.id),
                            })
                            .from(userCompanyMemberships)
                            .where(eq(userCompanyMemberships.userId, BigInt(queriedUser.id)))
                            .groupBy(userCompanyMemberships.status);
                        let membershipCount = 0;
                        let activeCount = 0;
                        let pendingCount = 0;
                        for (const row of rows) {
                            const n = Number(row.c ?? 0);
                            membershipCount += n;
                            if (row.status === "active") activeCount += n;
                            else if (row.status === "pending") pendingCount += n;
                        }
                        existingUser = {
                            userPk: Number(queriedUser.id),
                            membershipCount,
                            activeCount,
                            pendingCount,
                        };
                    }
                    dbQueryMs = Date.now() - dbStart;
                    // Only cache people who can act somewhere; a pending or
                    // suspended state should be re-read on the next request.
                    if (existingUser && existingUser.activeCount > 0) {
                        setCachedMiddlewareUser(userId, existingUser);
                    }
                }

                if (!existingUser) {
                    // Authenticated but no DB row yet – send to signup to finish registration
                    if (pathname !== "/signup") {
                        return NextResponse.redirect(new URL("/signup?from=signin", req.url));
                    }
                } else if (hasCodeParam) {
                    // Let the signup page handle the "already registered" error
                    return;
                } else if (existingUser.activeCount === 0) {
                    // No workspace this person may act in. Awaiting approval
                    // somewhere → the pending page; otherwise the workspace
                    // picker, where they can create one.
                    const holdingPath =
                        existingUser.pendingCount > 0
                            ? "/employer/pending-approval"
                            : "/workspaces";
                    if (pathname !== holdingPath && !pathname.startsWith("/workspaces")) {
                        return NextResponse.redirect(new URL(holdingPath, req.url));
                    }
                } else if (isProtectedRoute(req)) {
                    if (isEmployeePath(pathname)) {
                        return NextResponse.redirect(new URL(employerTwin(pathname), req.url));
                    }
                    if (pathname === "/employer/pending-approval") {
                        return NextResponse.redirect(new URL("/employer/documents", req.url));
                    }
                } else if (isAuthRedirectRoute(req)) {
                    // Signed-in member on / or /signup – send to their dashboard.
                    // Users with 2+ memberships pick a workspace first.
                    if (existingUser.membershipCount >= 2) {
                        return NextResponse.redirect(new URL("/workspaces", req.url));
                    }
                    return NextResponse.redirect(new URL("/employer/documents", req.url));
                }
                // Active member on a protected route – let through
            } catch (error) {
                // If DB query fails, let the request continue without redirect
                console.error("Middleware DB query failed:", error);
            }
        }
    } finally {
        if (shouldLogPerf) {
            const totalMs = Date.now() - requestStart;
            const dbSegment = dbQueryMs == null ? "n/a" : `${dbQueryMs}ms`;
            console.info(`[perf] middleware path=${pathname} total=${totalMs}ms db=${dbSegment}`);
        }
    }
}

// A path missing from the matcher is not a public path — it just means the
// middleware never sees it, so the handler is the only thing standing between
// the caller and the data. /api/upload-local authenticates inline with auth(),
// and /api/files/[id] accepts a session or a signed per-file token.
//
// Note that the upload-local / files exclusion below is a no-op in practice:
// the first pattern already matches any path without one of those static file
// extensions, so both routes do run through this middleware.
export const config = {
    runtime: "nodejs",
    matcher: [
        // Skip Next.js internals and all static files, unless found in search params
        "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
        // Always run for API routes, but exclude file upload routes (body stream conflicts in standalone mode)
        "/(api(?!/upload-local|/files)|trpc)(.*)",
    ],
};
