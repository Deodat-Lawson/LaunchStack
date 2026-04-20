import { NextResponse } from "next/server";
import { createRateLimiter, type RateLimitConfig, type RateLimitInfo } from "./rate-limiter";

/**
 * Apply rate limiting headers to a response
 */
export function applyRateLimitHeaders(
  response: NextResponse,
  info: RateLimitInfo
): NextResponse {
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
 * Wrapper function to apply rate limiting to an API route handler
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
  const rateLimiter = createRateLimiter(config);
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

