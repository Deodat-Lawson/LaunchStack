#!/usr/bin/env node
/**
 * Enforces the engine/product schema boundary.
 *
 * @launchstack/store is published and open source. For a consumer to embed it,
 * `packages/store/drizzle` must build a working database on its own — which
 * holds only while no engine table references a product table.
 *
 * The dependency is one-way by design:
 *
 *     apps/web  ─┐
 *                ├──> packages/store  (engine tables)
 *  pipelines/ ────────┘
 *
 * ESLint already forbids core from importing `~/*` or `@launchstack/features`,
 * which is what a foreign key would require. This check is the schema-level
 * backstop: it reads the generated SQL and asserts the engine baseline never
 * references a table the engine does not create. That catches a hand-edited
 * migration, which ESLint cannot see.
 *
 *   node scripts/ci/check-schema-boundary.mjs
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ENGINE_DIR = "packages/store/drizzle";
const PRODUCT_DIR = "apps/web/drizzle";

const problems = [];

async function sqlOf(dir) {
  let files;
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    problems.push(`${dir} does not exist — run db:generate`);
    return "";
  }
  const parts = await Promise.all(files.map((f) => readFile(join(dir, f), "utf8")));
  return parts.join("\n");
}

const engineSql = await sqlOf(ENGINE_DIR);
const productSql = await sqlOf(PRODUCT_DIR);

const created = (sql) =>
  new Set([...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"([^"]+)"/g)].map((m) => m[1]));
const referenced = (sql) =>
  new Set([...sql.matchAll(/REFERENCES "(?:public"\.")?([^"]+)"/g)].map((m) => m[1]));

const engineTables = created(engineSql);
const productTables = created(productSql);

// 1. The engine must be closed: every table it references, it also creates.
for (const t of referenced(engineSql)) {
  if (!engineTables.has(t)) {
    problems.push(
      `engine migrations reference "${t}", which the engine does not create.` +
        (productTables.has(t)
          ? " That is a product table — the engine must never depend on one."
          : ""),
    );
  }
}

// 2. The two sets must not both create the same table.
for (const t of productTables) {
  if (engineTables.has(t)) {
    problems.push(`"${t}" is created by BOTH migration sets`);
  }
}

// 3. Product may reference engine tables (expected), but not unknown ones.
const known = new Set([...engineTables, ...productTables]);
for (const t of referenced(productSql)) {
  if (!known.has(t)) {
    problems.push(`product migrations reference unknown table "${t}"`);
  }
}

if (problems.length > 0) {
  console.error("::error::engine/product schema boundary violated\n");
  problems.forEach((p) => console.error(`  - ${p}`));
  console.error(
    "\nThe engine must stand alone: `packages/store/drizzle` is what an embedding\n" +
      "consumer applies. Product tables may point at engine tables, never the reverse.",
  );
  process.exit(1);
}

console.log(
  `[check-schema-boundary] ok — engine creates ${engineTables.size} table(s) and ` +
    `references only its own; product creates ${productTables.size} and depends on the engine one-way`,
);
