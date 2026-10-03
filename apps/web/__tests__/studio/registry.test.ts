/**
 * The Studio registry is how people find tools. These checks keep it
 * truthful: every app opens as a tab of the workspace (no app is a page of
 * its own any more), every palette link points at a page that exists, ids
 * are unique across groups and the palette, and Growth, Proposals and
 * Vantage are reachable from the drawer, the palette and their old URLs.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { STUDIO_PANE_IDS } from "~/app/employer/documents/_workspace/studioPaneIds";
import {
    ADD_TABS,
    DEMOTED_FEATURES,
    STUDIO_FEATURES_BY_ID,
    STUDIO_GROUPS,
    demotedFeatureHref,
    resolveStudioFeature,
    settingsSectionOf,
} from "~/app/employer/documents/_workspace/types";
import { toolTargetFromHref } from "~/lib/tool-app/locations";

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

    it("opens every Studio app as a tab: it has a pane, and its link stays on the workspace", () => {
        const apps = STUDIO_GROUPS.flatMap(g => g.features);
        // A pane for every entry — `renderStudioPane` is exhaustive over
        // STUDIO_PANE_IDS, so this is what forbids a tool that is a page.
        const paneless = apps.filter(f => !(STUDIO_PANE_IDS as readonly string[]).includes(f.id));
        expect(paneless.map(f => f.id)).toEqual([]);
        const leaving = apps
            .filter(f => f.href && !f.href.startsWith(`/employer/documents?feature=${f.id}`))
            .map(f => `${f.id} → ${f.href}`);
        expect(leaving).toEqual([]);
        // The flag that made a tool "a separate app" is gone for good.
        for (const app of apps) expect(Object.keys(app)).not.toContain("external");
    });

    it("gives every palette row a unique id", () => {
        // The palette keys its rows by id and opens them by id, so two rows
        // sharing one collide in React and open the same place.
        const ids = DEMOTED_FEATURES.map(f => f.id);
        const repeated = ids.filter((id, i) => ids.indexOf(id) !== i);
        expect(repeated).toEqual([]);
    });

    it("opens Agents as the app and Agents & nodes as its section of Settings", () => {
        expect(DEMOTED_FEATURES.find(f => f.id === "agents")?.label).toBe("Agents");
        expect(resolveStudioFeature("agents")?.label).toBe("Agents");
        const nodes = DEMOTED_FEATURES.find(f => f.label === "Agents & nodes")!;
        // Not a Studio app of its own: the shell follows its href, which is
        // a Settings section and so opens the Settings tab on it.
        expect(resolveStudioFeature(nodes.id)).toBeUndefined();
        expect(settingsSectionOf(demotedFeatureHref(nodes.id)!)).toBe("agents");
    });

    it("points every palette quick link at a page that exists", () => {
        const broken = DEMOTED_FEATURES.filter(f => !pageExists(f.href)).map(
            f => `${f.id} → ${f.href}`
        );
        expect(broken).toEqual([]);
    });

    it("lists Growth in the Tools group as a tab, with Brand and Prospects in the palette opening it there", () => {
        const feature = STUDIO_FEATURES_BY_ID.growth;
        expect(feature).toBeDefined();
        expect(feature!.href).toBe("/employer/documents?feature=growth");
        expect(STUDIO_GROUPS.find(g => g.id === "tools")!.features.map(f => f.id)).toContain(
            "growth"
        );
        const palette = Object.fromEntries(DEMOTED_FEATURES.map(f => [f.id, f.href]));
        expect(palette.growth).toBe("/employer/documents?feature=growth");
        expect(toolTargetFromHref(palette.brand!)).toEqual({ toolId: "growth", at: "/brand" });
        expect(toolTargetFromHref(palette.prospects!)).toEqual({
            toolId: "growth",
            at: "/prospects",
        });
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

    it("puts Growth first in Tools, Proposals second and Investor relations third, opening in a tab", () => {
        const tools = STUDIO_GROUPS.find(g => g.id === "tools")!.features.map(f => f.id);
        expect(tools.slice(0, 3)).toEqual(["growth", "proposals", "investors"]);
        const investors = STUDIO_FEATURES_BY_ID.investors!;
        expect(investors.label).toBe("Investor relations");
        expect(investors.requires).toBeUndefined();
        // ⌘K reaches it too, and opens the tab rather than following a link.
        expect(DEMOTED_FEATURES.some(f => f.id === "investors")).toBe(true);
        expect(demotedFeatureHref("investors")).toBeUndefined();
    });

    it("lists Proposals and Vantage in Tools as tabs, reachable from the palette too", () => {
        for (const id of ["proposals", "vantage"]) {
            const feature = STUDIO_FEATURES_BY_ID[id];
            expect(feature?.href).toBe(`/employer/documents?feature=${id}`);
            expect(feature?.requires).toBeUndefined();
            expect(DEMOTED_FEATURES.find(f => f.id === id)?.href).toBe(
                `/employer/documents?feature=${id}`
            );
        }
    });

    it("keeps every old tool URL working: a catch-all page sends it to the same screen in the tab", () => {
        for (const tool of ["growth", "proposals", "vantage", "prospects"]) {
            expect(
                existsSync(join(APP_ROOT, "employer", "tools", tool, "[[...slug]]", "page.tsx"))
            ).toBe(true);
        }
        expect(
            toolTargetFromHref("/employer/tools/growth/prospects/companies/12?view=new")
        ).toEqual({ toolId: "growth", at: "/prospects/companies/12?view=new" });
        expect(toolTargetFromHref("/employer/tools/proposals/write/7")).toEqual({
            toolId: "proposals",
            at: "/write/7",
        });
        expect(toolTargetFromHref("/employer/tools/vantage/agenda?week=2026-09-28")).toEqual({
            toolId: "vantage",
            at: "/agenda?week=2026-09-28",
        });
    });

    it("can name every app the workspace is able to open in a tab", () => {
        // A tab needs a label and an icon. These two have a working pane and
        // a live way in — a shortcut, a palette row, an old bookmark — but no
        // tile in the picker, so the registry has to be able to name them.
        for (const id of ["workflows", "metadata"]) {
            expect(STUDIO_FEATURES_BY_ID[id]).toBeUndefined();
            const feature = resolveStudioFeature(id);
            expect(feature).toBeDefined();
            expect(feature!.label).toBeTruthy();
            expect(feature!.Icon).toBeTruthy();
        }
    });

    it("lists Analytics as its own Management app, gated like its API", () => {
        const management = STUDIO_GROUPS.find(g => g.id === "management");
        const analytics = management?.features.find(f => f.id === "analytics");
        expect(analytics?.requires).toBe("analytics.view");
        // Settings does not hold analytics; its #analytics hash forwards here.
        expect(STUDIO_FEATURES_BY_ID.settings?.desc).not.toMatch(/analytics/i);
    });

    it("sends a palette row with nowhere of its own to its real destination", () => {
        // Brand is a place in Growth's tab, opened through TOOL_ALIASES, so
        // it has no destination beyond this page.
        expect(demotedFeatureHref("brand")).toBeUndefined();
        expect(demotedFeatureHref("team")).toBe("/employer/settings#people");
        // Its href points back at this page, so following it would loop.
        expect(demotedFeatureHref("rewrite")).toBeUndefined();
        expect(demotedFeatureHref("nonsense")).toBeUndefined();
    });

    it("reads the section out of a link into Settings, and nothing out of any other link", () => {
        expect(settingsSectionOf("/employer/settings#people")).toBe("people");
        expect(settingsSectionOf("/employer/settings")).toBe("");
        expect(settingsSectionOf("/employer/tools/growth/brand")).toBeUndefined();
        expect(settingsSectionOf("/employer/documents?feature=agents")).toBeUndefined();
    });
});
