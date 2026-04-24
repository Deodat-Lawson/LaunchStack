/**
 * In-memory cache for trend search results.
 * Reduces redundant API calls (Exa/Serper) and LLM work when the same
 * query + company context is used within the TTL window.
 */
import { createHash } from "node:crypto";
import type { TrendSearchOutput } from "./types";

const TTL_MS = 60 * 60 * 1000; // 1 hour – trends don't change that fast

interface CacheEntry {
  output: TrendSearchOutput;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function buildCacheKey(query: string, companyContext: string): string {
  const normalized = `${query.trim().replace(/\s+/g, " ")}::${companyContext.trim().replace(/\s+/g, " ")}`;
  return createHash("sha256").update(normalized).digest("hex");
}

function prune(): void {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

export function getCachedTrendSearch(
  query: string,
  companyContext: string,
): TrendSearchOutput | null {
  const key = buildCacheKey(query, companyContext);
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.output;
}

export function setCachedTrendSearch(
  query: string,
  companyContext: string,
  output: TrendSearchOutput,
): void {
  if (cache.size > 100) {
    prune();
  }
  const key = buildCacheKey(query, companyContext);
  cache.set(key, {
    output,
    expiresAt: Date.now() + TTL_MS,
  });
}
