/**
 * The Usage tab's screens and their paths, so a deep link keeps working
 * whoever last clicked through the tab.
 */

import {
    isTeamScreen,
    usagePaths,
    usageScreenFor,
} from "~/app/employer/documents/_workspace/usage/screens";

describe("usageScreenFor", () => {
    it.each([
        ["/", { kind: "overview" }],
        ["/overview", { kind: "overview" }],
        ["/people", { kind: "people" }],
        ["/people/12", { kind: "person", id: 12 }],
        ["/activity", { kind: "activity" }],
        ["/documents", { kind: "documents" }],
        ["/you", { kind: "you" }],
        ["/spending", { kind: "spending" }],
        ["/people/ada", { kind: "not-found" }],
        ["/people/12/more", { kind: "not-found" }],
        ["/overview/x", { kind: "not-found" }],
        ["/analytics", { kind: "not-found" }],
    ])("reads %s", (path, screen) => {
        expect(usageScreenFor(path)).toEqual(screen);
    });

    it("keeps everything but You for those who may see the workspace's numbers", () => {
        expect(isTeamScreen({ kind: "you" })).toBe(false);
        expect(isTeamScreen({ kind: "not-found" })).toBe(false);
        for (const kind of ["overview", "people", "activity", "documents", "spending"] as const) {
            expect(isTeamScreen({ kind })).toBe(true);
        }
        expect(isTeamScreen({ kind: "person", id: 3 })).toBe(true);
    });
});

describe("usagePaths", () => {
    it("writes the links the screens use", () => {
        expect(usagePaths.person(4)).toBe("/people/4");
        expect(usagePaths.activity()).toBe("/activity");
        expect(usagePaths.activity({ person: 4, feature: "ask" })).toBe(
            "/activity?person=4&feature=ask"
        );
        expect(usagePaths.spending("usage.memberMonthlyTokenLimit")).toBe(
            "/spending?focus=usage.memberMonthlyTokenLimit"
        );
    });
});
