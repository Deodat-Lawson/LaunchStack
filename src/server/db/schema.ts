/**
 * Central export for all database tables and relations. The schema is now
 * split across multiple modules so that each domain can evolve independently
 * while consumers continue importing from "~/server/db/schema".
 */
export { pgTable } from "./schema/helpers";
export * from "./schema/base";
export * from "./schema/agent-ai";
export * from "./schema/rlm-knowledge-base";
export * from "./schema/knowledge-graph";
export * from "./schema/document-notes";
export * from "./schema/trend-search";
export * from "./schema/company-metadata";
export * from "./schema/marketing-history";
