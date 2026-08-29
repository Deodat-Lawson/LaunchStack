/**
 * Product schema — tables the application owns.
 *
 * May reference engine tables from @launchstack/core/db/schema; the reverse is
 * forbidden and enforced by ESLint (core cannot import ~/* or features).
 *
 * Import engine tables from "@launchstack/store/schema" directly — this
 * barrel deliberately does not re-export them, so which side of the boundary a
 * table lives on stays obvious at the import site.
 */
export * from "./auth";
export * from "./identity";
export * from "./connectors";
export * from "./document-features";
export * from "./agent-ai";
export * from "./collab";
export * from "./credits";
export * from "./document-notes";
export * from "./mindmap";

// Feature-vertical tables live in packages/features (a package cannot import
// from an app). Same side of the boundary, same product migration set.
export * from "@launchstack/pipelines/schema";
