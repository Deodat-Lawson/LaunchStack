import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "~/lib/auth";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { users } from "~/server/db/schema";

const shouldLogPerf =
    process.env.NODE_ENV === "development" &&
    (process.env.DEBUG_PERF === "1" || process.env.DEBUG_PERF === "true");
const middlewareUserCacheTtlMs = 10_000;

// Route matchers (replacing Clerk's createRouteMatcher)
const protectedPrefixes = ["/employer", "/employee"];
const publicPaths = new Set(["/", "/pricing", "/deployment", "/contact", "/about", "/signup", "/signin"]);

const isProtectedRoute = (pathname: string) =>
    protectedPrefixes.some((p) => pathname.startsWith(p));

const isPublicRoute = (pathname: string) =>
    publicPaths.has(pathname) || pathname.startsWith("/api/webhooks");

const isAuthRedirectRoute = (pathname: string) =>
    pathname === "/" || pathname === "/signup" || pathname === "/signin";

const isEmployerPath = (pathname: string) => pathname.startsWith("/employer");
const isEmployeePath = (pathname: string) => pathname.startsWith("/employee");

// Lazy singleton for middleware (postgres.js works with standard PostgreSQL)
let _middlewareDb: ReturnType<typeof drizzle<{ users: typeof users }>> | null = null;
const getDb = () => {
    if (!_middlewareDb) {
        const client = postgres(process.env.DATABASE_URL!, { max: 1 });
        _middlewareDb = drizzle(client, { schema: { users } });
    }
    return _middlewareDb;
};

type CachedUserValue = {
    role: string;
    status: string;
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
    middlewareUserCache.set(userId, {
        value,
        expiresAt: Date.now() + middlewareUserCacheTtlMs,
    });
};

export default async function middleware(req: NextRequest) {
    const requestStart = Date.now();
    let dbQueryMs: number | null = null;
    const pathname = req.nextUrl.pathname;

    // Get session from Better Auth
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id ?? null;

    try {
        // Skip API routes and static files for redirect logic
        if (pathname.startsWith('/api/') || pathname.startsWith('/_next/')) {
            if (isProtectedRoute(pathname) && !isPublicRoute(pathname) && !userId) {
                return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            }
            return;
        }

        // Protect routes that require authentication
        if (isProtectedRoute(pathname) && !isPublicRoute(pathname) && !userId) {
            return NextResponse.redirect(new URL('/signin', req.url));
        }

        // Route authenticated users based on their DB role + status
        if (userId && (isAuthRedirectRoute(pathname) || isProtectedRoute(pathname))) {
            const hasCodeParam = pathname === '/signup' && req.nextUrl.searchParams.has('code');

            try {
                const cachedUser = getCachedMiddlewareUser(userId);
                let existingUser = cachedUser;
                if (cachedUser === undefined) {
                    const db = getDb();
                    const dbStart = Date.now();
                    const [queriedUser] = await db
                        .select({ role: users.role, status: users.status })
                        .from(users)
                        .where(eq(users.userId, userId));
                    dbQueryMs = Date.now() - dbStart;
                    existingUser = queriedUser;
                    // Only cache verified users to avoid stale pending/signup states.
                    if (existingUser && existingUser.status === "verified") {
                        setCachedMiddlewareUser(userId, existingUser);
                    }
                }

                if (!existingUser) {
                    // User exists in Better Auth but not in DB – send to signup to finish registration
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
                } else if (isProtectedRoute(pathname)) {
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
                } else if (isAuthRedirectRoute(pathname)) {
                    // Verified user on / or /signup – send to their dashboard
                    if (existingUser.role === "employer" || existingUser.role === "owner") {
                        return NextResponse.redirect(new URL('/employer/documents', req.url));
                    } else if (existingUser.role === "employee") {
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
}

export const config = {
    runtime: 'nodejs',
    matcher: [
        // Skip Next.js internals and all static files, unless found in search params
        '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
        // Always run for API routes, but exclude file upload routes (body stream conflicts in standalone mode)
        '/(api(?!/upload-local|/files)|trpc)(.*)',
    ],
};
