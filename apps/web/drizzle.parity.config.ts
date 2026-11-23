/**
 * CI-only reconstruction of the complete schema in a deliberately empty database.
 * Drizzle 0.31 can propose dropping the other set's serial sequences when two
 * filtered pushes run sequentially. One combined target preserves all sequences;
 * published engine/product sources and forward migration runners stay separate.
 */
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import type { Config } from "drizzle-kit";
import * as engineSchema from "../../packages/store/src/db/schema";
import * as productSchema from "./src/server/db/schema";

const raw = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!raw) throw new Error("Parity database URL required");
const target = new URL(raw);
if (
    process.env.CI !== "true" ||
    process.env.LAUNCHSTACK_ALLOW_PUSH !== "1" ||
    !["localhost", "127.0.0.1"].includes(target.hostname) ||
    !["/ls_push", "/vantage_schema_typescript_20261109"].includes(target.pathname)
)
    throw new Error("Parity reconstruction is restricted to the empty CI test database");

const tableNames = new Set<string>();
for (const value of [...Object.values(engineSchema), ...Object.values(productSchema)]) {
    if (is(value, PgTable)) tableNames.add(getTableName(value));
}
export default {
    schema: [
        "../../packages/store/src/db/schema.ts",
        "./src/server/db/schema/*.ts",
        "../../pipelines/src/*/schema.ts",
        "../../pipelines/src/*/cache-schema.ts",
    ],
    out: "../../test-output/vantage-production-verification/parity-schema",
    dialect: "postgresql",
    dbCredentials: { url: raw },
    tablesFilter: [...tableNames],
} satisfies Config;
