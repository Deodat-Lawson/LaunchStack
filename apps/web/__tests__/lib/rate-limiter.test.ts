import {
  createRateLimiter,
  RateLimitPresets,
  clearRateLimitStore,
  destroyRateLimitStore,
  type RateLimitConfig,
} from "~/lib/rate-limiter";

describe("Rate Limiter", () => {
  // Helper to create mock requests
  const createMockRequest = (ip: string = "192.168.1.1"): Request => {
    return {
      headers: {
        get: (name: string) => {
          if (name === "x-forwarded-for") return ip;
          return null;
        },
      },
    } as Request;
  };

  beforeEach(() => {
    clearRateLimitStore();
  });

  afterAll(() => {
    destroyRateLimitStore();
  });

  describe("Token Bucket Algorithm", () => {
    it("should allow requests within the rate limit", async () => {
      const config: RateLimitConfig = {
        maxRequests: 5,
        windowMs: 60000, // 1 minute
      };

      const rateLimiter = createRateLimiter(config);
      const request = createMockRequest();

      // First 5 requests should be allowed
      for (let i = 0; i < 5; i++) {
        const result = await rateLimiter(request);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(4 - i);
        expect(result.limit).toBe(5);
      }
    });

    it("should block requests exceeding the rate limit", async () => {
      const config: RateLimitConfig = {
        maxRequests: 3,
        windowMs: 60000,
      };

      const rateLimiter = createRateLimiter(config);
      const request = createMockRequest();

      // Use up the rate limit
      for (let i = 0; i < 3; i++) {
        await rateLimiter(request);
      }

      // Next request should be blocked
      const result = await rateLimiter(request);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeDefined();
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it("should track different IPs separately", async () => {
      const config: RateLimitConfig = {
        maxRequests: 2,
        windowMs: 60000,
      };

      const rateLimiter = createRateLimiter(config);
      const request1 = createMockRequest("192.168.1.1");
      const request2 = createMockRequest("192.168.1.2");

      // Use up rate limit for first IP
      await rateLimiter(request1);
      await rateLimiter(request1);

      // Third request from first IP should be blocked
      const result1 = await rateLimiter(request1);
      expect(result1.allowed).toBe(false);

      // But second IP should still be allowed
      const result2 = await rateLimiter(request2);
      expect(result2.allowed).toBe(true);
    });
  });

  describe("Custom Key Generator", () => {
    it("should use custom key generator when provided", async () => {
      const customKey = "custom-user-123";
      const config: RateLimitConfig = {
        maxRequests: 2,
        windowMs: 60000,
        keyGenerator: () => customKey,
      };

      const rateLimiter = createRateLimiter(config);
      const request1 = createMockRequest("192.168.1.1");
      const request2 = createMockRequest("192.168.1.2");

      // Both requests should share the same rate limit
      await rateLimiter(request1);
      await rateLimiter(request2);

      // Third request should be blocked regardless of IP
      const result = await rateLimiter(request1);
      expect(result.allowed).toBe(false);
    });

    it("should support async key generator", async () => {
      const config: RateLimitConfig = {
        maxRequests: 2,
        windowMs: 60000,
        keyGenerator: async (request: Request) => {
          // Simulate async operation (e.g., looking up user ID)
          return Promise.resolve("async-user-456");
        },
      };

      const rateLimiter = createRateLimiter(config);
      const request = createMockRequest();

      const result1 = await rateLimiter(request);
      expect(result1.allowed).toBe(true);

      const result2 = await rateLimiter(request);
      expect(result2.allowed).toBe(true);

      const result3 = await rateLimiter(request);
      expect(result3.allowed).toBe(false);
    });
  });

  describe("Skip Function", () => {
    it("should skip rate limiting when skip function returns true", async () => {
      const config: RateLimitConfig = {
        maxRequests: 1,
        windowMs: 60000,
        skip: () => true,
      };

      const rateLimiter = createRateLimiter(config);
      const request = createMockRequest();

      // All requests should be allowed even beyond the limit
      for (let i = 0; i < 10; i++) {
        const result = await rateLimiter(request);
        expect(result.allowed).toBe(true);
      }
    });

    it("should apply rate limiting when skip function returns false", async () => {
      const config: RateLimitConfig = {
        maxRequests: 2,
        windowMs: 60000,
        skip: () => false,
      };

      const rateLimiter = createRateLimiter(config);
      const request = createMockRequest();

      await rateLimiter(request);
      await rateLimiter(request);

      const result = await rateLimiter(request);
      expect(result.allowed).toBe(false);
    });
  });

  describe("Rate Limit Presets", () => {
    it("should have correct configuration for standard preset", () => {
      expect(RateLimitPresets.standard.maxRequests).toBe(100);
      expect(RateLimitPresets.standard.windowMs).toBe(15 * 60 * 1000);
    });

    it("should have correct configuration for strict preset", () => {
      expect(RateLimitPresets.strict.maxRequests).toBe(20);
      expect(RateLimitPresets.strict.windowMs).toBe(15 * 60 * 1000);
    });

    it("should have correct configuration for permissive preset", () => {
      expect(RateLimitPresets.permissive.maxRequests).toBe(300);
      expect(RateLimitPresets.permissive.windowMs).toBe(15 * 60 * 1000);
    });

    it("should have correct configuration for burst preset", () => {
      expect(RateLimitPresets.burst.maxRequests).toBe(10);
      expect(RateLimitPresets.burst.windowMs).toBe(60 * 1000);
    });
  });

  describe("Headers Extraction", () => {
    it("should extract IP from x-forwarded-for header", async () => {
      const config: RateLimitConfig = {
        maxRequests: 2,
        windowMs: 60000,
      };

      const rateLimiter = createRateLimiter(config);
      const request = {
        headers: {
          get: (name: string) => {
            if (name === "x-forwarded-for") return "203.0.113.1, 198.51.100.1";
            return null;
          },
        },
      } as Request;

      await rateLimiter(request);
      await rateLimiter(request);

      const result = await rateLimiter(request);
      expect(result.allowed).toBe(false);
    });

    it("should extract IP from x-real-ip header when x-forwarded-for is not present", async () => {
      const config: RateLimitConfig = {
        maxRequests: 2,
        windowMs: 60000,
      };

      const rateLimiter = createRateLimiter(config);
      const request = {
        headers: {
          get: (name: string) => {
            if (name === "x-real-ip") return "203.0.113.5";
            return null;
          },
        },
      } as Request;

      await rateLimiter(request);
      await rateLimiter(request);

      const result = await rateLimiter(request);
      expect(result.allowed).toBe(false);
    });

    it("should handle unknown IP gracefully", async () => {
      const config: RateLimitConfig = {
        maxRequests: 2,
        windowMs: 60000,
      };

      const rateLimiter = createRateLimiter(config);
      const request = {
        headers: {
          get: () => null,
        },
      } as unknown as Request;

      // Should still work with 'unknown' as the key
      const result1 = await rateLimiter(request);
      expect(result1.allowed).toBe(true);

      const result2 = await rateLimiter(request);
      expect(result2.allowed).toBe(true);

      const result3 = await rateLimiter(request);
      expect(result3.allowed).toBe(false);
    });
  });

  describe("Token Refill", () => {
    it("should refill tokens over time", async () => {
      // Use a small window for testing
      const config: RateLimitConfig = {
        maxRequests: 2,
        windowMs: 100, // 100ms window
      };

      const rateLimiter = createRateLimiter(config);
      const request = createMockRequest();

      // Use up tokens
      await rateLimiter(request);
      await rateLimiter(request);

      // Should be blocked
      const blocked = await rateLimiter(request);
      expect(blocked.allowed).toBe(false);

      // Wait for window to pass
      await new Promise(resolve => setTimeout(resolve, 150));

      // Tokens should be refilled
      const allowed = await rateLimiter(request);
      expect(allowed.allowed).toBe(true);
    });
  });

  describe("Rate Limit Info", () => {
    it("should return correct rate limit information", async () => {
      const config: RateLimitConfig = {
        maxRequests: 10,
        windowMs: 60000,
      };

      const rateLimiter = createRateLimiter(config);
      const request = createMockRequest();

      const result = await rateLimiter(request);

      expect(result).toHaveProperty("allowed");
      expect(result).toHaveProperty("limit");
      expect(result).toHaveProperty("remaining");
      expect(result).toHaveProperty("resetTime");
      expect(result.limit).toBe(10);
      expect(result.remaining).toBe(9);
      expect(result.resetTime).toBeGreaterThan(Date.now());
    });

    it("should include retryAfter only when rate limited", async () => {
      const config: RateLimitConfig = {
        maxRequests: 1,
        windowMs: 60000,
      };

      const rateLimiter = createRateLimiter(config);
      const request = createMockRequest();

      const allowed = await rateLimiter(request);
      expect(allowed.retryAfter).toBeUndefined();

      const blocked = await rateLimiter(request);
      expect(blocked.retryAfter).toBeDefined();
      expect(blocked.retryAfter).toBeGreaterThan(0);
    });
  });

  describe("Store Management", () => {
    it("should clear all rate limit data", async () => {
      const config: RateLimitConfig = {
        maxRequests: 1,
        windowMs: 60000,
      };

      const rateLimiter = createRateLimiter(config);
      const request = createMockRequest();

      // Use up the rate limit
      await rateLimiter(request);

      // Should be blocked
      const blocked = await rateLimiter(request);
      expect(blocked.allowed).toBe(false);

      // Clear the store
      clearRateLimitStore();

      // Should be allowed again
      const allowed = await rateLimiter(request);
      expect(allowed.allowed).toBe(true);
    });
  });
});
