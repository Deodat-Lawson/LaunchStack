import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

// Use postgres.js for compatibility with standard PostgreSQL (Docker, local, etc.)
const client = postgres(process.env.DATABASE_URL!, { max: 10 });
export const db = drizzle(client, { schema });

/** Extract rows from db.execute() result (postgres.js returns array directly) */
export function toRows<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : []) as T[];
}