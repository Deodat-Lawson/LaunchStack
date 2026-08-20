/**
 * Product schema owned by the feature verticals.
 *
 * Same side of the boundary as apps/web: may reference engine tables from
 * @launchstack/core/db/schema, never the reverse. These live here rather than
 * in apps/web because a package cannot import from an app, and they belong to
 * the verticals that query them.
 *
 * Applied by the product migration set (apps/web/drizzle), whose drizzle config
 * globs both this package and apps/web.
 */
export * from "./trend-search/schema";
export * from "./trend-search/cache-schema";
export * from "./client-prospector/schema";
export * from "./company-metadata/schema";
export * from "./marketing-pipeline/schema";
export * from "./founder-weekly-review/schema";
export * from "./call-notes/schema";
