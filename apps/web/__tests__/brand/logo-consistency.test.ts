/**
 * The Launchstack mark is drawn from four places that can't import each other:
 * the React component (twice — apps/web and apps/landing, which carries no
 * workspace deps), the standalone `public/icon.svg` that the favicons are
 * rasterized from, and the flat SVG satori renders onto the OG cards.
 *
 * Every one of those started as a copy of the others and every one of them had
 * drifted before this test existed — a CSS diamond in the marketing nav, a
 * letter-"L" tile on the OG cards, a leftover lucide Brain in the favicon. This
 * test compares the geometry they all share so the next edit has to touch all
 * of them.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "../../../..");

const WEB_COMPONENT = "apps/web/src/app/_components/LaunchstackLogo.tsx";
const LANDING_COMPONENT = "apps/landing/src/app/_components/LaunchstackLogo.tsx";
const WEB_ICON_SVG = "apps/web/public/icon.svg";
const LANDING_ICON_SVG = "apps/landing/public/icon.svg";
const OG_MARK = "apps/landing/src/app/_components/og-mark.tsx";

const read = (relPath: string) => readFileSync(join(REPO_ROOT, relPath), "utf8");

/**
 * The mark's markup, stripped of everything that is a property of the host
 * rather than of the logo: attribute casing (`strokeWidth` vs `stroke-width`),
 * JSX braces and quoting, the generated gradient id, and the colour space the
 * stops are written in. What survives is the drawing itself.
 */
function normalize(source: string): string {
    const svg = /<svg[\s\S]*<\/svg>/.exec(source);
    if (!svg) throw new Error("no <svg> element found");

    return (
        svg[0]
            .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ") // JSX comments
            .replace(/<!--[\s\S]*?-->/g, " ") // XML comments
            // JSX camelCase → SVG kebab-case, so `strokeWidth` and `stroke-width`
            // compare equal. Must run before the attribute drops below.
            .replace(/\b([a-z]+)([A-Z])/g, (_, head: string, tail: string) => {
                return `${head}-${tail.toLowerCase()}`;
            })
            // Host-specific by design: the component generates a per-instance
            // gradient id, and only the two flat copies can spell colours in hex
            // (the oklch↔hex pairing is pinned by its own test below).
            .replace(/\s(id|xmlns|stop-color)=("[^"]*"|'[^']*'|\{[^}]*\})/g, "")
            .replace(/url\(#[^)]*\)/g, "url(#gradient)")
            .replace(/"white"/g, '"#ffffff"')
            .replace(/[{}"'`]/g, "")
            .replace(/\s+/g, " ")
            .replace(/\s*\/>/g, "/>")
            .trim()
    );
}

/** The drawn elements, in order — what must match across every rendering. */
function shapes(source: string): string[] {
    const found = normalize(source).match(/<(rect|path|circle|stop|linear-gradient)\b[^>]*>/g);
    if (!found) throw new Error("no shape elements found");
    return found;
}

describe("Launchstack logo", () => {
    it("is byte-identical between apps/web and apps/landing", () => {
        // Not a geometry comparison: these two files are a mirrored pair, so any
        // difference at all — a prop, a comment, a default size — is drift.
        expect(read(LANDING_COMPONENT)).toBe(read(WEB_COMPONENT));
    });

    it("ships the same standalone icon.svg to both apps", () => {
        expect(read(LANDING_ICON_SVG)).toBe(read(WEB_ICON_SVG));
    });

    it("draws the same shapes in the component, icon.svg, and the OG card", () => {
        const fromComponent = shapes(read(WEB_COMPONENT));

        expect(shapes(read(WEB_ICON_SVG))).toEqual(fromComponent);
        expect(shapes(read(OG_MARK))).toEqual(fromComponent);
    });

    it("uses the sRGB equivalents of the component's OKLCH stops off-web", () => {
        // resvg (favicons) and satori (OG cards) don't parse oklch(), so those
        // two carry hex. If a stop changes in the component, its hex twin has to
        // change with it — this pins the pairing that conversion produced.
        const OKLCH_TO_HEX: Array<[string, string]> = [
            ["oklch(0.55 0.2 295)", "#7e4ed7"],
            ["oklch(0.4 0.2 290)", "#4e1ca8"],
            ["oklch(0.24 0.13 285)", "#1f0658"],
        ];

        const component = read(WEB_COMPONENT);
        const iconSvg = read(WEB_ICON_SVG);
        const ogMark = read(OG_MARK);

        for (const [oklch, hex] of OKLCH_TO_HEX) {
            expect(component).toContain(oklch);
            expect(iconSvg).toContain(hex);
            expect(ogMark).toContain(hex);
        }
    });

    it("is the only mark the apps render — no hand-rolled CSS tiles", () => {
        // The diamond tile these files used to draw is what the mark replaced.
        const cssThatDrewItsOwnMark = [
            "apps/landing/src/styles/marketing.module.css",
            "apps/landing/src/styles/deployment.module.css",
            "apps/web/src/app/workspaces/workspace-select.module.css",
        ];

        for (const path of cssThatDrewItsOwnMark) {
            expect(read(path)).not.toContain("clip-path: polygon(50% 0");
        }
    });
});
