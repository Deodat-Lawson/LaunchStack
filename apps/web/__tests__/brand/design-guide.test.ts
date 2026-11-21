/**
 * apps/web/DESIGN.md names real things on purpose — every rule points at the
 * component, file or registry it is about, so a reader can go and look. That
 * only helps while the names are true. This test keeps them true: every path
 * the guide cites must exist, and every component, hook and constant it names
 * in backticks must be defined somewhere in the app.
 *
 * When it fails, either the guide is stale (fix the guide) or a rename forgot
 * the guide (fix the guide in the same change).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const WEB = join(__dirname, "../..");
const REPO = join(WEB, "../..");
const GUIDE = readFileSync(join(WEB, "DESIGN.md"), "utf8");

/** Where a short path in the guide may start. Tried in order. */
const ROOTS = [
    WEB,
    join(WEB, "src"),
    join(WEB, "src/components"),
    join(WEB, "src/app/employer/documents"),
    join(WEB, "src/app/employer/documents/_workspace"),
    join(WEB, "src/app/dev/design"),
    REPO,
];

/** Names the guide mentions that come from libraries, not from this app. */
const EXTERNAL = new Set(["Loader2", "useFormatter", "useTranslations", "getTranslations"]);

/** Every `code span` in the guide, fenced blocks and all. */
function codeSpans(markdown: string): string[] {
    const spans = new Set<string>();
    for (const match of markdown.matchAll(/`([^`\n]+)`/g)) spans.add(match[1]!.trim());
    return [...spans];
}

/** Relative links in markdown: [text](target). */
function linkTargets(markdown: string): string[] {
    return [...markdown.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)]
        .map(m => m[1]!)
        .filter(target => !/^[a-z]+:/i.test(target));
}

/**
 * A span that names a file or folder: no spaces, no placeholders (`<tool>`),
 * no URL, and either a file extension or a trailing slash.
 */
function isPath(span: string): boolean {
    if (/[\s<>*{}?=:]/.test(span) || span.startsWith("/") || span.startsWith("@")) return false;
    return /\.(tsx?|md|css|json|cjs|js)$/.test(span) || span.endsWith("/");
}

/** Every file and folder name under apps/web and the tokens package, for bare names. */
function basenames(): Set<string> {
    const names = new Set<string>();
    const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
            if (name === "node_modules" || name.startsWith(".")) continue;
            names.add(name);
            const full = join(dir, name);
            if (statSync(full).isDirectory()) walk(full);
        }
    };
    walk(join(WEB, "src"));
    walk(join(REPO, "packages/design-tokens"));
    readdirSync(WEB).forEach(name => names.add(name));
    return names;
}

/**
 * A path with a folder in it resolves from one of the roots; a bare name
 * ("`RenewalsTool.tsx`", "`_screens/`", said where the folder is clear from
 * the sentence) has to exist somewhere in the app.
 */
function resolves(path: string, bare: Set<string>): boolean {
    const clean = path.replace(/^~\//, "src/").replace(/\/$/, "");
    if (!clean.includes("/")) return bare.has(clean);
    return ROOTS.some(root => existsSync(join(root, clean)));
}

function sourceText(): string {
    const chunks: string[] = [];
    const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
            if (name === "node_modules" || name === "__tests__") continue;
            const full = join(dir, name);
            if (statSync(full).isDirectory()) walk(full);
            else if (/\.(tsx?|css)$/.test(name)) chunks.push(readFileSync(full, "utf8"));
        }
    };
    walk(join(WEB, "src"));
    return chunks.join("\n");
}

describe("apps/web/DESIGN.md", () => {
    const spans = codeSpans(GUIDE);

    it("cites only files and folders that exist", () => {
        const paths = [...spans.filter(isPath), ...linkTargets(GUIDE)];
        expect(paths.length).toBeGreaterThan(30);
        const bare = basenames();
        const missing = paths.filter(path => !resolves(path, bare));
        expect(missing).toEqual([]);
    });

    it("names only components, hooks and constants the app defines", () => {
        const source = sourceText();
        const names = spans.filter(
            span =>
                !EXTERNAL.has(span) &&
                (/^[A-Z][a-z]+[A-Za-z0-9]*$/.test(span) ||
                    /^[A-Z][A-Z0-9_]{3,}$/.test(span) ||
                    /^use[A-Z][A-Za-z]+$/.test(span))
        );
        expect(names.length).toBeGreaterThan(30);
        const undefinedNames = names.filter(name => {
            const definition = new RegExp(
                `(?:function|const|let|class|interface|type)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b`
            );
            return !definition.test(source);
        });
        expect(undefinedNames).toEqual([]);
    });

    it("lists the template tool's screens that exist", () => {
        for (const screen of [
            "RenewalsTool.tsx",
            "OverviewScreen.tsx",
            "ContractsScreen.tsx",
            "ContractScreen.tsx",
            "NewScreen.tsx",
            "SettingsScreen.tsx",
        ]) {
            expect(GUIDE).toContain(screen);
            expect(existsSync(join(WEB, "src/app/dev/design/template", screen))).toBe(true);
        }
    });
});
