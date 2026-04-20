/**
 * Persistent cache for trend search results.
 * Survives serverless cold starts; dramatically reduces latency for repeated
 * or similar queries (e.g. marketing pipeline runs with same prompt + context).
 */
import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { jsonb, timestamp, varchar } from "drizzle-orm/pg-core";
import { pgTable } from "./helpers";

export const trendSearchCache = pgTable("trend_search_cache", {
  cacheKey: varchar("cache_key", { length: 64 }).primaryKey(),
  output: jsonb("output").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export type TrendSearchCacheEntry = InferSelectModel<typeof trendSearchCache>;
