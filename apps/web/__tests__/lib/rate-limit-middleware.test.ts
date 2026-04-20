import { NextResponse } from "next/server";
import {
  withRateLimit,
  applyRateLimitHeaders,
  createRateLimitResponse,
} from "~/lib/rate-limit-middleware";
import { RateLimitPresets, clearRateLimitStore } from "~/lib/rate-limiter";
import type { RateLimitInfo } from "~/lib/rate-limiter";

describe("Rate Limit Middleware", () => {
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

  describe("applyRateLimitHeaders", () => {
    it("should add rate limit headers to response", () => {
      const response = NextResponse.json({ success: true });
      const info: RateLimitInfo = {
        allowed: true,
        limit: 100,
        remaining: 95,
        resetTime: Date.now() + 60000,
      };

      const updatedResponse = applyRateLimitHeaders(response, info);

      expect(updatedResponse.headers.get("X-RateLimit-Limit")).toBe("100");
      expect(updatedResponse.headers.get("X-RateLimit-Remaining")).toBe("95");
      expect(updatedResponse.headers.get("X-RateLimit-Reset")).toBe(
        info.resetTime.toString()
      );
    });

    it("should add Retry-After header when rate limited", () => {
      const response = NextResponse.json({ success: false });
      const info: RateLimitInfo = {
        allowed: false,
        limit: 100,
        remaining: 0,
        resetTime: Date.now() + 60000,
        retryAfter: 60,
      };

      const updatedResponse = applyRateLimitHeaders(response, info);

      expect(updatedResponse.headers.get("Retry-After")).toBe("60");
    });

    it("should not add Retry-After header when not rate limited", () => {
      const response = NextResponse.json({ success: true });
      const info: RateLimitInfo = {
        allowed: true,
        limit: 100,
        remaining: 95,
        resetTime: Date.now() + 60000,
      };

      const updatedResponse = applyRateLimitHeaders(response, info);

      expect(updatedResponse.headers.get("Retry-After")).toBeNull();
    });
  });

  describe("createRateLimitResponse", () => {
    it("should create 429 response with proper error message", () => {
      const info: RateLimitInfo = {
        allowed: false,
        limit: 100,
        remaining: 0,
        resetTime: Date.now() + 60000,
        retryAfter: 60,
      };

      const response = createRateLimitResponse(info);

      expect(response.status).toBe(429);

      // Get JSON body
      response.json().then((body: { success: boolean; error: string; message: string; retryAfter: number }) => {
        expect(body.success).toBe(false);
        expect(body.error).toBe("Rate Limit Exceeded");
        expect(body.message).toContain("Too many requests");
        expect(body.retryAfter).toBe(60);
      }).catch((error: Error) => {
        throw error;
      });

      expect(response.headers.get("X-RateLimit-Limit")).toBe("100");
      expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
      expect(response.headers.get("Retry-After")).toBe("60");
    });
  });

  describe("withRateLimit", () => {
    it("should allow request within rate limit", async () => {
      const request = createMockRequest();
      const handler = jest.fn(async () =>
        NextResponse.json({ success: true, data: "test" })
      );

      const response = await withRateLimit(
        request,
        { maxRequests: 10, windowMs: 60000 },
        handler
      );

      expect(handler).toHaveBeenCalled();
      expect(response.status).toBe(200);
      expect(response.headers.get("X-RateLimit-Limit")).toBe("10");
      expect(response.headers.get("X-RateLimit-Remaining")).toBe("9");
    });

    it("should block request exceeding rate limit", async () => {
      const request = createMockRequest();
      const handler = jest.fn(async () =>
        NextResponse.json({ success: true })
      );

      const config = { maxRequests: 2, windowMs: 60000 };

      // Use up rate limit
      await withRateLimit(request, config, handler);
      await withRateLimit(request, config, handler);

      // This should be blocked
      const response = await withRateLimit(request, config, handler);

      expect(handler).toHaveBeenCalledTimes(2);
      expect(response.status).toBe(429);

      const body = await response.json() as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe("Rate Limit Exceeded");
    });

    it("should apply rate limit headers even on handler errors", async () => {
      const request = createMockRequest();
      const handler = jest.fn(async () => {
        throw new Error("Handler error");
      });

      const response = await withRateLimit(
        request,
        { maxRequests: 10, windowMs: 60000 },
        handler
      );

      expect(response.status).toBe(500);
      expect(response.headers.get("X-RateLimit-Limit")).toBe("10");
      expect(response.headers.get("X-RateLimit-Remaining")).toBe("9");

      const body = await response.json() as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe("Internal Server Error");
    });

    it("should work with rate limit presets", async () => {
      const request = createMockRequest();
      const handler = jest.fn(async () =>
        NextResponse.json({ success: true })
      );

      const response = await withRateLimit(
        request,
        RateLimitPresets.standard,
        handler
      );

      expect(handler).toHaveBeenCalled();
      expect(response.headers.get("X-RateLimit-Limit")).toBe("100");
    });

    it("should handle different IPs independently", async () => {
      const request1 = createMockRequest("192.168.1.1");
      const request2 = createMockRequest("192.168.1.2");
      const handler = jest.fn(async () =>
        NextResponse.json({ success: true })
      );

      const config = { maxRequests: 1, windowMs: 60000 };

      // Use up rate limit for IP 1
      await withRateLimit(request1, config, handler);
      const blocked1 = await withRateLimit(request1, config, handler);

      // IP 2 should still be allowed
      const allowed2 = await withRateLimit(request2, config, handler);

      expect(blocked1.status).toBe(429);
      expect(allowed2.status).toBe(200);
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });
  
  describe("Integration with API Routes", () => {
    it("should rate limit expensive operations more strictly", async () => {
      const request = createMockRequest();
      const expensiveHandler = jest.fn(async () =>
        NextResponse.json({ result: "expensive operation" })
      );

      // Simulate expensive API calls (strict preset: 20 requests per 15 min)
      for (let i = 0; i < 20; i++) {
        const response = await withRateLimit(
          request,
          RateLimitPresets.strict,
          expensiveHandler
        );
        expect(response.status).toBe(200);
      }

      // 21st request should be blocked
      const blocked = await withRateLimit(
        request,
        RateLimitPresets.strict,
        expensiveHandler
      );

      expect(blocked.status).toBe(429);
      expect(expensiveHandler).toHaveBeenCalledTimes(20);
    });

    it("should allow more requests for lightweight operations", async () => {
      const request = createMockRequest();
      const lightHandler = jest.fn(async () =>
        NextResponse.json({ result: "light operation" })
      );

      // Simulate lightweight API calls (permissive preset: 300 requests per 15 min)
      for (let i = 0; i < 50; i++) {
        const response = await withRateLimit(
          request,
          RateLimitPresets.permissive,
          lightHandler
        );
        expect(response.status).toBe(200);
      }

      expect(lightHandler).toHaveBeenCalledTimes(50);
    });
  });
});
