/**
 * Central export for all database tables and relations. The schema is now
 * split across multiple modules so that each domain can evolve independently
 * while consumers continue importing from "~/server/db/schema".
 */
export { pgTable } from "./schema/helpers";
export * from "./schema/base";
export * from "./schema/agent-ai";
export * from "./schema/study-agent";
export { studyAgentMessages } from "./schema/study-agent";
export * from "./schema/rlm-knowledge-base";
export * from "./schema/knowledge-graph";
export * from "./schema/trend-search";
