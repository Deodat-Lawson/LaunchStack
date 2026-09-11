import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { type Config } from "drizzle-kit";

import * as productSchema from "./src/server/db/schema";

const HERE = fileURLToPath(new URL(".", import.meta.url));
dotenv.config({ path: resolve(HERE, "../../.env") });

/**
 * Product migration set — every table the application and its feature
 * verticals own.
 *
 * Engine tables are deliberately outside this glob: drizzle-kit reads only what
 * it is given, so it emits the foreign keys pointing at engine tables without
 * trying to create them. `tablesFilter` is derived from the product schema for
 * the same reason it is on the engine side — both sets live in one database
 * behind one prefix, and a `pdr_ai_v2_*` glob would make each set offer to drop
 * the other's tables.
 *
 * Applied AFTER the engine set; see `db:migrate` in package.json.
 */
const productTables: string[] = [];
for (const value of Object.values(productSchema)) {
    // drizzle's `is` narrows, so no hand-written type predicate is needed.
    if (is(value, PgTable)) productTables.push(getTableName(value));
}

export default {
    schema: [
        "./src/server/db/schema/*.ts",
        "../../pipelines/src/*/schema.ts",
        "../../pipelines/src/*/cache-schema.ts",
    ],
    out: "./drizzle",
    dialect: "postgresql",
    migrations: { prefix: "timestamp" },
    dbCredentials: {
        url: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL!,
    },
    tablesFilter: productTables,
} satisfies Config;
