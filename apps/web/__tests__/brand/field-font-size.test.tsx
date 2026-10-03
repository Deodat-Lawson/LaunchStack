/**
 * A size passed to a kit text field holds at every width.
 *
 * The kit used to carry shadcn's `text-base md:text-sm`. tailwind-merge
 * drops `text-base` when a caller passes `text-lg`, but keeps `md:text-sm`
 * (a different variant), and the md rule comes later in the stylesheet, so
 * from 768px up 32 fields rendered 14px whatever they asked for: a text-lg
 * title, text-xs table cells, text-[13px] search boxes.
 *
 * The default now lives in globals.css's components layer, which Tailwind
 * emits before every utility. Both halves are checked: the kit renders no
 * size class of its own, and the compiled fallback precedes the utilities a
 * caller would pass (equal specificity, so source order decides).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { renderToStaticMarkup } from "react-dom/server";

import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import tailwindConfig from "../../tailwind.config";

const GLOBALS = join(__dirname, "../../src/styles/globals.css");
const CALLER_SIZES = ["text-xs", "text-lg", "text-[13px]"];

/** Font-size utilities, with or without variants: text-sm, md:text-sm, text-[13px]. */
const FONT_SIZE = /^(?:[\w-]+:)*text-(?:xs|sm|base|lg|[2-9]?xl|\[[\d.]+(?:px|rem|em)\])$/;

/** Sizes that land on the field's own text; file:text-sm sizes the file-picker button. */
function fieldSizes(markup: string): string[] {
    const match = /class="([^"]*)"/.exec(markup);
    return (match?.[1] ?? "").split(/\s+/).filter(c => FONT_SIZE.test(c) && !c.startsWith("file:"));
}

describe("kit Input / Textarea font size", () => {
    it.each([
        ["Input", (className?: string) => <Input className={className} />],
        ["Textarea", (className?: string) => <Textarea className={className} />],
    ])("%s renders only the caller's size class", (_name, render) => {
        expect(fieldSizes(renderToStaticMarkup(render()))).toEqual([]);
        for (const size of CALLER_SIZES) {
            expect(fieldSizes(renderToStaticMarkup(render(size)))).toEqual([size]);
        }
    });

    it("compiles the fallback ahead of the utilities a caller passes", async () => {
        const css = (
            await postcss([
                tailwindcss({
                    ...tailwindConfig,
                    content: [
                        { raw: `<input class="${CALLER_SIZES.join(" ")}">`, extension: "html" },
                    ],
                }),
            ]).process(readFileSync(GLOBALS, "utf8"), { from: GLOBALS })
        ).css;

        const fallback = /\[data-slot="input"\],\s*\[data-slot="textarea"\]\s*\{([^}]*)\}/g;
        const rules = [...css.matchAll(fallback)];
        // The phone default, then the md override inside its media query.
        expect(rules.map(r => r[1]!.replace(/\s+/g, " ").trim())).toEqual([
            "font-size: 1rem; line-height: 1.5rem; line-height: 1.5;",
            "font-size: 0.875rem; line-height: 1.25rem;",
        ]);
        expect(css.slice(0, rules[1]!.index)).toMatch(/@media \(min-width: 768px\) \{\s*$/);

        const lastFallback = rules[1]!.index;
        for (const size of CALLER_SIZES) {
            const selector = `.${size.replace(/[[\].]/g, m => `\\${m}`)} {`;
            const at = css.indexOf(selector);
            expect(at).toBeGreaterThan(lastFallback);
        }
    });
});
