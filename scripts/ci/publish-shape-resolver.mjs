/**
 * Module-resolution hook for scripts/ci/check-package-exports.mjs (ADR-002).
 *
 * @launchstack/core is a facade: its dist re-exports from the four sibling
 * engine packages. An npm consumer resolves those siblings through each
 * package's *published* exports map (publishConfig.exports → dist/). In the
 * workspace, however, node_modules symlinks resolve through the packages'
 * DEV exports maps, which point at src/*.ts — un-loadable under plain Node.
 *
 * This hook reproduces the published resolution: any import of
 * @launchstack/{protocol,evidence,application,adapters} is mapped through
 * that package's publishConfig.exports onto its built dist/ output, exactly
 * what `pnpm pack` + `npm install` would produce. Relative imports inside
 * dist and third-party packages resolve normally.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL("../../", import.meta.url).pathname;
const SIBLINGS = ["protocol", "evidence", "application", "adapters"];

const packages = new Map();
for (const name of SIBLINGS) {
  const dir = join(ROOT, "packages", name);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  packages.set(`@launchstack/${name}`, {
    dir,
    exports: pkg.publishConfig?.exports ?? pkg.exports,
  });
}

/** Resolve a subpath ("." or "./db/index") against a published exports map. */
function matchExport(exportsMap, subpath) {
  const exact = exportsMap[subpath];
  if (exact !== undefined) {
    return typeof exact === "string" ? exact : exact.default;
  }
  // Wildcard patterns ("./*"): longest matching prefix wins, per Node's
  // PATTERN_KEY_COMPARE. Our maps only ever use a single `*`.
  let best = null;
  for (const [key, value] of Object.entries(exportsMap)) {
    const star = key.indexOf("*");
    if (star === -1) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (
      subpath.length >= prefix.length + suffix.length &&
      subpath.startsWith(prefix) &&
      subpath.endsWith(suffix)
    ) {
      if (best === null || prefix.length > best.prefixLength) {
        const captured = subpath.slice(prefix.length, subpath.length - suffix.length);
        const target = typeof value === "string" ? value : value.default;
        best = { prefixLength: prefix.length, target: target.replace("*", captured) };
      }
    }
  }
  return best?.target ?? null;
}

export function resolve(specifier, context, nextResolve) {
  const m = /^(@launchstack\/[a-z-]+)(?:\/(.+))?$/.exec(specifier);
  if (m && packages.has(m[1])) {
    const { dir, exports } = packages.get(m[1]);
    const subpath = m[2] ? `./${m[2]}` : ".";
    const target = matchExport(exports, subpath);
    if (target) {
      return {
        url: pathToFileURL(join(dir, target)).href,
        shortCircuit: true,
      };
    }
  }
  return nextResolve(specifier, context);
}
