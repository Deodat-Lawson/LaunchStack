/**
 * Module-resolution hook for scripts/ci/check-package-exports.mjs (ADR-008).
 *
 * The feature packages depend on each other (conversion → orchestration →
 * store → runtime, …). An npm consumer resolves those dependencies through
 * each package's *published* exports map (publishConfig.exports → dist/).
 * In the workspace, node_modules symlinks resolve through the packages'
 * DEV exports maps, which point at src/*.ts — un-loadable under plain Node.
 *
 * This hook reproduces the published resolution: any import of a workspace
 * @launchstack/* package is mapped through that package's publishConfig
 * exports onto its built dist/ output, exactly what `pnpm pack` +
 * `npm install` would produce. Relative imports inside dist and third-party
 * packages resolve normally.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL("../../", import.meta.url).pathname;

const packages = new Map();
function registerDir(dir) {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (!pkg.name?.startsWith("@launchstack/")) return;
  if (pkg.private || !pkg.publishConfig?.exports) return;
  packages.set(pkg.name, { dir, exports: pkg.publishConfig.exports });
}
for (const entry of readdirSync(join(ROOT, "packages"))) {
  registerDir(join(ROOT, "packages", entry));
}
registerDir(join(ROOT, "pipelines"));

/** Resolve a subpath ("." or "./client") against a published exports map. */
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
  for (const [name, { dir, exports: exportsMap }] of packages) {
    if (specifier === name || specifier.startsWith(`${name}/`)) {
      const subpath = specifier === name ? "." : `./${specifier.slice(name.length + 1)}`;
      const target = matchExport(exportsMap, subpath);
      if (!target) {
        throw new Error(
          `[publish-shape-resolver] ${specifier}: no publishConfig export for "${subpath}"`,
        );
      }
      return {
        url: pathToFileURL(join(dir, target)).href,
        shortCircuit: true,
      };
    }
  }
  return nextResolve(specifier, context);
}
