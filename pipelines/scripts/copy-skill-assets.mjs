/**
 * Copy non-TS skill assets into dist. tsc only emits compiled modules; the
 * repo-explainer skills are markdown files resolved relative to the compiled
 * module at runtime (src/repo-explainer/skills.ts), so a published build
 * without them would throw on first load.
 */

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");

const ASSET_DIRS = [["src/repo-explainer/skills", "dist/repo-explainer/skills"]];

for (const [from, to] of ASSET_DIRS) {
    const source = join(pkgRoot, from);
    if (!existsSync(source)) {
        console.error(`copy-skill-assets: missing ${from}`);
        process.exit(1);
    }
    mkdirSync(join(pkgRoot, dirname(to)), { recursive: true });
    cpSync(source, join(pkgRoot, to), { recursive: true });
    console.log(`copy-skill-assets: ${from} -> ${to}`);
}
