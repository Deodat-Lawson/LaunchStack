/**
 * X-API-Key authentication for every non-/health endpoint.
 *
 * Mirrors `sidecar/app/auth.py`: fail closed (an unset or empty key rejects
 * every request rather than serving an open endpoint) and compare in
 * constant time so a wrong key cannot be recovered by timing the response.
 * `/health` stays unauthenticated because the Docker healthcheck calls it
 * with no headers.
 *
 * The old ocr-router (8002) and ocr-worker (8001) had no auth at all while
 * being published to the host — that defect ends here.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

import type { Config } from "./config.js";
import { errorEnvelope } from "./errors.js";

/**
 * Constant-time comparison. Hashing both sides first gives equal-length
 * buffers for `timingSafeEqual` without leaking the expected key's length.
 */
export function timingSafeKeyMatch(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function apiKeyMiddleware(config: Config): RequestHandler {
  return (req, res, next) => {
    const provided = req.header("x-api-key") ?? "";
    if (
      !config.apiKey ||
      !provided ||
      !timingSafeKeyMatch(provided, config.apiKey)
    ) {
      const traceId = res.locals.traceId as string | undefined;
      res
        .status(401)
        .json(errorEnvelope("unauthorized", "Unauthorized", traceId));
      return;
    }
    next();
  };
}
