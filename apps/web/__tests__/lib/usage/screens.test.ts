/**
 * The Models & usage tab's screens and their paths, so a deep link keeps
 * working whoever last clicked through the tab, and who may open which.
 */

import {
    isTeamScreen,
    usagePaths,
    usageRedirectFor,
    usageScreenFor,
    type UsageAccess,
    type UsageScreen,
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
        ["/models", { kind: "models" }],
        ["/keys", { kind: "keys" }],
        ["/spending", { kind: "spending" }],
        ["/people/ada", { kind: "not-found" }],
        ["/people/12/more", { kind: "not-found" }],
        ["/overview/x", { kind: "not-found" }],
        ["/keys/openrouter", { kind: "not-found" }],
        ["/analytics", { kind: "not-found" }],
        // The Workspace tab's old path for API keys is not a screen here.
        ["/byok", { kind: "not-found" }],
    ])("reads %s", (path, screen) => {
        expect(usageScreenFor(path)).toEqual(screen);
    });

    it("keeps the workspace's numbers for those who may see them, and You, Models and API keys apart", () => {
        for (const kind of ["you", "models", "keys", "not-found"] as const) {
            expect(isTeamScreen({ kind })).toBe(false);
        }
        for (const kind of ["overview", "people", "activity", "documents", "spending"] as const) {
            expect(isTeamScreen({ kind })).toBe(true);
        }
        expect(isTeamScreen({ kind: "person", id: 3 })).toBe(true);
    });
});

describe("usageRedirectFor", () => {
    const ADMIN: UsageAccess = { team: true, manageModels: true };
    const MEMBER: UsageAccess = { team: false, manageModels: false };
    const ANALYST: UsageAccess = { team: true, manageModels: false };
    const MODEL_KEEPER: UsageAccess = { team: false, manageModels: true };
    const every: UsageScreen[] = [
        { kind: "overview" },
        { kind: "people" },
        { kind: "person", id: 4 },
        { kind: "activity" },
        { kind: "documents" },
        { kind: "you" },
        { kind: "models" },
        { kind: "keys" },
        { kind: "spending" },
        { kind: "not-found" },
    ];
    const opens = (access: UsageAccess) =>
        every.filter(screen => usageRedirectFor(screen, access) === null).map(s => s.kind);

    it("lets an Owner or Admin open every screen", () => {
        expect(opens(ADMIN)).toEqual(every.map(s => s.kind));
    });

    it("gives a Member You and Models, and sends every other path to You", () => {
        expect(opens(MEMBER)).toEqual(["you", "models"]);
        for (const screen of every) {
            if (screen.kind === "you" || screen.kind === "models") continue;
            expect(usageRedirectFor(screen, MEMBER)).toBe("/you");
        }
    });

    it("sends someone who sees the numbers but may not manage the models from API keys to Models", () => {
        expect(usageRedirectFor({ kind: "keys" }, ANALYST)).toBe("/models");
        expect(opens(ANALYST)).not.toContain("keys");
        expect(opens(ANALYST)).toContain("spending");
    });

    it("gives a role that manages the models without the numbers You, Models and API keys", () => {
        expect(opens(MODEL_KEEPER)).toEqual(["you", "models", "keys"]);
        expect(usageRedirectFor({ kind: "spending" }, MODEL_KEEPER)).toBe("/you");
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
        expect(usagePaths.models()).toBe("/models");
        expect(usagePaths.keys()).toBe("/keys");
        expect(usagePaths.keys("byok")).toBe("/keys?focus=byok");
    });
});
