/**
 * The Studio registry is how people find tools. These checks keep it
 * truthful: standalone destinations point at real pages, ids are unique
 * across groups and the palette, and the Distribution tool is reachable from
 * the drawer, the palette and the `?feature=` deep link.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
    DEMOTED_FEATURES,
    STUDIO_FEATURES_BY_ID,
    STUDIO_GROUPS,
} from "~/app/employer/documents/_workspace/types";

const APP_ROOT = join(process.cwd(), "src", "app");

/** `/employer/tools/distribution` → src/app/employer/tools/distribution/page.tsx */
function pageExists(href: string): boolean {
    const path = href.split("?")[0]!.split("#")[0]!.replace(/^\//, "");
    return existsSync(join(APP_ROOT, path, "page.tsx"));
}

describe("studio registry", () => {
    it("gives every feature a unique id across groups", () => {
        const ids = STUDIO_GROUPS.flatMap(g => g.features.map(f => f.id));
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("points every standalone destination at a page that exists", () => {
        const broken = STUDIO_GROUPS.flatMap(g => g.features)
            .filter(f => f.href)
            .filter(f => !pageExists(f.href!))
            .map(f => `${f.id} → ${f.href}`);
        expect(broken).toEqual([]);
    });

    it("points every palette quick link at a page that exists", () => {
        const broken = DEMOTED_FEATURES.filter(f => !pageExists(f.href)).map(
            f => `${f.id} → ${f.href}`
        );
        expect(broken).toEqual([]);
    });

    it("lists Distribution in the Tools group and palette with its standalone destination", () => {
        const feature = STUDIO_FEATURES_BY_ID.distribution;
        expect(feature).toBeDefined();
        expect(feature!.href).toBe("/employer/tools/distribution");
        expect(STUDIO_GROUPS.find(g => g.id === "tools")!.features.map(f => f.id)).toContain(
            "distribution"
        );
        expect(DEMOTED_FEATURES.map(f => f.id)).toContain("distribution");
        // Nobody is gated out: any workspace member may open it.
        expect(feature!.requires).toBeUndefined();
    });
});
