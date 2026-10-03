/**
 * Our Tailwind utilities must be the last word on every class they define.
 *
 * Until this test, the root layout imported `@uploadthing/react/styles.css`
 * after globals.css. That file is a precompiled Tailwind subset (`.flex`,
 * `.hidden`, `.text-sm`, `.rounded-lg`, … ~60 of them), so it re-declared
 * those utilities after ours. Every responsive, container, `dark:` or
 * `motion-reduce:` variant that overrode one of them on the same element
 * silently lost — `hidden md:block` never showed, `flex-col md:flex-row`
 * never went side by side — and its fixed values beat our token-mapped
 * radii app-wide. ESLint cannot see stylesheet order, so this is the
 * guardrail.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const WEB_ROOT = join(__dirname, "../..");
const SRC = join(WEB_ROOT, "src");

const read = (path: string) => readFileSync(path, "utf8");

function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) out.push(...walk(path));
        else if (/\.(ts|tsx)$/.test(name)) out.push(path);
    }
    return out;
}

const cssImports = (text: string) =>
    [...text.matchAll(/^import\s+(?:\w+\s+from\s+)?["']([^"']+\.css)["'];?$/gm)].map(m => m[1]!);

// A bare single-class rule whose name is shaped like a Tailwind utility,
// e.g. `.flex{`, `.text-sm,`, `.rounded-lg{`, `.sr-only{`.
const UTILITY_RULE =
    /(?:^|[},])\s*\.(-?(?:flex|hidden|block|inline|grid|items|justify|self|gap|text|font|leading|tracking|rounded|border|bg|m|mx|my|mt|mb|ml|mr|p|px|py|pt|pb|pl|pr|w|h|min-w|min-h|max-w|max-h|size|z|relative|absolute|fixed|sticky|overflow|sr-only|shadow|opacity|transition|animate|cursor)(?:-[\w.\\/[\]]+)?)\s*[,{]/;

describe("stylesheet order", () => {
    it("loads globals.css last in the root layout", () => {
        const imports = cssImports(read(join(SRC, "app/layout.tsx")));
        expect(imports.at(-1)).toBe("~/styles/globals.css");
    });

    it("imports no package stylesheet that redefines Tailwind utilities", () => {
        const offenders: string[] = [];
        for (const file of walk(SRC)) {
            for (const spec of cssImports(read(file))) {
                if (spec.startsWith(".") || spec.startsWith("~/")) continue;
                const resolved = require.resolve(spec, { paths: [WEB_ROOT] });
                const match = UTILITY_RULE.exec(read(resolved));
                if (match) {
                    offenders.push(
                        `${file.slice(SRC.length + 1)} imports ${spec} (defines .${match[1]})`
                    );
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});
