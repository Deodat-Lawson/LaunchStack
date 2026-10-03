/**
 * Rewrite is a tab of the workspace: its screens are app-relative paths
 * inside the tab, and `rewriteScreenFor` is the switch from a path to a
 * screen. These pin every path, the unknown ones, the links the tool builds,
 * and that the tab claims exactly the roots its screens live under.
 */
import {
    isEditorScreen,
    MY_REWRITES_PATH,
    NEW_REWRITE_PATH,
    REWRITE_ROOTS,
    rewritePath,
    rewriteScreenFor,
    UNSAVED_REWRITE_PATH,
    WORKFLOW_PATH,
    type RewriteScreen,
} from "~/app/employer/documents/components/rewrite-screens";
import { isToolPath, parseToolHref, toolTabHref } from "~/lib/tool-app/locations";

describe("rewriteScreenFor", () => {
    it.each<[string, RewriteScreen]>([
        ["/", { screen: "new" }],
        ["", { screen: "new" }],
        ["/rewrites", { screen: "rewrites" }],
        ["/rewrites/12", { screen: "rewrite", id: "12" }],
        ["/rewrites/new", { screen: "unsaved" }],
        ["/steps", { screen: "workflow" }],
    ])("%s shows its screen", (path, screen) => {
        expect(rewriteScreenFor(path)).toEqual(screen);
    });

    it("decodes an encoded id, and keeps a malformed one as typed", () => {
        expect(rewriteScreenFor("/rewrites/a%20b")).toEqual({ screen: "rewrite", id: "a b" });
        expect(rewriteScreenFor("/rewrites/100%")).toEqual({ screen: "rewrite", id: "100%" });
    });

    it.each([
        "/nope",
        "/new",
        "/rewrites/12/edit",
        "/rewrites/new/12",
        "/steps/2",
        "/Rewrites",
        "/employer/documents",
    ])("%s is not a screen", path => {
        expect(rewriteScreenFor(path)).toEqual({ screen: "not-found" });
    });

    it("the paths the tool links to are the screens they name", () => {
        expect(rewriteScreenFor(NEW_REWRITE_PATH)).toEqual({ screen: "new" });
        expect(rewriteScreenFor(MY_REWRITES_PATH)).toEqual({ screen: "rewrites" });
        expect(rewriteScreenFor(UNSAVED_REWRITE_PATH)).toEqual({ screen: "unsaved" });
        expect(rewriteScreenFor(WORKFLOW_PATH)).toEqual({ screen: "workflow" });
        expect(rewriteScreenFor(rewritePath("42"))).toEqual({ screen: "rewrite", id: "42" });
        // What a link to a saved rewrite looks like once the tab normalises it.
        expect(rewriteScreenFor(parseToolHref(rewritePath("42")).path)).toEqual({
            screen: "rewrite",
            id: "42",
        });
    });

    it("tells the editor's screens from the rest", () => {
        expect(isEditorScreen({ screen: "rewrite", id: "1" })).toBe(true);
        expect(isEditorScreen({ screen: "unsaved" })).toBe(true);
        for (const screen of ["new", "rewrites", "workflow", "not-found"] as const) {
            expect(isEditorScreen({ screen })).toBe(false);
        }
    });

    it("has a screen for every root the tab claims, and claims every screen's root", () => {
        for (const root of REWRITE_ROOTS) {
            expect(rewriteScreenFor(`/${root}`).screen).not.toBe("not-found");
            expect(isToolPath(`/${root}`, REWRITE_ROOTS)).toBe(true);
        }
        for (const path of [UNSAVED_REWRITE_PATH, WORKFLOW_PATH, rewritePath("7")]) {
            expect(isToolPath(path, REWRITE_ROOTS)).toBe(true);
        }
        // Site links stay site links: the workspace opens them, not this tab.
        expect(isToolPath("/employer/documents?source=d101", REWRITE_ROOTS)).toBe(false);
    });

    it("a saved rewrite's link opens the Rewrite tab at that rewrite", () => {
        expect(toolTabHref("rewrite", rewritePath("42"))).toBe(
            "/employer/documents?feature=rewrite&at=%2Frewrites%2F42"
        );
    });
});
