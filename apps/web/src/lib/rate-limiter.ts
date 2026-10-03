/**
 * In-memory rate limiter implementation using token bucket algorithm
 *
 * Features:
 * - Token bucket algorithm for smooth rate limiting
 * - Support for different rate limit tiers (standard, premium, admin)
 * - Automatic cleanup of expired entries
 * - Standard rate limit headers (X-RateLimit-*)
 * - Can be extended to use Redis for distributed rate limiting
 *
 * Every bucket belongs to one route, one limit and one caller
 * (`rateLimitBucketKey`). A limit is a promise about that endpoint: a page
 * polling a read must never spend the budget a write on another route — or
 * the same route's write — depends on, and two limits must never drain one
 * bucket. Before this, every preset drew from a single per-IP bucket, so a 3s
 * poll of GET /api/folders alone used up the 300-request read budget and the
 * next "New folder" answered 429.
 */

export interface RateLimitConfig {
    /**
     * Maximum number of requests allowed in the window
     */
    maxRequests: number;

    /**
     * Time window in milliseconds
     */
    windowMs: number;

    /**
     * Optional: who is calling. Defaults to the client IP (`withRateLimit`
     * prefers the signed-in user). The bucket is always also scoped to the
     * route and the limit, so a custom key never shares a bucket across routes.
     */
    keyGenerator?: (request: Request) => string | Promise<string>;

    /**
     * Optional: Skip rate limiting for certain requests
     */
    skip?: (request: Request) => boolean | Promise<boolean>;
}

export interface RateLimitInfo {
    /**
     * Whether the request is allowed
     */
    allowed: boolean;

    /**
     * Total limit for this bucket
     */
    limit: number;

    /**
     * Remaining requests in the current window
     */
    remaining: number;

    /**
     * When the bucket is full again (milliseconds since epoch)
     */
    resetTime: number;

    /**
     * Seconds until the next request will be allowed (only when blocked)
     */
    retryAfter?: number;
}

interface TokenBucket {
    tokens: number;
    /** When the most recent whole token was credited; the remainder carries over. */
    lastRefill: number;
    /** When the bucket is full again — after that it is the same as no bucket. */
    fullAt: number;
}

/**
 * In-memory store for rate limit buckets
 * In production, this should be replaced with Redis or similar distributed cache
 */
class RateLimitStore {
    private buckets: Map<string, TokenBucket> | null = null;
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor() {
        // Clean up expired entries every 5 minutes
        this.buckets = new Map();
        this.cleanupInterval = setInterval(
            () => {
                this.cleanup();
            },
            5 * 60 * 1000
        );
        // Housekeeping only — it must never be the reason a process stays alive.
        // Without this, merely importing a rate-limited route hangs a Jest worker
        // (and any short-lived script) until the runner is force-exited.
        this.cleanupInterval.unref?.();
    }

    /**
     * Get or create a token bucket for the given key, refilled to now
     */
    getBucket(key: string, maxTokens: number, windowMs: number): TokenBucket {
        if (!this.buckets) {
            throw new Error("Rate limit store not initialized");
        }
        let bucket = this.buckets.get(key);
        const now = Date.now();

        if (!bucket) {
            bucket = { tokens: maxTokens, lastRefill: now, fullAt: now };
            this.buckets.set(key, bucket);
            return bucket;
        }

        // One token every windowMs / maxTokens. Only whole tokens are credited,
        // and lastRefill advances by exactly what was credited: resetting it to
        // `now` threw the partial token away, so a client polling at the refill
        // rate earned roughly half the tokens it was promised.
        const msPerToken = windowMs / maxTokens;
        const earned = Math.floor((now - bucket.lastRefill) / msPerToken);
        if (earned > 0) {
            bucket.tokens = Math.min(bucket.tokens + earned, maxTokens);
            // A full bucket banks nothing; otherwise keep the partial token.
            bucket.lastRefill =
                bucket.tokens === maxTokens ? now : bucket.lastRefill + earned * msPerToken;
        }

        return bucket;
    }

    /**
     * Try to consume a token from the bucket
     */
    consume(key: string, maxTokens: number, windowMs: number): RateLimitInfo {
        const bucket = this.getBucket(key, maxTokens, windowMs);
        const now = Date.now();
        const msPerToken = windowMs / maxTokens;

        if (bucket.tokens > 0) {
            bucket.tokens--;
            bucket.fullAt = bucket.lastRefill + (maxTokens - bucket.tokens) * msPerToken;
            return {
                allowed: true,
                limit: maxTokens,
                remaining: bucket.tokens,
                resetTime: bucket.fullAt,
            };
        }

        // Empty: the caller may try again when the next token lands, not when
        // the whole window has passed (that told people to wait 15 minutes).
        const nextTokenAt = bucket.lastRefill + msPerToken;
        return {
            allowed: false,
            limit: maxTokens,
            remaining: 0,
            resetTime: bucket.fullAt,
            retryAfter: Math.max(1, Math.ceil((nextTokenAt - now) / 1000)),
        };
    }

    /**
     * Clean up expired buckets
     */
    private cleanup(): void {
        const now = Date.now();
        const keysToDelete: string[] = [];

        if (!this.buckets) {
            throw new Error("Rate limit store not initialized");
        }
        for (const [key, bucket] of this.buckets.entries()) {
            if (now > bucket.fullAt + 60000) {
                // 1 minute grace period
                keysToDelete.push(key);
            }
        }

        keysToDelete.forEach(key => this.buckets?.delete(key));
    }

    /**
     * Clear all buckets (useful for testing)
     */
    clear(): void {
        if (!this.buckets) {
            throw new Error("Rate limit store not initialized");
        }
        this.buckets.clear();
    }

    /**
     * Stop the cleanup interval
     */
    destroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}

// Singleton store instance
const store = new RateLimitStore();

/**
 * The caller's IP, from the proxy headers — the fallback identity when there
 * is no signed-in user. Everyone behind one NAT shares it.
 */
export function clientIpKey(request: Request): string {
    // Try various headers for IP address
    const forwarded = request.headers.get("x-forwarded-for");
    const realIp = request.headers.get("x-real-ip");
    const cfConnectingIp = request.headers.get("cf-connecting-ip");

    if (forwarded) {
        return `ip:${forwarded.split(",")[0]?.trim() ?? "unknown"}`;
    }
    if (realIp) {
        return `ip:${realIp}`;
    }
    if (cfConnectingIp) {
        return `ip:${cfConnectingIp}`;
    }

    return "ip:unknown";
}

/**
 * The route a request is for: its method and path, with every segment that
 * holds a digit read as an id. `/api/documents/123` and `/api/documents/456`
 * are one route, so stepping through ids buys no extra budget. No static
 * segment under app/api contains a digit (a test holds that), so this never
 * merges two real routes.
 */
export function rateLimitRoute(request: Request): string {
    let pathname = "";
    try {
        pathname = new URL(request.url).pathname;
    } catch {
        // No absolute URL (a hand-built request): every such request is one route.
    }
    const route = pathname
        .split("/")
        .filter(Boolean)
        .map(segment => (/\d/.test(segment) ? ":id" : segment))
        .join("/");
    return `${request.method ?? "*"} /${route}`;
}

/**
 * The bucket a request draws from: route × limit × caller. Different limits
 * (presets) never share a bucket — not even on the same route — and neither
 * do different routes, whatever the caller key says.
 */
export function rateLimitBucketKey(
    request: Request,
    config: Pick<RateLimitConfig, "maxRequests" | "windowMs">,
    caller: string
): string {
    return `${rateLimitRoute(request)}|${config.maxRequests}/${config.windowMs}ms|${caller}`;
}

/**
 * Create a rate limiter with the specified configuration
 */
export function createRateLimiter(config: RateLimitConfig) {
    const keyGenerator = config.keyGenerator ?? clientIpKey;
    const skip = config.skip ?? (() => false);

    return async (request: Request): Promise<RateLimitInfo> => {
        // Check if we should skip rate limiting
        if (await skip(request)) {
            return {
                allowed: true,
                limit: config.maxRequests,
                remaining: config.maxRequests,
                resetTime: Date.now() + config.windowMs,
            };
        }

        const key = rateLimitBucketKey(request, config, await keyGenerator(request));

        // Try to consume a token
        return store.consume(key, config.maxRequests, config.windowMs);
    };
}

/**
 * Predefined rate limit configurations. Each is a per-route, per-caller
 * budget: a route with `standard` allows each person 100 requests per 15
 * minutes to that route and method, independent of every other route.
 */
export const RateLimitPresets = {
    /**
     * Standard rate limit: 100 requests per 15 minutes
     * Suitable for general API endpoints
     */
    standard: {
        maxRequests: 100,
        windowMs: 15 * 60 * 1000,
    },

    /**
     * Strict rate limit: 20 requests per 15 minutes
     * For expensive operations (AI, embeddings, OCR)
     */
    strict: {
        maxRequests: 20,
        windowMs: 15 * 60 * 1000,
    },

    /**
     * Permissive rate limit: 300 requests per 15 minutes
     * For lightweight read operations
     */
    permissive: {
        maxRequests: 300,
        windowMs: 15 * 60 * 1000,
    },

    /**
     * Burst rate limit: 10 requests per minute
     * For preventing rapid-fire requests
     */
    burst: {
        maxRequests: 10,
        windowMs: 60 * 1000,
    },
} as const;

/**
 * Clear all rate limit data (useful for testing)
 */
export function clearRateLimitStore(): void {
    store.clear();
}

/**
 * Cleanup and destroy the rate limit store
 */
export function destroyRateLimitStore(): void {
    store.destroy();
}
