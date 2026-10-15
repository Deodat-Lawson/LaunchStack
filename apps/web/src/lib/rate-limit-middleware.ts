import { getSessionCookie } from "better-auth/cookies";
import { NextResponse } from "next/server";

import { getSessionFromHeaders } from "~/server/auth";
import {
    clientIpKey,
    createRateLimiter,
    type RateLimitConfig,
    type RateLimitInfo,
} from "./rate-limiter";

/**
 * Who a request counts against: the signed-in user when the session checks
 * out, the client IP otherwise. Keying on the user keeps one person's polling
 * from spending a colleague's budget behind the same office NAT.
 *
 * The session is verified here, not read from a header the middleware could
 * forward: a header is only trustworthy on paths the middleware matcher
 * covers, and a forged one would buy a fresh bucket per request. better-auth
 * answers from its signed cookie cache, so this rarely touches the database.
 */
export async function rateLimitCaller(request: Request): Promise<string> {
    // No session cookie means anonymous — skip the lookup (middleware.ts does the same).
    if (getSessionCookie(request)) {
        try {
            const session = await getSessionFromHeaders(request.headers);
            if (session?.user.id) return `user:${session.user.id}`;
        } catch {
            // An unreadable session counts as anonymous; the route's own auth decides the rest.
        }
    }
    return clientIpKey(request);
}

/**
 * Apply rate limiting headers to a response
 */
export function applyRateLimitHeaders(response: NextResponse, info: RateLimitInfo): NextResponse {
    response.headers.set("X-RateLimit-Limit", info.limit.toString());
    response.headers.set("X-RateLimit-Remaining", info.remaining.toString());
    response.headers.set("X-RateLimit-Reset", info.resetTime.toString());

    if (info.retryAfter !== undefined) {
        response.headers.set("Retry-After", info.retryAfter.toString());
    }

    return response;
}

/**
 * Create a rate limit response with standard 429 status
 */
export function createRateLimitResponse(info: RateLimitInfo): NextResponse {
    const response = NextResponse.json(
        {
            success: false,
            error: "Rate Limit Exceeded",
            message: `Too many requests. Please try again in ${info.retryAfter} seconds.`,
            retryAfter: info.retryAfter,
        },
        { status: 429 }
    );

    return applyRateLimitHeaders(response, info);
}

/**
 * Wrapper function to apply rate limiting to an API route handler.
 *
 * The budget is per route and method, per limit, and per caller
 * (`rateLimitCaller` unless the config names its own key) — see
 * `rateLimitBucketKey`.
 *
 * @example
 * ```ts
 * export async function POST(request: Request) {
 *   return withRateLimit(request, RateLimitPresets.strict, async () => {
 *     // Your API logic here
 *     return NextResponse.json({ success: true });
 *   });
 * }
 * ```
 */
export async function withRateLimit(
    request: Request,
    config: RateLimitConfig,
    handler: () => Promise<NextResponse>
): Promise<NextResponse> {
    const rateLimiter = createRateLimiter({
        ...config,
        keyGenerator: config.keyGenerator ?? rateLimitCaller,
    });
    const info = await rateLimiter(request);

    if (!info.allowed) {
        return createRateLimitResponse(info);
    }

    try {
        const response = await handler();
        return applyRateLimitHeaders(response, info);
    } catch (error) {
        // Even on errors, apply rate limit headers
        const errorResponse = NextResponse.json(
            {
                success: false,
                error: "Internal Server Error",
                message: error instanceof Error ? error.message : "Unknown error",
            },
            { status: 500 }
        );
        return applyRateLimitHeaders(errorResponse, info);
    }
}
