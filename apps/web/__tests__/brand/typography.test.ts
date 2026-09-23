/**
 * One typeface system across every app: Inter for UI, JetBrains Mono for
 * code, both loaded once per app by `src/app/fonts.ts` and reached only
 * through the `--font-sans` / `--font-mono` / `--font-serif` tokens in
 * @launchstack/design-tokens.
 *
 * Before this test the two apps loaded four families each, the landing page
 * set its sans through Inter Tight while the app used it for body text,
 * ~60 declarations named "JetBrains Mono" or the raw next/font variable
 * directly, and a canvas and a mermaid config asked for "Inter" by name —
 * which never matches, because next/font serves the face under a hashed
 * family name. ESLint cannot read CSS, so this is the guardrail.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "../../../..");
const APP_SOURCES = ["apps/web/src", "apps/landing/src"];
const FONT_LOADERS = ["apps/web/src/app/fonts.ts", "apps/landing/src/app/fonts.ts"];

const TOKEN_VALUES = new Set([
    "inherit",
    "var(--font-sans)",
    "var(--font-mono)",
    "var(--font-serif)",
]);

/**
 * Files that write fonts for something other than the app's own UI, where
 * the tokens do not exist. Each entry says what renders the text.
 */
const EXEMPT: Record<string, string> = {
    // Standalone HTML handed to the user as a download: no web fonts, no tokens.
    "apps/web/src/app/api/document-generator/export/route.ts": "exported document HTML",
    // Fixture HTML rendered inside a sandboxed iframe on a dev-only page.
    "apps/web/src/app/dev/artifacts/ArtifactsPreview.tsx": "sandboxed artifact fixture",
    // Satori renders these; it takes font data, not CSS (see og-fonts.ts).
    "apps/landing/src/app/opengraph-image.tsx": "next/og card",
    "apps/landing/src/app/deployment/opengraph-image.tsx": "next/og card",
    "apps/landing/src/app/pricing/opengraph-image.tsx": "next/og card",
};

const read = (relPath: string) => readFileSync(join(REPO_ROOT, relPath), "utf8");

function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(join(REPO_ROOT, dir))) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const rel = join(dir, name);
        if (statSync(join(REPO_ROOT, rel)).isDirectory()) out.push(...walk(rel));
        else if (/\.(css|ts|tsx)$/.test(name)) out.push(rel);
    }
    return out;
}

const sources = APP_SOURCES.flatMap(walk).filter(f => !FONT_LOADERS.includes(f));

function lineOf(text: string, index: number): number {
    return text.slice(0, index).split("\n").length;
}

describe("typography", () => {
    it("both apps load the same fonts from byte-identical loaders", () => {
        const [web, landing] = FONT_LOADERS.map(read);
        expect(landing).toBe(web);
    });

    it("the loader brings in exactly Inter and JetBrains Mono", () => {
        const imports = /import\s*\{([^}]*)\}\s*from\s*"next\/font\/google"/.exec(
            read(FONT_LOADERS[0]!)
        );
        const families = imports?.[1]!
            .split(",")
            .map(s => s.trim())
            .filter(Boolean)
            .sort();
        expect(families).toEqual(["Inter", "JetBrains_Mono"]);
    });

    it("nothing else calls next/font", () => {
        const offenders = sources.filter(f => /from\s*"next\/font\//.test(read(f)));
        expect(offenders).toEqual([]);
    });

    it("no code reaches past the tokens to a next/font variable", () => {
        const offenders: string[] = [];
        for (const file of sources) {
            const text = read(file);
            for (const m of text.matchAll(
                /--font-(inter|inter-tight|jetbrains-mono|instrument-serif|geist)\b/g
            )) {
                offenders.push(`${file}:${lineOf(text, m.index)} ${m[0]}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it("every font-family is a token or inherit", () => {
        const offenders: string[] = [];
        for (const file of sources) {
            if (file in EXEMPT) continue;
            const text = read(file);
            const declarations = [
                // CSS files and CSS-in-template-literal (styled-jsx, iframe srcdoc).
                ...text.matchAll(/font-family:\s*([^;}"`]+)/g),
                // React inline styles and SVG attributes with a literal value.
                ...text.matchAll(/fontFamily[:=]\s*["'`]([^"'`]*)["'`]/g),
            ];
            for (const m of declarations) {
                const value = m[1]!.trim().replace(/\s*!important$/, "");
                if (!TOKEN_VALUES.has(value)) {
                    offenders.push(`${file}:${lineOf(text, m.index)} ${value}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});
