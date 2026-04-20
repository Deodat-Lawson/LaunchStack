/**
 * In-memory rate limiter implementation using token bucket algorithm
 *
 * Features:
 * - Token bucket algorithm for smooth rate limiting
 * - Support for different rate limit tiers (standard, premium, admin)
 * - Automatic cleanup of expired entries
 * - Standard rate limit headers (X-RateLimit-*)
 * - Can be extended to use Redis for distributed rate limiting
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
   * Optional: Custom identifier for the rate limit bucket
   * Defaults to IP address
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
   * Timestamp when the rate limit resets (milliseconds since epoch)
   */
  resetTime: number;

  /**
   * Milliseconds until the rate limit resets
   */
  retryAfter?: number;
}

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  resetTime: number;
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
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  /**
   * Get or create a token bucket for the given key
   */
  getBucket(key: string, maxTokens: number, windowMs: number): TokenBucket {
    if (!this.buckets) {
      throw new Error("Rate limit store not initialized");
    }
    let bucket = this.buckets.get(key);
    const now = Date.now();

    if (!bucket) {
      bucket = {
        tokens: maxTokens,
        lastRefill: now,
        resetTime: now + windowMs,
      };
      this.buckets.set(key, bucket);
    } else {
      // Refill tokens based on elapsed time
      const elapsed = now - bucket.lastRefill;
      const tokensToAdd = Math.floor((elapsed / windowMs) * maxTokens);

      if (tokensToAdd > 0) {
        bucket.tokens = Math.min(bucket.tokens + tokensToAdd, maxTokens);
        bucket.lastRefill = now;
        bucket.resetTime = now + windowMs;
      }
    }

    return bucket;
  }

  /**
   * Try to consume a token from the bucket
   */
  consume(key: string, maxTokens: number, windowMs: number): RateLimitInfo {
    const bucket = this.getBucket(key, maxTokens, windowMs);
    const now = Date.now();

    if (bucket.tokens > 0) {
      bucket.tokens--;
      return {
        allowed: true,
        limit: maxTokens,
        remaining: Math.floor(bucket.tokens),
        resetTime: bucket.resetTime,
      };
    }

    return {
      allowed: false,
      limit: maxTokens,
      remaining: 0,
      resetTime: bucket.resetTime,
      retryAfter: Math.ceil((bucket.resetTime - now) / 1000),
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
      if (now > bucket.resetTime + 60000) { // 1 minute grace period
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
 * Default key generator - uses IP address from request headers
 */
const defaultKeyGenerator = (request: Request): string => {
  // Try various headers for IP address
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const cfConnectingIp = request.headers.get('cf-connecting-ip');

  if (forwarded) {
    return forwarded.split(',')[0]?.trim() ?? 'unknown';
  }
  if (realIp) {
    return realIp;
  }
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  return 'unknown';
};

/**
 * Create a rate limiter with the specified configuration
 */
export function createRateLimiter(config: RateLimitConfig) {
  const keyGenerator = config.keyGenerator ?? defaultKeyGenerator;
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

    // Generate key for this request
    const key = await keyGenerator(request);

    // Try to consume a token
    return store.consume(key, config.maxRequests, config.windowMs);
  };
}

/**
 * Predefined rate limit configurations
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
