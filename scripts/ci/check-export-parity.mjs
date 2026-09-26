/**
 * Verify every publishable @launchstack/* package publishes exactly the
 * subpaths the workspace exposes (ADR-008).
 *
 * Each package carries two hand-maintained export maps: `exports`, which the
 * workspace resolves (src/*.ts), and `publishConfig.exports`, which replaces
 * it in the published tarball (dist/*.js + .d.ts). A subpath added to
 * `exports` alone works everywhere in the repo and in CI, and is missing
 * only for npm consumers. That is how @launchstack/pipelines shipped without
 * ./connectors/google-drive, ./connectors/gmail and ./distribution/stages.
 * check-package-exports.mjs could not see it: it loads what
 * publishConfig.exports lists, so an unlisted subpath is never tried.
 *
 * Deleting a source file drifts just as silently: both maps keep pointing at
 * it, and the only symptom is the release failing after merge. That is how
 * @launchstack/conversion's ./heading-chunker stopped every publish.
 *
 * For every package with a publishConfig.exports map this checks that
 *   1. both maps list the same subpaths,
 *   2. every workspace target exists,
 *   3. every published entry is what tsc (rootDir ./src, outDir ./dist)
 *      emits for its workspace target: ./src/a/b.ts publishes as
 *      { types: ./dist/a/b.d.ts, default: ./dist/a/b.js }.
 *
 * Dependency-free and needs no build:
 *   node scripts/ci/check-export-parity.mjs
 *
 * Exit codes: 0 ok · 1 the maps diverge
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";

const ROOT = resolvePath(import.meta.dirname, "../..");

const dirs = readdirSync(join(ROOT, "packages")).map(entry => join(ROOT, "packages", entry));
dirs.push(join(ROOT, "pipelines"));

/** The file an export entry (a string or a conditions object) resolves to. */
function target(entry, condition) {
    return typeof entry === "string" ? entry : (entry?.[condition] ?? entry?.default);
}

/** The published entry tsc's output implies for a workspace .ts target, or null. */
function publishedMirror(src) {
    if (!/^\.\/src\/.*\.tsx?$/.test(src)) return null;
    const base = src.replace(/^\.\/src\//, "./dist/").replace(/\.tsx?$/, "");
    return { types: `${base}.d.ts`, default: `${base}.js` };
}

const failures = [];
let packages = 0;
let subpaths = 0;

for (const dir of dirs) {
    const manifest = join(dir, "package.json");
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, "utf8"));
    if (!pkg.name?.startsWith("@launchstack/")) continue;
    if (pkg.private || !pkg.publishConfig?.exports) continue;
    packages++;

    const workspace = pkg.exports ?? {};
    const published = pkg.publishConfig.exports;

    for (const [subpath, entry] of Object.entries(workspace)) {
        subpaths++;
        const src = target(entry, "default");
        const mirror = publishedMirror(src);

        if (!subpath.includes("*") && !existsSync(resolvePath(dir, src))) {
            failures.push({
                pkg: pkg.name,
                subpath,
                reason: `${src} does not exist (renamed or removed? drop the subpath from both maps)`,
            });
            continue;
        }

        const pub = published[subpath];
        if (pub === undefined) {
            const fix = mirror ? `: ${JSON.stringify({ [subpath]: mirror }).slice(1, -1)}` : "";
            failures.push({
                pkg: pkg.name,
                subpath,
                reason: `in exports but not publishConfig.exports — npm consumers cannot import it${fix}`,
            });
            continue;
        }

        if (
            mirror &&
            (target(pub, "types") !== mirror.types || target(pub, "default") !== mirror.default)
        ) {
            failures.push({
                pkg: pkg.name,
                subpath,
                reason: `publishes ${JSON.stringify(pub)} but ${src} builds to ${JSON.stringify(mirror)}`,
            });
        }
    }

    for (const subpath of Object.keys(published)) {
        if (!(subpath in workspace)) {
            failures.push({
                pkg: pkg.name,
                subpath,
                reason: "in publishConfig.exports but not exports — the workspace cannot import it",
            });
        }
    }
}

if (failures.length > 0) {
    console.error(`[check-export-parity] ${failures.length} export map mismatch(es):`);
    for (const { pkg, subpath, reason } of failures) {
        console.error(`  ✗ ${pkg}${subpath.slice(1)} — ${reason}`);
    }
    console.error(
        "\n`exports` (workspace, src/) and `publishConfig.exports` (npm, dist/) must list the\n" +
            "same subpaths. The workspace resolves only the first, so drift passes every\n" +
            "other check and surfaces as an unimportable subpath in the published package."
    );
    process.exit(1);
}

console.log(`[check-export-parity] ok — ${subpaths} subpaths match across ${packages} packages`);
