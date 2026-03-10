/**
 * Study Agent API Shared Utilities
 * Role: common helpers reused across study-agent API routes.
 * Purpose: avoid repeating auth/session parsing and BigInt serialization.
 */

/**
 * Parse a `sessionId` from query params; returns undefined when absent/invalid.
 */
export function parseSessionId(request: Request): number | undefined {
  const sessionIdParam = new URL(request.url).searchParams.get("sessionId");
  const parsedSessionId = sessionIdParam ? Number(sessionIdParam) : undefined;
  return Number.isNaN(parsedSessionId) ? undefined : parsedSessionId;
}

/**
 * Recursively convert BigInt values to numbers/strings for JSON safety.
 * Note: caller should ensure large values will not overflow JS number range.
 */
export function serializeBigInt<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "bigint") return Number(obj) as unknown as T;
  if (Array.isArray(obj)) return obj.map(serializeBigInt) as unknown as T;
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeBigInt(value);
    }
    return result as T;
  }
  return obj;
}

