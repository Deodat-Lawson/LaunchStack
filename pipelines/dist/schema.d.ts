/**
 * Product schema owned by the feature verticals.
 *
 * Same side of the boundary as apps/web: may reference engine tables from
 * @launchstack/store/schema, never the reverse. These live here rather than
 * in apps/web because a package cannot import from an app, and they belong to
 * the verticals that query them.
 *
 * Applied by the product migration set (apps/web/drizzle), whose drizzle config
 * globs both this package and apps/web.
 */
export * from "./trend-search/schema.js";
export * from "./trend-search/cache-schema.js";
export * from "./client-prospector/schema.js";
export * from "./company-metadata/schema.js";
export * from "./marketing/schema.js";
export * from "./founder-weekly-review/schema.js";
export * from "./email/schema.js";
export * from "./repo-workspace/schema.js";
//# sourceMappingURL=schema.d.ts.map