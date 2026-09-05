/**
 * Next.js route files may export only the HTTP handlers and a fixed set of
 * segment-config values. Any other export makes the module fail the framework's
 * Route type check, and it fails at *build* time with a message that names the
 * file but not the offending symbol:
 *
 *   Type error: Route "src/app/api/…/route.ts" does not match the required
 *   types of a Next.js Route.
 *
 * That has now broken main three times — a helper constant or a shared type
 * left exported next to the handlers. Nothing catches it before the image
 * build, which is minutes in, so this does: it is a text scan, it needs no
 * dependencies, and it names the export.
 *
 * Run:
 *   node scripts/ci/check-route-exports.mjs
 *
 * Exit codes: 0 ok · 1 a route exports something it may not
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve as resolvePath } from "node:path";

const ROOT = resolvePath(import.meta.dirname, "../..");
const APP_DIRS = ["apps/web/src/app", "apps/landing/src/app"];

/** Everything the framework accepts from a route module. */
const ALLOWED = new Set([
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD",
    "OPTIONS",
    "dynamic",
    "dynamicParams",
    "revalidate",
    "fetchCache",
    "runtime",
    "preferredRegion",
    "maxDuration",
    "generateStaticParams",
]);

function routeFiles(dir) {
    const out = [];
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...routeFiles(full));
        else if (/^route\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

/**
 * Named exports declared at the top level. Deliberately a regex rather than a
 * parser: this has to stay dependency-free and run before install.
 */
function exportedNames(source) {
    const names = [];
    const patterns = [
        /^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm,
        /^export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/gm,
        /^export\s+class\s+([A-Za-z0-9_$]+)/gm,
    ];
    for (const re of patterns) {
        for (const m of source.matchAll(re)) names.push(m[1]);
    }
    // `export { a, b }` — types are erased at build, values are not.
    for (const m of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
        for (const part of m[1].split(",")) {
            const name = part
                .trim()
                .split(/\s+as\s+/)
                .pop()
                ?.trim();
            if (name && !part.trim().startsWith("type ")) names.push(name);
        }
    }
    return names;
}

const offenders = [];
for (const appDir of APP_DIRS) {
    for (const file of routeFiles(join(ROOT, appDir))) {
        const source = readFileSync(file, "utf8");
        for (const name of exportedNames(source)) {
            if (!ALLOWED.has(name)) {
                offenders.push({ file: relative(ROOT, file), name });
            }
        }
    }
}

if (offenders.length > 0) {
    console.error(`[check-route-exports] ${offenders.length} disallowed export(s) in route files:`);
    for (const { file, name } of offenders) {
        console.error(`  ✗ ${file} — exports "${name}"`);
    }
    console.error(
        "\nA route module may export only the HTTP handlers and the segment config\n" +
            "(dynamic, revalidate, runtime, maxDuration, …). Move the symbol to its own\n" +
            "module, or drop the `export` if nothing outside the file uses it."
    );
    process.exit(1);
}

const scanned = APP_DIRS.reduce((n, d) => n + routeFiles(join(ROOT, d)).length, 0);
console.log(`[check-route-exports] ok — ${scanned} route files, no disallowed exports`);
