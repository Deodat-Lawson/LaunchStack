/**
 * Settings is yours alone; the Workspace tab is everything about the
 * workspace; the Usage tab's Spending screen holds what the workspace spends.
 * Every `/employer/settings#…` link that ever worked must still land, on
 * whichever of them now holds what it named. This table is the contract a
 * reviewer reads.
 */

import { SETTINGS } from "~/lib/settings/registry";
import {
    PERSONAL_SECTION_IDS,
    WORKSPACE_SCREEN_IDS,
    settingsDestination,
    settingsSectionOfHref,
    workspaceHref,
    workspaceScreenFromPath,
} from "~/lib/settings/surfaces";
import { SETTINGS_SECTION_IDS } from "~/lib/settings/types";
import { TOOL_ALIASES, toolTargetFromHref } from "~/lib/tool-app/locations";
import { WORKSPACE_SCREEN_GROUPS } from "~/app/employer/documents/_workspace/WorkspaceTool";
import { DEMOTED_FEATURES } from "~/app/employer/documents/_workspace/types";

describe("the two surfaces", () => {
    it("split every section between them, once", () => {
        // Usage is the third place: the Usage tab's Spending screen.
        const all = [...PERSONAL_SECTION_IDS, ...WORKSPACE_SCREEN_IDS, "usage"];
        expect(new Set(all).size).toBe(all.length);
        expect([...all].sort()).toEqual([...SETTINGS_SECTION_IDS].sort());
        expect(PERSONAL_SECTION_IDS).toEqual(["account", "appearance", "shortcuts", "privacy"]);
    });

    it("has no Processing or Document defaults section any more", () => {
        for (const gone of ["processing", "documents"]) {
            expect(SETTINGS_SECTION_IDS).not.toContain(gone);
            expect(SETTINGS.some(definition => definition.section === (gone as never))).toBe(false);
        }
    });

    it("puts every Workspace screen in exactly one group of the bar, in order", () => {
        const grouped = WORKSPACE_SCREEN_GROUPS.flatMap(group => group.screens);
        expect(grouped).toEqual([...WORKSPACE_SCREEN_IDS]);
        expect(WORKSPACE_SCREEN_GROUPS.map(group => [group.id, [...group.screens]])).toEqual([
            ["basics", ["general", "people", "company"]],
            ["setup", ["byok", "models", "agents", "integrations"]],
            ["data", ["archive", "labs"]],
        ]);
    });
});

describe("settingsDestination", () => {
    const at = (hash: string) => {
        const destination = settingsDestination(hash);
        return destination?.kind === "workspace" ? destination.at : destination;
    };

    it.each([
        ["#people", "/people"],
        ["#company", "/company"],
        ["#models", "/models"],
        ["#agents", "/agents"],
        ["#integrations", "/integrations"],
        ["#archive", "/archive"],
        ["#labs", "/labs"],
        // The company profile's old page.
        ["#metadata", "/company"],
        // The workspace's own model key; Processing was its name once, and the
        // embedding key it also held is gone.
        ["#byok", "/byok"],
        ["#processing", "/byok"],
        ["#embedding", "/byok"],
        ["#openrouter", "/byok"],
        ["#keys", "/byok"],
        // Document defaults is gone; its links open where the tab opens.
        ["#documents", "/general"],
        ["#documents.defaultProcessingMethod", "/general"],
        ["#documents.uploadStorage", "/general"],
        ["#general", "/general"],
        ["#employees", "/people"],
    ])("opens %s on the Workspace tab at %s", (hash, location) => {
        expect(at(hash)).toBe(location);
    });

    it("carries a registry row in a workspace section as the screen's focus, in its own case", () => {
        expect(at("#retention.trashDays")).toBe("/archive?focus=retention.trashDays");
        expect(at("#workspace.auditRetentionDays")).toBe(
            "/people?focus=workspace.auditRetentionDays"
        );
        expect(at("#agents.defaultAutonomy")).toBe("/agents?focus=agents.defaultAutonomy");
    });

    it("opens People on the tab a hash names", () => {
        expect(at("#audit")).toBe("/people?focus=audit");
        expect(at("#invitations")).toBe("/people?focus=invitations");
        expect(at("#people")).toBe("/people");
    });

    it("keeps what is yours in Settings, a row of it included", () => {
        expect(settingsDestination("#account")).toEqual({
            kind: "settings",
            section: "account",
            hash: "account",
        });
        expect(settingsDestination("#appearance.theme")).toMatchObject({
            kind: "settings",
            section: "appearance",
        });
        // The personal answer-style row, which every role reaches.
        expect(settingsDestination("#chat.responseStyle")).toMatchObject({
            kind: "settings",
            section: "appearance",
            hash: "chat.responseStyle",
        });
        expect(settingsDestination("#privacy")).toMatchObject({ section: "privacy" });
        expect(settingsDestination("")).toEqual({ kind: "settings", section: null, hash: "" });
    });

    it("sends the analytics hashes to the Usage tab, which Analytics folded into", () => {
        for (const hash of ["#analytics", "#statistics", "#stats"]) {
            // Always the Overview, wherever the tab was last.
            expect(settingsDestination(hash)).toEqual({
                kind: "app",
                featureId: "usage",
                href: "/employer/documents?feature=usage&at=%2Foverview",
                at: "/overview",
            });
        }
    });

    it("opens #usage and its rows on the Usage tab's Spending screen", () => {
        expect(settingsDestination("#usage")).toEqual({
            kind: "app",
            featureId: "usage",
            href: "/employer/documents?feature=usage&at=%2Fspending",
            at: "/spending",
        });
        // A row keeps its own case, as the Workspace rows do.
        expect(settingsDestination("#usage.priceperMillionTokens")).toMatchObject({
            kind: "app",
            featureId: "usage",
            at: "/spending?focus=usage.pricePerMillionTokens",
        });
        for (const alias of ["#costs", "#credits", "#balance"]) {
            expect(settingsDestination(alias)).toMatchObject({
                featureId: "usage",
                at: "/spending",
            });
        }
    });

    it("guesses nothing for a hash nobody knows", () => {
        expect(settingsDestination("#nope")).toBeNull();
    });

    it("builds a link that opens that place", () => {
        const destination = settingsDestination("#retention.trashDays");
        expect(destination?.kind).toBe("workspace");
        if (destination?.kind !== "workspace") return;
        expect(toolTargetFromHref(destination.href)).toEqual({
            toolId: "workspace",
            at: "/archive?focus=retention.trashDays",
        });
        const spending = settingsDestination("#usage.pricePerMillionTokens");
        expect(spending?.kind).toBe("app");
        if (spending?.kind !== "app") return;
        expect(toolTargetFromHref(spending.href)).toEqual({
            toolId: "usage",
            at: "/spending?focus=usage.pricePerMillionTokens",
        });
    });

    it("sends a link to the Workspace tab's old Usage screen to Spending, its focus kept", () => {
        expect(
            toolTargetFromHref(
                "/employer/documents?feature=workspace&at=%2Fusage%3Ffocus%3Dusage.memberMonthlyTokenLimit"
            )
        ).toEqual({ toolId: "usage", at: "/spending?focus=usage.memberMonthlyTokenLimit" });
        expect(toolTargetFromHref("/employer/documents?feature=workspace&at=%2Fusage")).toEqual({
            toolId: "usage",
            at: "/spending",
        });
        expect(toolTargetFromHref("/employer/documents?feature=analytics")).toEqual({
            toolId: "usage",
            at: "/overview",
        });
    });
});

describe("Workspace tab links", () => {
    it("reads a screen out of a path inside the tab", () => {
        expect(workspaceScreenFromPath("/")).toBe("general");
        expect(workspaceScreenFromPath("/people?focus=audit")).toBe("people");
        expect(workspaceScreenFromPath("/models/")).toBe("models");
        expect(workspaceScreenFromPath("/processing")).toBeNull();
        expect(workspaceScreenFromPath("/people/8")).toBeNull();
    });

    it("rides the page's own query along, for OpenRouter's outcome", () => {
        expect(workspaceHref("byok", { query: { openrouter: "connected" } })).toBe(
            "/employer/documents?feature=workspace&at=%2Fbyok&openrouter=connected"
        );
    });

    it("names the section a link opens, either way it is written", () => {
        expect(settingsSectionOfHref("/employer/settings#byok")).toBe("byok");
        expect(settingsSectionOfHref("/employer/settings#documents")).toBeNull();
        expect(settingsSectionOfHref("/employer/settings#appearance.theme")).toBe("appearance");
        expect(settingsSectionOfHref("/employer/settings")).toBeNull();
        expect(settingsSectionOfHref(workspaceHref("people", { focus: "audit" }))).toBe("people");
        expect(settingsSectionOfHref("/employer/documents?feature=workspace")).toBeNull();
        expect(settingsSectionOfHref("/employer/documents?feature=agents-nodes")).toBe("agents");
        expect(settingsSectionOfHref("/employer/documents?feature=growth&at=%2Fbrand")).toBeNull();
        // The usage section is the Usage tab's Spending screen, and only that screen.
        expect(settingsSectionOfHref("/employer/documents?feature=usage&at=%2Fspending")).toBe(
            "usage"
        );
        expect(settingsSectionOfHref("/employer/documents?feature=spending")).toBe("usage");
        expect(settingsSectionOfHref("/employer/documents?feature=usage&at=%2Fpeople")).toBeNull();
    });

    it("opens the old company-profile pane and the palette's workspace rows on their screens", () => {
        expect(TOOL_ALIASES.metadata).toEqual({ toolId: "workspace", at: "/company" });
        for (const id of ["people-access", "profile", "agents-nodes", "byok"]) {
            const row = DEMOTED_FEATURES.find(feature => feature.id === id)!;
            // Picking the row (by id) and following its link land in the same place.
            expect(toolTargetFromHref(row.href)).toEqual(TOOL_ALIASES[id]);
        }
    });
});
