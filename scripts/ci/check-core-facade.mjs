#!/usr/bin/env node
/**
 * ADR-002: @launchstack/core is a compatibility facade — re-exports only,
 * no business logic. This gate fails when a file under packages/core/src
 * contains anything besides comments, re-export statements, and type-only
 * declarations that alias re-exports.
 *
 * Allowed file content: `export ... from "..."`, `export type ... from`,
 * `import ... from` immediately re-exported, comments, and blank lines.
 * Everything else (function bodies, classes, consts with initializers other
 * than re-export aliases) is new business logic and belongs in
 * packages/{protocol,evidence,application,adapters}.
 *
 * Run locally: node scripts/ci/check-core-facade.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const CORE_SRC = join(ROOT, "packages/core/src");

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry)) yield full;
  }
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * A facade file consists only of these statement shapes (after comment
 * stripping). Multi-line statements are joined before matching.
 */
const ALLOWED_STATEMENT = new RegExp(
  [
    String.raw`^export\s+(type\s+)?\*(\s+as\s+\w+)?\s+from\s+["'][^"']+["'];?$`,
    String.raw`^export\s+(type\s+)?\{[^}]*\}\s*from\s+["'][^"']+["'];?$`,
    // Type alias / interface re-declarations that only reference imports
    // are tolerated when they carry no implementation.
    String.raw`^import\s+(type\s+)?\{[^}]*\}\s*from\s+["'][^"']+["'];?$`,
    String.raw`^import\s+type\s+\w+\s+from\s+["'][^"']+["'];?$`,
    String.raw`^export\s+\{\s*\};?$`,
  ].join("|"),
);

const failures = [];
for (const file of walk(CORE_SRC)) {
  const source = stripComments(readFileSync(file, "utf8"));
  // Join continuation lines: a statement ends at `;` or a line ending in a
  // quote-terminated from clause.
  const statements = source
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((s) => `${s};`);
  const offending = statements.filter((s) => !ALLOWED_STATEMENT.test(s));
  if (offending.length > 0) {
    failures.push({
      file: relative(ROOT, file),
      sample: offending[0].slice(0, 120),
      count: offending.length,
    });
  }
}

if (failures.length > 0) {
  console.error(
    `check-core-facade: ${failures.length} file(s) under packages/core/src contain more than re-exports (ADR-002):`,
  );
  for (const f of failures) {
    console.error(`  - ${f.file} (${f.count} statement(s), e.g. \`${f.sample}\`)`);
  }
  console.error(
    "Move implementation into packages/{protocol,evidence,application,adapters} and re-export from core.",
  );
  process.exit(1);
}
console.log("check-core-facade: ok — packages/core/src is re-exports only");
