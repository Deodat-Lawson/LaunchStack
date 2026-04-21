import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

// Lightweight db client for hot API routes that do not need schema-wide typing.
const coreClient = postgres(process.env.DATABASE_URL!, { max: 10 });
export const dbCore = drizzle(coreClient);
