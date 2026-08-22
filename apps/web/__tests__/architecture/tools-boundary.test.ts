/**
 * Tool-layer boundary ratchet (unification P1, design doc §9).
 *
 * ESLint already enforces the hard edges (tools cannot import features;
 * process.env only in a tool's config.ts). These two rules are subtler than
 * an import-pattern ban, so they live here, in the same walking-ratchet style
 * as service-map.test.ts:
 *
 * 1. No relative import in a feature vertical may reach into a *sibling*
 *    vertical. That was how email-pipeline grew a dependency on marketing's
 *    internals; shared capability belongs in @launchstack/tools.
 * 2. No feature calls the RAG port directly. Retrieval goes through
 *    @launchstack/tools/grounded-retrieval, where topK/weights/snippet policy
 *    and the empty-vs-throw failure policy are declared, not improvised.
 *
 * The intent is a ratchet: the lists of violations may only shrink.
 */
import fs from "node:fs";
import path from "node:path";

const FEATURES_SRC = path.resolve(__dirname, "../../../../packages/features/src");

function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
    return out;
}

/** The vertical (top-level directory under src) a file belongs to, or null for root files. */
function featureOf(file: string): string | null {
    const rel = path.relative(FEATURES_SRC, file);
    const [head] = rel.split(path.sep);
    return rel.includes(path.sep) ? (head ?? null) : null;
}

function importSpecifiers(source: string): string[] {
    const specs: string[] = [];
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) specs.push(match[1]!);
    for (const match of source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) specs.push(match[1]!);
    return specs;
}

describe("tool-layer boundaries (ratchet)", () => {
    const files = walk(FEATURES_SRC);

    it("no feature vertical imports a sibling vertical by relative path", () => {
        const violations: string[] = [];

        for (const file of files) {
            const feature = featureOf(file);
            if (!feature) continue; // root barrels legitimately import ./<feature>/

            const source = fs.readFileSync(file, "utf8");
            for (const spec of importSpecifiers(source)) {
                if (!spec.startsWith(".")) continue;
                const resolved = path.resolve(path.dirname(file), spec);
                const rel = path.relative(FEATURES_SRC, resolved);
                if (rel.startsWith("..")) continue; // leaves the package (tsconfig forbids anyway)
                const [target] = rel.split(path.sep);
                if (target && rel.includes(path.sep) && target !== feature) {
                    violations.push(
                        `${path.relative(FEATURES_SRC, file)} → "${spec}" (reaches into ${target})`
                    );
                }
            }
        }

        expect(violations).toEqual([]);
    });

    it("no feature calls the RAG port directly (use @launchstack/tools/grounded-retrieval)", () => {
        const violations: string[] = [];

        for (const file of files) {
            const source = fs.readFileSync(file, "utf8");
            if (
                /\bgetRag(?:OrNull)?\s*\(/.test(source) ||
                /\bragCompanySearchSafe\b/.test(source)
            ) {
                violations.push(path.relative(FEATURES_SRC, file));
            }
        }

        expect(violations).toEqual([]);
    });
});
