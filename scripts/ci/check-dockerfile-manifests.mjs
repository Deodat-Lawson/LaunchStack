/**
 * Verify every workspace package manifest is copied into each Dockerfile's
 * dependency layer.
 *
 * The deps stage copies manifests one explicit `COPY` line at a time so that
 * source edits don't bust the install cache. That list is maintained by hand,
 * and nothing has ever checked it against the actual workspace — so adding a
 * package silently omits it. `pnpm install --frozen-lockfile` then resolves a
 * workspace that is missing that member, its dependencies are never installed,
 * and the failure only surfaces much later as a type error in the builder
 * stage, pointing at a dependency the package *does* declare.
 *
 * That is exactly how `packages/google-drive` broke the image build with
 * "Cannot find module 'zod'" while its package.json declared zod all along.
 *
 * The reverse is just as easy to get wrong and fails harder: renaming or
 * removing a package leaves a COPY pointing at a path that no longer exists,
 * and BuildKit aborts immediately with
 *   failed to compute cache key: "/packages/<name>/package.json": not found
 * That is how the `packages/search` -> `packages/retrieval` rename broke both
 * images. So this checks both directions.
 *
 * Run:
 *   node scripts/ci/check-dockerfile-manifests.mjs
 *
 * Exit codes: 0 ok · 1 a manifest is missing from a Dockerfile
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";

const ROOT = resolvePath(import.meta.dirname, "../..");
const DOCKERFILES = [
    "apps/web/Dockerfile",
    "apps/web/Dockerfile.prebuilt",
    "apps/worker/Dockerfile",
    "apps/landing/Dockerfile",
];

/** Workspace dirs that ship a package.json, as the Dockerfiles address them. */
function workspaceManifests() {
    const found = [];
    for (const group of ["packages", "pipelines", "apps"]) {
        const groupDir = join(ROOT, group);
        if (!existsSync(groupDir)) continue;

        // pipelines/ is itself a single package, not a directory of them.
        if (existsSync(join(groupDir, "package.json"))) {
            found.push(`${group}/package.json`);
            continue;
        }
        for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            if (existsSync(join(groupDir, entry.name, "package.json"))) {
                found.push(`${group}/${entry.name}/package.json`);
            }
        }
    }
    return found;
}

const manifests = workspaceManifests();
const failures = [];

for (const dockerfile of DOCKERFILES) {
    const path = join(ROOT, dockerfile);
    if (!existsSync(path)) continue;
    const contents = readFileSync(path, "utf8");

    for (const manifest of manifests) {
        // apps/* manifests are only required in the Dockerfile that builds
        // that app; a worker image has no reason to carry apps/web's.
        if (manifest.startsWith("apps/") && !dockerfile.startsWith(manifest.slice(0, manifest.lastIndexOf("/")))) {
            continue;
        }
        if (!contents.includes(manifest)) {
            failures.push({ dockerfile, manifest });
        }
    }
}

// Reverse direction: a COPY naming a path that no longer exists aborts the
// build outright, so a rename must update the Dockerfiles in the same commit.
const stale = [];
for (const dockerfile of DOCKERFILES) {
    const path = join(ROOT, dockerfile);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
        const m = /^COPY\s+((?:packages|pipelines|apps)\/[^\s]*package\.json)\s/.exec(line.trim());
        if (m && !existsSync(join(ROOT, m[1]))) {
            stale.push({ dockerfile, manifest: m[1] });
        }
    }
}

if (failures.length > 0 || stale.length > 0) {
    for (const { dockerfile, manifest } of failures) {
        console.error(
            `  ✗ ${dockerfile} — missing, add: COPY ${manifest} ./${manifest.slice(0, manifest.lastIndexOf("/"))}/`
        );
    }
    for (const { dockerfile, manifest } of stale) {
        console.error(`  ✗ ${dockerfile} — stale, no such path: COPY ${manifest} (renamed or removed?)`);
    }
    if (failures.length > 0) {
        console.error(
            "\nA missing COPY makes pnpm install a workspace without that member; the image\n" +
                "build then fails with an unresolvable dependency the package does declare."
        );
    }
    if (stale.length > 0) {
        console.error(
            "\nA stale COPY aborts the build immediately with\n" +
                '  failed to compute cache key: "/<path>": not found'
        );
    }
    process.exit(1);
}

console.log(
    `[check-dockerfile-manifests] ok — ${manifests.length} manifests present across ${DOCKERFILES.length} Dockerfiles`
);
