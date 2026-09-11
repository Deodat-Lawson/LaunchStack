/**
 * Verify every `publishConfig.exports` subpath of every publishable
 * @launchstack/* package is actually loadable from the built output, the way
 * an npm consumer would load it (ADR-008).
 *
 * This exists because `publint` once passed a tarball that could not be
 * imported: tsc emits bundler-style extensionless specifiers (`from "./db"`),
 * the packages are `"type": "module"`, and Node ESM rejects those with
 * ERR_MODULE_NOT_FOUND. publint validates the exports map against the tarball
 * contents; it does not follow every relative specifier inside the emitted
 * JS. So the shape looked correct while the package was unusable.
 *
 * Run after building the publishable packages (pnpm -r build), then:
 *   node scripts/ci/check-package-exports.mjs
 *
 * Exit codes: 0 ok · 1 an export failed to load · 2 dist/ missing
 *
 * Optional peer dependencies (neo4j-driver, tesseract.js, …) are expected to
 * be absent in a minimal consumer install. A subpath that fails *only*
 * because one of those is missing is reported as "peer-gated", not a failure.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { register } from "node:module";
import { join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

register(new URL("./publish-shape-resolver.mjs", import.meta.url));

const ROOT = resolvePath(import.meta.dirname, "../..");

const targets = [];
for (const entry of readdirSync(join(ROOT, "packages"))) {
  const dir = join(ROOT, "packages", entry);
  if (existsSync(join(dir, "package.json"))) targets.push(dir);
}
targets.push(join(ROOT, "pipelines"));

const failures = [];
const peerGated = [];
let ok = 0;
let skipped = 0;

for (const dir of targets) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  if (!pkg.name?.startsWith("@launchstack/")) continue;
  if (pkg.private || !pkg.publishConfig?.exports) continue;

  if (!existsSync(join(dir, "dist"))) {
    console.error(
      `[check-package-exports] ${pkg.name}: dist/ not found — run ` +
        `\`pnpm --filter ${pkg.name} build\` first`,
    );
    process.exit(2);
  }

  const peers = new Set(Object.keys(pkg.peerDependencies ?? {}));

  for (const [subpath, entry] of Object.entries(pkg.publishConfig.exports)) {
    const target = typeof entry === "string" ? entry : entry.default;
    if (!target) continue;
    if (subpath === "./package.json") { ok++; continue; }
    if (subpath.includes("*") || target.includes("*")) {
      skipped++;
      console.log(`  ~ ${pkg.name}${subpath.slice(1)} (wildcard — not directly loadable)`);
      continue;
    }
    const abs = resolvePath(dir, target);
    if (!existsSync(abs)) {
      failures.push({ pkg: pkg.name, subpath, reason: `missing file: ${target}` });
      continue;
    }
    try {
      await import(pathToFileURL(abs).href);
      ok++;
    } catch (err) {
      const message = String(err?.message ?? err);
      const missingPeer = [...peers].find((p) => message.includes(p));
      if (err?.code === "ERR_MODULE_NOT_FOUND" && missingPeer) {
        peerGated.push({ pkg: pkg.name, subpath, peer: missingPeer });
        continue;
      }
      failures.push({
        pkg: pkg.name,
        subpath,
        reason: `${err?.code ?? "error"}: ${message.split("\n")[0]}`,
      });
    }
  }
}

for (const { pkg, subpath, peer } of peerGated) {
  console.log(`  ○ ${pkg}${subpath.slice(1)} (peer-gated on ${peer})`);
}
if (failures.length > 0) {
  console.error(`[check-package-exports] ${failures.length} export(s) failed to load:`);
  for (const { pkg, subpath, reason } of failures) {
    console.error(`  ✗ ${pkg}${subpath.slice(1)} — ${reason}`);
  }
  process.exit(1);
}
console.log(
  `[check-package-exports] ok — ${ok} exports load, ${peerGated.length} peer-gated, ${skipped} wildcard`,
);
