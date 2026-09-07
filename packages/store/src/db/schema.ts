/**
 * Engine schema — every table the engine owns and publishes.
 *
 * The product schema lives in apps/web/src/server/db/schema and packages/features
 * and may reference these tables. Nothing here may reference it: that one-way
 * rule is what makes `packages/core/drizzle` applicable on its own by an
 * embedding consumer. ESLint enforces the import direction.
 */
export { pgTable } from "./schema/helpers";
export * from "./schema/base";
export * from "./schema/company-credentials";
export * from "./schema/rlm-knowledge-base";
export * from "./schema/knowledge-graph";
export * from "./schema/ops";
export * from "./schema/outbox";
