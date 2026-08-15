import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, count } from "drizzle-orm";
import { users, userCompanyMemberships } from "~/server/db/schema";

const shouldLogPerf =
    process.env.NODE_ENV === "development" &&
    (process.env.DEBUG_PERF === "1" || process.env.DEBUG_PERF === "true");
const middlewareUserCacheTtlMs = 10_000;
const middlewareUserCacheMaxSize = 500;

// Routes that require authentication
const isProtectedRoute = createRouteMatcher([
    '/employer(.*)',
    '/employee(.*)',
    '/workspaces(.*)',
]);

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
const isPublicRoute = createRouteMatcher([
    '/signup',
    '/signin',
]);

// Everything under /api requires a Clerk session unless it is listed here.
// Adding a route to this list means "no session required" — the route itself
// is then responsible for whatever authentication it needs.
const isPublicApiRoute = createRouteMatcher([
    // Uptime probes.
    '/api/health',
    // Authenticated by provider signature, not by a Clerk session.
    '/api/webhooks(.*)',
    // Authenticated by the Inngest signing key.
    '/api/inngest',
    // Pre-auth signup UX: the code is validated before the user has an account.
    '/api/invite-codes/validate',
    // CI-only extractor, refuses to run unless OCR_BENCHMARK_ENABLED=true.
    '/api/ocr/benchmark',
    // Prometheus scrapes without a Clerk session; the route requires
    // Authorization: Bearer $METRICS_SCRAPE_TOKEN (fail-closed in production).
    '/api/metrics',
    // UploadThing posts its onUploadComplete callback here server-to-server
    // with no session. Every branch of the file router calls auth() itself.
    '/api/uploadthing(.*)',
    // Serves database-backed files to both the browser and the OCR worker;
    // the route accepts a Clerk session or a signed per-file token.
    '/api/files(.*)',
    // Machine auth via COLLAB_HUB_SECRET HMAC, not a Clerk session.
    '/api/collab/hub(.*)',
    // Slack Events API verifies the signing secret on the raw body.
    '/api/collab/slack/events',
]);

// Routes where authenticated users should be redirected to their dashboard
const isAuthRedirectRoute = createRouteMatcher([
    '/',
    '/signup',
    '/signin',
]);

const isEmployerPath = (pathname: string) => pathname.startsWith("/employer");
const isEmployeePath = (pathname: string) => pathname.startsWith("/employee");

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
    role: string;
    status: string;
    membershipCount: number;
    userPk: number;
};

const middlewareUserCache = new Map<string, {
    value: CachedUserValue;
    expiresAt: number;
}>();

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

export default clerkMiddleware(async (auth, req) => {
    const requestStart = Date.now();
    let dbQueryMs: number | null = null;
    const { userId } = await auth();
    const pathname = req.nextUrl.pathname;

    try {
        // API routes: default-deny. Anything not on the allowlist needs a
        // session. auth.protect() is deliberately not used here — it answers
        // with a 404 page (or a redirect to /signin), which is the wrong shape
        // for an API client. Resolution stops at "is there a session"; company
        // and role checks belong in the handlers, via requireWorkspaceContext.
        if (pathname.startsWith('/api/')) {
            if (!userId && !isPublicApiRoute(req)) {
                return NextResponse.json(
                    { error: "Unauthorized" },
                    { status: 401 },
                );
            }
            return;
        }

        // Static assets: no redirect logic.
        if (pathname.startsWith('/_next/')) {
            return;
        }

        // Anonymous visitor at the root. This origin is the product — the
        // public site lives in apps/landing — so the front door is sign-in.
        //
        // Handled here rather than only in app/page.tsx so the redirect happens
        // BEFORE the database lookup below. A signed-in session plus an
        // unreachable database falls through that lookup's catch, and if the
        // page component were the only redirect, / -> /signin -> (Clerk honours
        // forceRedirectUrl on an active session) -> / would loop forever.
        if (!userId && pathname === '/') {
            return NextResponse.redirect(new URL('/signin', req.url));
        }

        // Protect routes that require authentication
        if (isProtectedRoute(req) && !isPublicRoute(req)) {
            await auth.protect({ unauthenticatedUrl: new URL('/signin', req.url).toString() });
        }

        // Route authenticated users based on their DB role + status
        if (userId && (isAuthRedirectRoute(req) || isProtectedRoute(req))) {
            const hasCodeParam = pathname === '/signup' && req.nextUrl.searchParams.has('code');

            try {
                const cachedUser = getCachedMiddlewareUser(userId);
                let existingUser = cachedUser;
                if (cachedUser === undefined) {
                    const db = getDb();
                    const dbStart = Date.now();
                    const [queriedUser] = await db
                        .select({
                            id: users.id,
                            role: users.role,
                            status: users.status,
                        })
                        .from(users)
                        .where(eq(users.userId, userId));
                    if (queriedUser) {
                        const [{ c: membershipCount } = { c: 0 }] = await db
                            .select({ c: count(userCompanyMemberships.id) })
                            .from(userCompanyMemberships)
                            .where(eq(userCompanyMemberships.userId, BigInt(queriedUser.id)));
                        existingUser = {
                            role: queriedUser.role,
                            status: queriedUser.status,
                            membershipCount: Number(membershipCount ?? 0),
                            userPk: Number(queriedUser.id),
                        };
                    }
                    dbQueryMs = Date.now() - dbStart;
                    // Only cache verified users to avoid stale pending/signup states.
                    if (existingUser && existingUser.status === "verified") {
                        setCachedMiddlewareUser(userId, existingUser);
                    }
                }

                if (!existingUser) {
                    // User exists in Clerk but not in DB – send to signup to finish registration
                    if (pathname !== '/signup') {
                        return NextResponse.redirect(new URL('/signup?from=signin', req.url));
                    }
                } else if (hasCodeParam) {
                    // Let the signup page handle the "already registered" error
                    return;
                } else if (existingUser.status !== "verified") {
                    // User is pending approval – redirect to the correct pending page
                    const pendingPath = existingUser.role === "employee"
                        ? '/employee/pending-approval'
                        : '/employer/pending-approval';
                    if (pathname !== pendingPath) {
                        return NextResponse.redirect(new URL(pendingPath, req.url));
                    }
                } else if (isProtectedRoute(req)) {
                    const isEmployerRole =
                        existingUser.role === "employer" || existingUser.role === "owner";
                    const isEmployeeRole = existingUser.role === "employee";

                    // Enforce role-specific protected route spaces.
                    if (isEmployerPath(pathname) && !isEmployerRole) {
                        return NextResponse.redirect(new URL('/employee/documents', req.url));
                    }
                    if (isEmployeePath(pathname) && !isEmployeeRole) {
                        return NextResponse.redirect(new URL('/employer/documents', req.url));
                    }
                } else if (isAuthRedirectRoute(req)) {
                    // Verified user on / or /signup – send to their dashboard.
                    // Users with 2+ memberships pick a workspace first.
                    if (existingUser.role === "employer" || existingUser.role === "owner") {
                        if (existingUser.membershipCount >= 2) {
                            return NextResponse.redirect(new URL('/workspaces', req.url));
                        }
                        return NextResponse.redirect(new URL('/employer/documents', req.url));
                    } else if (existingUser.role === "employee") {
                        if (existingUser.membershipCount >= 2) {
                            return NextResponse.redirect(new URL('/workspaces', req.url));
                        }
                        return NextResponse.redirect(new URL('/employee/documents', req.url));
                    }
                }
                // Verified user on a protected route – let through
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
});

// A path missing from the matcher is not a public path — it just means the
// middleware never sees it, so the handler is the only thing standing between
// the caller and the data. /api/upload-local authenticates inline with auth(),
// and /api/files/[id] accepts a session or a signed per-file token.
//
// Note that the upload-local / files exclusion below is a no-op in practice:
// the first pattern already matches any path without one of those static file
// extensions, so both routes do run through this middleware.
export const config = {
    runtime: 'nodejs',
    matcher: [
        // Skip Next.js internals and all static files, unless found in search params
        '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
        // Always run for API routes, but exclude file upload routes (body stream conflicts in standalone mode)
        '/(api(?!/upload-local|/files)|trpc)(.*)',
    ],
};
