import { pgTableCreator } from "drizzle-orm/pg-core";

/**
 * Ensures all tables share the same prefix so we can safely split the schema
 * across multiple modules while keeping consistent naming.
 */
export const pgTable = pgTableCreator((name) => `pdr_ai_v2_${name}`);
