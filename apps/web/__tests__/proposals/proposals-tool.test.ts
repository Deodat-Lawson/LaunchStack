/**
 * Proposals is a tab of the workspace: its screens are app-relative paths
 * inside the tab, and `proposalsScreenFor` is the switch that replaced the
 * route folders. These pin every path, the unknown ones, and that every old
 * `/employer/tools/proposals/...` URL — bookmarks, redirect pages, the todo
 * links the server still builds — lands on the screen it used to show.
 */
import {
    PROPOSALS_ROOTS,
    proposalsScreenFor,
    type ProposalsScreen,
} from "~/app/employer/tools/proposals/_lib/screens";
import { isToolPath, parseToolHref, toolTargetFromHref } from "~/lib/tool-app/locations";

describe("proposalsScreenFor", () => {
    it.each<[string, ProposalsScreen]>([
        ["/", { screen: "home" }],
        ["", { screen: "home" }],
        ["/write", { screen: "applications" }],
        ["/write/12", { screen: "application", id: "12" }],
        [
            "/write/7f9c2b1e-3a4d-4c5e-9f00-1234567890ab",
            { screen: "application", id: "7f9c2b1e-3a4d-4c5e-9f00-1234567890ab" },
        ],
        ["/funders", { screen: "funders" }],
        ["/profile", { screen: "profile" }],
        ["/library", { screen: "library" }],
    ])("%s shows its screen", (path, screen) => {
        expect(proposalsScreenFor(path)).toEqual(screen);
    });

    it("decodes an encoded application id, and keeps a malformed one as typed", () => {
        expect(proposalsScreenFor("/write/a%20b")).toEqual({ screen: "application", id: "a b" });
        expect(proposalsScreenFor("/write/100%")).toEqual({ screen: "application", id: "100%" });
    });

    it.each([
        "/nope",
        "/write/12/sections",
        "/funders/3",
        "/profile/edit",
        "/library/1",
        "/employer/tools/proposals",
        "/Write",
    ])("%s is not a screen", path => {
        expect(proposalsScreenFor(path)).toEqual({ screen: "not-found" });
    });

    it("has a screen for every root the tab claims, and claims every screen's root", () => {
        for (const root of PROPOSALS_ROOTS) {
            expect(proposalsScreenFor(`/${root}`).screen).not.toBe("not-found");
            expect(isToolPath(`/${root}`, PROPOSALS_ROOTS)).toBe(true);
        }
        expect(isToolPath("/write/12", PROPOSALS_ROOTS)).toBe(true);
        // Site links stay site links: the workspace opens them, not this tab.
        expect(isToolPath("/employer/documents?source=d101", PROPOSALS_ROOTS)).toBe(false);
    });
});

describe("old Proposals URLs", () => {
    it.each<[string, ProposalsScreen, string]>([
        ["/employer/tools/proposals", { screen: "home" }, ""],
        ["/employer/tools/proposals/write", { screen: "applications" }, ""],
        ["/employer/tools/proposals/write/12", { screen: "application", id: "12" }, ""],
        ["/employer/tools/proposals/funders", { screen: "funders" }, ""],
        ["/employer/tools/proposals/profile", { screen: "profile" }, ""],
        ["/employer/tools/proposals/library?q=budget", { screen: "library" }, "?q=budget"],
    ])("%s opens the Proposals tab on the same screen", (href, screen, search) => {
        const target = toolTargetFromHref(href);
        expect(target?.toolId).toBe("proposals");
        const location = parseToolHref(target!.at);
        expect(proposalsScreenFor(location.path)).toEqual(screen);
        expect(location.search).toBe(search);
    });
});
