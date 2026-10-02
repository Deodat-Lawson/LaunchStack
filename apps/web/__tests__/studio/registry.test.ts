/**
 * The Studio registry is how people find tools. These checks keep it
 * truthful: every link-out feature points at a page that exists, ids are
 * unique across groups and the palette, and the Growth app is
 * reachable from the drawer, the palette and the `?feature=` deep link.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
    ADD_TABS,
    DEMOTED_FEATURES,
    STUDIO_FEATURES_BY_ID,
    STUDIO_GROUPS,
    demotedFeatureHref,
    resolveStudioFeature,
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

    it("points every external feature at a page that exists", () => {
        const broken = STUDIO_GROUPS.flatMap(g => g.features)
            .filter(f => f.external)
            .filter(f => !f.href || !pageExists(f.href))
            .map(f => `${f.id} → ${f.href ?? "(no href)"}`);
        expect(broken).toEqual([]);
    });

    it("points every palette quick link at a page that exists", () => {
        const broken = DEMOTED_FEATURES.filter(f => !pageExists(f.href)).map(
            f => `${f.id} → ${f.href}`
        );
        expect(broken).toEqual([]);
    });

    it("lists Growth in the Tools group as a separate app, with Brand and Prospects in the palette", () => {
        const feature = STUDIO_FEATURES_BY_ID.growth;
        expect(feature).toBeDefined();
        expect(feature!.external).toBe(true);
        expect(feature!.href).toBe("/employer/tools/growth");
        expect(STUDIO_GROUPS.find(g => g.id === "tools")!.features.map(f => f.id)).toContain(
            "growth"
        );
        const palette = Object.fromEntries(DEMOTED_FEATURES.map(f => [f.id, f.href]));
        expect(palette.growth).toBe("/employer/tools/growth");
        expect(palette.brand).toBe("/employer/tools/growth/brand");
        expect(palette.prospects).toBe("/employer/tools/growth/prospects");
        // Nobody is gated out: any workspace member may open it.
        expect(feature!.requires).toBeUndefined();
    });

    it("no longer lists Marketing, Distribution or Prospects as Studio entries of their own", () => {
        for (const id of ["marketing", "distribution", "prospects"]) {
            expect(STUDIO_FEATURES_BY_ID[id]).toBeUndefined();
        }
    });

    it("treats Claude artifacts and coding sessions as sources you add, not Studio apps", () => {
        const addTabs = ADD_TABS.flatMap(g => g.items).map(tab => tab.id);
        for (const [id, tab] of [
            ["artifacts", "artifact"],
            ["agent-sessions", "agent-sessions"],
        ] as const) {
            // Not a tile, and nothing a saved layout could reopen as a tab.
            expect(STUDIO_FEATURES_BY_ID[id]).toBeUndefined();
            expect(resolveStudioFeature(id)).toBeUndefined();
            // Their way in is a tab of Add a source, which ⌘K opens.
            expect(addTabs).toContain(tab);
            expect(DEMOTED_FEATURES.find(f => f.id === id)?.href).toBe(
                `/employer/documents?add=1&tab=${tab}`
            );
        }
        // An artifact is uploaded; sessions come from a connector.
        const group = (name: string) => ADD_TABS.find(g => g.group === name)!.items.map(t => t.id);
        expect(group("Upload")).toContain("artifact");
        expect(group("Connect")).toContain("agent-sessions");
    });

    it("treats a mindmap as a source you make, not a Studio app", () => {
        // Not a tile: a map is made from Add knowledge and lives with the
        // other sources.
        expect(STUDIO_FEATURES_BY_ID.mindmap).toBeUndefined();
        expect(ADD_TABS.flatMap(g => g.items).some(tab => tab.id === "mindmap")).toBe(true);
        expect(DEMOTED_FEATURES.some(f => f.id === "mindmap")).toBe(true);
        // But the editor still opens as a tab, which needs a name and an icon.
        const editor = resolveStudioFeature("mindmap");
        expect(editor?.label).toBe("Mindmap");
        expect(editor?.Icon).toBeTruthy();
    });

    it("puts Growth first in Tools and Investor relations second, opening in a tab", () => {
        const tools = STUDIO_GROUPS.find(g => g.id === "tools")!.features.map(f => f.id);
        expect(tools.slice(0, 2)).toEqual(["growth", "investors"]);
        const investors = STUDIO_FEATURES_BY_ID.investors!;
        expect(investors.label).toBe("Investor relations");
        expect(investors.external).toBeUndefined();
        expect(investors.requires).toBeUndefined();
        // ⌘K reaches it too, and opens the tab rather than following a link.
        expect(DEMOTED_FEATURES.some(f => f.id === "investors")).toBe(true);
        expect(demotedFeatureHref("investors")).toBeUndefined();
    });

    it("names Growth as the one app a tab cannot hold", () => {
        const external = STUDIO_GROUPS.flatMap(g => g.features).filter(f => f.external);
        expect(external.map(f => f.id)).toEqual(["growth"]);
    });

    it("can name every app the workspace is able to open in a tab", () => {
        // A tab needs a label and an icon. These three have a working pane and
        // a live way in — a shortcut, a palette row, an old bookmark — but no
        // tile in the picker, so the registry has to be able to name them.
        for (const id of ["workflows", "analytics", "metadata"]) {
            expect(STUDIO_FEATURES_BY_ID[id]).toBeUndefined();
            const feature = resolveStudioFeature(id);
            expect(feature).toBeDefined();
            expect(feature!.label).toBeTruthy();
            expect(feature!.Icon).toBeTruthy();
        }
    });

    it("sends a palette row with nowhere of its own to its real destination", () => {
        expect(demotedFeatureHref("brand")).toBe("/employer/tools/growth/brand");
        expect(demotedFeatureHref("team")).toBe("/employer/settings#people");
        // Its href points back at this page, so following it would loop.
        expect(demotedFeatureHref("rewrite")).toBeUndefined();
        expect(demotedFeatureHref("nonsense")).toBeUndefined();
    });
});
