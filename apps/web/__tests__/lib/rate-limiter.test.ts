import { readdirSync } from "node:fs";
import path from "node:path";

import {
    createRateLimiter,
    RateLimitPresets,
    clearRateLimitStore,
    destroyRateLimitStore,
    rateLimitRoute,
    type RateLimitConfig,
} from "~/lib/rate-limiter";

/** A real request to an API route, from one client IP. */
function apiRequest(method: string, pathname: string, ip = "203.0.113.7"): Request {
    return new Request(`http://localhost${pathname}`, {
        method,
        headers: { "x-forwarded-for": ip },
    });
}

/** Spend `count` requests and return the last answer. */
async function spend(
    limiter: ReturnType<typeof createRateLimiter>,
    request: Request,
    count: number
) {
    let last = await limiter(request);
    for (let i = 1; i < count; i++) last = await limiter(request);
    return last;
}

describe("Rate Limiter", () => {
    // Helper to create mock requests
    const createMockRequest = (ip = "192.168.1.1"): Request => {
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
                keyGenerator: async (_request: Request) => {
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

    // Every preset used to draw from one per-IP bucket, so a page polling a
    // read spent the budget a write elsewhere needed (2026-10-15: a 3s poll of
    // GET /api/folders made "New folder" answer 429).
    describe("Bucket isolation", () => {
        it("never lets two presets share a bucket, even on the same route and IP", async () => {
            const poll = createRateLimiter(RateLimitPresets.permissive);
            const write = createRateLimiter(RateLimitPresets.standard);
            const request = apiRequest("GET", "/api/folders");

            const lastAllowed = await spend(poll, request, 300);
            expect(lastAllowed.allowed).toBe(true);
            expect((await poll(request)).allowed).toBe(false);

            const other = await write(request);
            expect(other.allowed).toBe(true);
            expect(other.remaining).toBe(99);
        });

        it("keeps a stricter preset from draining a looser one", async () => {
            const strict = createRateLimiter(RateLimitPresets.strict);
            const permissive = createRateLimiter(RateLimitPresets.permissive);
            const request = apiRequest("POST", "/api/agents/documentQ&A/AIChat/query");

            await spend(strict, request, 20);
            expect((await strict(request)).allowed).toBe(false);
            expect((await permissive(request)).remaining).toBe(299);
        });

        it("gives the read and the write on one route separate budgets", async () => {
            const burst = createRateLimiter(RateLimitPresets.burst);
            await spend(burst, apiRequest("GET", "/api/folders"), 10);
            expect((await burst(apiRequest("GET", "/api/folders"))).allowed).toBe(false);

            const write = await burst(apiRequest("POST", "/api/folders"));
            expect(write.allowed).toBe(true);
            expect(write.remaining).toBe(9);
        });

        it("gives each route its own budget under the same preset", async () => {
            const strict = createRateLimiter(RateLimitPresets.strict);
            await spend(strict, apiRequest("POST", "/api/uploadDocument"), 20);
            expect((await strict(apiRequest("POST", "/api/uploadDocument"))).allowed).toBe(false);
            expect((await strict(apiRequest("POST", "/api/google-docs"))).allowed).toBe(true);
        });

        it("treats ids in the path as one route, so walking ids buys nothing", async () => {
            const limiter = createRateLimiter({ maxRequests: 2, windowMs: 60_000 });
            await limiter(apiRequest("DELETE", "/api/documents/101"));
            await limiter(apiRequest("DELETE", "/api/documents/102"));
            expect((await limiter(apiRequest("DELETE", "/api/documents/103"))).allowed).toBe(false);
            expect(
                (
                    await limiter(
                        apiRequest("DELETE", "/api/documents/7f1c2a9e-0b4d-4c55-9a51-2f0e8c1d3b6a")
                    )
                ).allowed
            ).toBe(false);
        });

        it("scopes a custom caller key to its route", async () => {
            const limiter = createRateLimiter({
                maxRequests: 1,
                windowMs: 60_000,
                keyGenerator: () => "user-1",
            });
            expect((await limiter(apiRequest("POST", "/api/prospects/runs"))).allowed).toBe(true);
            expect((await limiter(apiRequest("POST", "/api/prospects/runs"))).allowed).toBe(false);
            expect((await limiter(apiRequest("POST", "/api/prospects/outreach"))).allowed).toBe(
                true
            );
        });
    });

    describe("rateLimitRoute", () => {
        it("names a route by method and path with its ids collapsed", () => {
            expect(rateLimitRoute(apiRequest("GET", "/api/folders"))).toBe("GET /api/folders");
            expect(
                rateLimitRoute(apiRequest("POST", "/api/documents/12/versions/34/revert?x=1"))
            ).toBe("POST /api/documents/:id/versions/:id/revert");
            // A provider is a name, not an id: each provider keeps its own budget.
            expect(rateLimitRoute(apiRequest("POST", "/api/connectors/google-drive/sync"))).toBe(
                "POST /api/connectors/google-drive/sync"
            );
        });

        it("relies on no static API path segment containing a digit", () => {
            // rateLimitRoute reads any segment with a digit as an id. A static
            // segment with one (say /api/v2/...) would merge with its siblings'
            // budgets — rename it, or teach rateLimitRoute about it.
            const apiRoot = path.join(__dirname, "../../src/app/api");
            const offenders: string[] = [];
            const walk = (dir: string) => {
                for (const entry of readdirSync(dir, { withFileTypes: true })) {
                    if (!entry.isDirectory()) continue;
                    const dynamic = entry.name.startsWith("[") || entry.name.startsWith("(");
                    if (!dynamic && /\d/.test(entry.name)) {
                        offenders.push(path.relative(apiRoot, path.join(dir, entry.name)));
                    }
                    walk(path.join(dir, entry.name));
                }
            };
            walk(apiRoot);
            expect(offenders).toEqual([]);
        });
    });

    describe("Refill and Retry-After", () => {
        beforeEach(() => {
            jest.useFakeTimers({ now: new Date("2026-10-15T09:00:00Z") });
        });
        afterEach(() => {
            jest.useRealTimers();
        });

        it("keeps the partial token between requests", async () => {
            // One token per second.
            const limiter = createRateLimiter({ maxRequests: 2, windowMs: 2_000 });
            const request = apiRequest("GET", "/api/folders");
            await spend(limiter, request, 2);

            jest.advanceTimersByTime(600);
            expect((await limiter(request)).allowed).toBe(false);
            jest.advanceTimersByTime(600); // 1.2s: one token, 0.2s toward the next
            expect((await limiter(request)).allowed).toBe(true);
            jest.advanceTimersByTime(800); // 2.0s: the second token, thanks to the 0.2s kept
            expect((await limiter(request)).allowed).toBe(true);
            expect((await limiter(request)).allowed).toBe(false);
        });

        it("credits exactly one token per interval to a client polling faster than that", async () => {
            const limiter = createRateLimiter(RateLimitPresets.permissive); // a token every 3s
            const request = apiRequest("GET", "/api/folders");
            await spend(limiter, request, 300);
            // Requests every 2s earn a token every 3s — exactly 2 in 3 succeed.
            let allowed = 0;
            for (let i = 0; i < 90; i++) {
                jest.advanceTimersByTime(2_000);
                if ((await limiter(request)).allowed) allowed++;
            }
            expect(allowed).toBe(60);
        });

        it("tells a blocked caller when the next request will work, not when the window ends", async () => {
            const limiter = createRateLimiter(RateLimitPresets.permissive);
            const request = apiRequest("GET", "/api/folders");
            await spend(limiter, request, 300);

            const blocked = await limiter(request);
            expect(blocked.allowed).toBe(false);
            expect(blocked.retryAfter).toBe(3);

            jest.advanceTimersByTime(3_000);
            expect((await limiter(request)).allowed).toBe(true);
        });

        it("reports when the bucket is full again", async () => {
            const limiter = createRateLimiter({ maxRequests: 10, windowMs: 10_000 });
            const request = apiRequest("GET", "/api/folders");
            const info = await spend(limiter, request, 4);
            expect(info.remaining).toBe(6);
            expect(info.resetTime).toBe(Date.now() + 4_000);
        });
    });
});
