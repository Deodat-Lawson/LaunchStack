/**
 * Moved to @launchstack/tools/company-context/schema (unification PR-1): the
 * company-metadata JSON shapes and tables are the shared data contract between
 * this extraction vertical (producer) and the company-context tool (consumer),
 * so they live in the tools layer. This re-export keeps every existing import
 * path — including the drizzle schema glob in apps/web/drizzle.config.ts —
 * working unchanged. New code should import from the tool subpath directly.
 */
export * from "@launchstack/tools/company-context/schema";
