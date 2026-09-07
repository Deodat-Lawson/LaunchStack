/**
 * Rewrite relative import/export specifiers in the built output so the package
 * is loadable by plain Node ESM.
 *
 * Why this exists: tsconfig.build.json compiles with
 * `module: ESNext` + `moduleResolution: Bundler`, and TypeScript deliberately
 * emits specifiers verbatim — `export { x } from "./vector-retriever"`. That is
 * fine for a bundler, but `packages/core` is `"type": "module"`, so the emitted
 * files are real ESM and Node requires a full path with an extension. Without
 * this step:
 *
 *   import("@launchstack/retrieval/retrievers")
 *   → ERR_MODULE_NOT_FOUND: Cannot find module '.../dist/rag/retrievers/vector-retriever'
 *
 * `publint` does NOT catch this — it validates the exports map against the
 * tarball, not every relative specifier inside the emitted JS. We verified a
 * tarball that passed publint and still failed to import. scripts/ci/
 * check-package-exports.mjs is the regression guard.
 *
 * The alternative is switching the source to `moduleResolution: NodeNext` and
 * writing `./foo.js` in several hundred source imports. That is the more
 * orthodox fix and worth doing eventually; this keeps the source untouched.
 *
 * Rewrites both .js (runtime correctness) and .d.ts (so consumers under
 * NodeNext resolve the types).
 */

import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const DIST = resolve(import.meta.dirname, "../dist");

// Matches the specifier in `from "..."`, `import "..."`, and dynamic `import("...")`
// but only for relative paths — bare package names must not be touched.
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(?\s*)(["'])(\.[^"']*)\2/g;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

/**
 * Resolve what a bundler-style specifier should become on disk.
 * "./db" → "./db/index.js" when db/ is a directory, else "./db.js".
 * Already-suffixed specifiers are left alone.
 */
function resolveSpecifier(spec, fileDir, isDeclaration) {
  const jsExt = isDeclaration ? ".d.ts" : ".js";
  if (spec.endsWith(".js") || spec.endsWith(".mjs") || spec.endsWith(".json")) {
    return spec;
  }

  const abs = resolve(fileDir, spec);

  // Directory with an index file → point at the index.
  if (existsSync(abs) && existsSync(join(abs, `index${jsExt}`))) {
    return `${spec.replace(/\/$/, "")}/index.js`;
  }
  // Sibling module.
  if (existsSync(`${abs}${jsExt}`)) {
    return `${spec}.js`;
  }
  // A type-only module emits no .js. Declarations still need the reference, and
  // for runtime files the import was erased anyway — leave it and let the
  // exports check catch anything genuinely missing.
  if (isDeclaration && existsSync(`${abs}.d.ts`)) {
    return `${spec}.js`;
  }
  return null;
}

let filesChanged = 0;
let specifiersRewritten = 0;
const unresolved = [];

for await (const file of walk(DIST)) {
  const isDeclaration = file.endsWith(".d.ts");
  if (!file.endsWith(".js") && !isDeclaration) continue;

  const original = await readFile(file, "utf8");
  const fileDir = dirname(file);

  const updated = original.replace(SPECIFIER, (match, prefix, quote, spec) => {
    const next = resolveSpecifier(spec, fileDir, isDeclaration);
    if (next === null) {
      unresolved.push(`${file.slice(DIST.length + 1)} → ${spec}`);
      return match;
    }
    if (next === spec) return match;
    specifiersRewritten++;
    return `${prefix}${quote}${next}${quote}`;
  });

  if (updated !== original) {
    await writeFile(file, updated);
    filesChanged++;
  }
}

console.log(
  `[fix-esm-specifiers] rewrote ${specifiersRewritten} specifier(s) across ${filesChanged} file(s)`,
);

if (unresolved.length > 0) {
  console.warn(
    `[fix-esm-specifiers] ${unresolved.length} specifier(s) had no file on disk:`,
  );
  for (const u of unresolved.slice(0, 20)) console.warn(`  ${u}`);
}
