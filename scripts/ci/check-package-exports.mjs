/**
 * Verify every `exports` subpath of @launchstack/core — and the root export of
 * each sibling engine package (@launchstack/{protocol,evidence,application,
 * adapters}) — is actually loadable from the built output, the way an npm
 * consumer would load it.
 *
 * This exists because `publint` passed a tarball that could not be imported:
 * tsc emits bundler-style extensionless specifiers (`from "./db"`), the package
 * is `"type": "module"`, and Node ESM rejects those with ERR_MODULE_NOT_FOUND.
 * publint validates the exports map against the tarball contents; it does not
 * follow every relative specifier inside the emitted JS. So the shape looked
 * correct while the package was unusable.
 *
 * Run after building all five publishable packages:
 *   pnpm --filter @launchstack/protocol --filter @launchstack/evidence \
 *     --filter @launchstack/application --filter @launchstack/adapters \
 *     --filter @launchstack/core build
 *   node scripts/ci/check-package-exports.mjs
 *
 * Exit codes: 0 ok · 1 an export failed to load · 2 dist/ missing
 *
 * Optional peer dependencies (@langchain/community, langchain, neo4j-driver,
 * tesseract.js) are expected to be absent in a minimal consumer install. A
 * subpath that fails *only* because one of those is missing is reported as
 * "peer-gated", not a failure — that is the design.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { register } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ADR-002: core is a facade whose dist re-exports the sibling engine packages
// (@launchstack/{protocol,evidence,application,adapters}). An npm consumer
// resolves those through each package's published exports map (dist/); the
// workspace symlinks would resolve them through the dev maps (src/*.ts),
// which plain Node cannot load. Registering this hook makes every dynamic
// import below see the published shape — the thing this gate exists to test.
register(new URL("./publish-shape-resolver.mjs", import.meta.url));

const PACKAGES = resolve(import.meta.dirname, "../../packages");
const CORE = join(PACKAGES, "core");
const DIST = join(CORE, "dist");

// The sibling engine packages core's facade re-exports (ADR-002). Their dist
// was once published as plain `tsc` output — extensionless relative specifiers
// that Node ESM rejects — so their root exports are verified here too, through
// the publish-shape resolver, exactly as an npm consumer loads them.
const SIBLINGS = ["protocol", "evidence", "application", "adapters"];

for (const name of ["core", ...SIBLINGS]) {
  if (!existsSync(join(PACKAGES, name, "dist"))) {
    console.error(
      `[check-package-exports] packages/${name}/dist not found — run ` +
        `\`pnpm --filter @launchstack/${name} build\` first`,
    );
    process.exit(2);
  }
}

const pkg = JSON.parse(await readFile(join(CORE, "package.json"), "utf8"));
const publishExports = pkg.publishConfig?.exports ?? pkg.exports;

const OPTIONAL_PEERS = new Set(Object.keys(pkg.peerDependencies ?? {}));

/** Map a publishConfig target ("./dist/rag/index.js") to an absolute path. */
function distPath(target) {
  return resolve(CORE, target);
}

const failures = [];
const peerGated = [];
let ok = 0;
let skipped = 0;

for (const [subpath, entry] of Object.entries(publishExports)) {
  const target = typeof entry === "string" ? entry : entry.default;
  if (!target) continue;

  // Wildcard subpaths cannot be loaded directly; they are covered by whichever
  // concrete file a consumer names. Report so a silent gap is visible.
  if (subpath.includes("*") || target.includes("*")) {
    skipped++;
    console.log(`  ~ ${subpath} (wildcard — not directly loadable)`);
    continue;
  }

  const abs = distPath(target);
  if (!existsSync(abs)) {
    failures.push({ subpath, reason: `missing file: ${target}` });
    continue;
  }

  try {
    await import(pathToFileURL(abs).href);
    ok++;
  } catch (err) {
    const message = String(err?.message ?? err);
    const missingPeer = [...OPTIONAL_PEERS].find((p) => message.includes(p));
    if (err?.code === "ERR_MODULE_NOT_FOUND" && missingPeer) {
      peerGated.push({ subpath, peer: missingPeer });
      continue;
    }
    failures.push({ subpath, reason: `${err?.code ?? "error"}: ${message.split("\n")[0]}` });
  }
}

// Root export of each sibling engine package, imported by bare specifier so
// the registered publish-shape resolver maps it (and everything it pulls in)
// through publishConfig.exports onto dist/ — the exact path an npm consumer
// takes. This catches a sibling whose build skipped fix-esm-specifiers.mjs,
// which would otherwise only surface transitively through core or adapters.
let siblingsOk = 0;
for (const name of SIBLINGS) {
  const specifier = `@launchstack/${name}`;
  const sibPkg = JSON.parse(
    await readFile(join(PACKAGES, name, "package.json"), "utf8"),
  );
  const sibPeers = new Set(Object.keys(sibPkg.peerDependencies ?? {}));

  try {
    await import(specifier);
    siblingsOk++;
  } catch (err) {
    const message = String(err?.message ?? err);
    const missingPeer = [...sibPeers].find((p) => message.includes(p));
    if (err?.code === "ERR_MODULE_NOT_FOUND" && missingPeer) {
      peerGated.push({ subpath: `${specifier} "."`, peer: missingPeer });
      continue;
    }
    failures.push({
      subpath: `${specifier} "."`,
      reason: `${err?.code ?? "error"}: ${message.split("\n")[0]}`,
    });
  }
}

for (const { subpath, peer } of peerGated) {
  console.log(`  · ${subpath} (needs optional peer "${peer}" — expected)`);
}

if (failures.length > 0) {
  console.error(
    `\n[check-package-exports] ${failures.length} export(s) are not loadable:\n`,
  );
  for (const { subpath, reason } of failures) {
    console.error(`  ✗ ${subpath}\n      ${reason}`);
  }
  console.error(
    "\nIf these are ERR_MODULE_NOT_FOUND on a relative path, the build did not\n" +
      "rewrite specifiers for Node ESM — check that the failing package's build\n" +
      "runs its scripts/fix-esm-specifiers.mjs after tsc (every publishable\n" +
      "package — protocol, evidence, application, adapters, core — has one).\n",
  );
  process.exit(1);
}

console.log(
  `\n[check-package-exports] ok — ${ok} core export(s) + ${siblingsOk} sibling ` +
    `root export(s) (protocol, evidence, application, adapters) load under ` +
    `Node ESM, ${peerGated.length} peer-gated, ${skipped} wildcard`,
);
