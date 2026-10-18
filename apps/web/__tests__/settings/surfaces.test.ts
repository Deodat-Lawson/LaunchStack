/**
 * Settings is yours alone; the Workspace tab is everything about the
 * workspace. Every `/employer/settings#…` link that ever worked must still
 * land, on whichever of the two now holds what it named. This table is the
 * contract a reviewer reads.
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
        const both = [...PERSONAL_SECTION_IDS, ...WORKSPACE_SCREEN_IDS];
        expect(new Set(both).size).toBe(both.length);
        expect([...both].sort()).toEqual([...SETTINGS_SECTION_IDS].sort());
        expect(PERSONAL_SECTION_IDS).toEqual(["account", "appearance", "shortcuts", "privacy"]);
    });

    it("has no Processing section any more", () => {
        expect(SETTINGS_SECTION_IDS).not.toContain("processing");
        expect(SETTINGS.some(definition => definition.section === ("processing" as never))).toBe(
            false
        );
    });

    it("puts every Workspace screen in exactly one group of the bar, in order", () => {
        const grouped = WORKSPACE_SCREEN_GROUPS.flatMap(group => group.screens);
        expect(grouped).toEqual([...WORKSPACE_SCREEN_IDS]);
        expect(WORKSPACE_SCREEN_GROUPS.every(group => group.label)).toBe(true);
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
        ["#documents", "/documents"],
        ["#integrations", "/integrations"],
        ["#usage", "/usage"],
        ["#archive", "/archive"],
        ["#labs", "/labs"],
        // The company profile's old page.
        ["#metadata", "/company"],
        // Bring-your-own-model lives on Models; so do the retired Processing
        // section's links.
        ["#byok", "/models"],
        ["#processing", "/models"],
        ["#embedding", "/models"],
        ["#general", "/general"],
        ["#employees", "/people"],
    ])("opens %s on the Workspace tab at %s", (hash, location) => {
        expect(at(hash)).toBe(location);
    });

    it("carries a registry row in a workspace section as the screen's focus, in its own case", () => {
        expect(at("#documents.defaultProcessingMethod")).toBe(
            "/documents?focus=documents.defaultProcessingMethod"
        );
        expect(at("#usage.priceperMillionTokens")).toBe("/usage?focus=usage.pricePerMillionTokens");
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

    it("sends the analytics hashes to the Analytics tab", () => {
        expect(settingsDestination("#statistics")).toEqual({
            kind: "app",
            featureId: "analytics",
            href: "/employer/documents?feature=analytics",
        });
    });

    it("guesses nothing for a hash nobody knows", () => {
        expect(settingsDestination("#nope")).toBeNull();
    });

    it("builds a link that opens that place", () => {
        const destination = settingsDestination("#usage.pricePerMillionTokens");
        expect(destination?.kind).toBe("workspace");
        if (destination?.kind !== "workspace") return;
        expect(toolTargetFromHref(destination.href)).toEqual({
            toolId: "workspace",
            at: "/usage?focus=usage.pricePerMillionTokens",
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
        expect(workspaceHref("models", { query: { openrouter: "connected" } })).toBe(
            "/employer/documents?feature=workspace&at=%2Fmodels&openrouter=connected"
        );
    });

    it("names the section a link opens, either way it is written", () => {
        expect(settingsSectionOfHref("/employer/settings#byok")).toBe("models");
        expect(settingsSectionOfHref("/employer/settings#appearance.theme")).toBe("appearance");
        expect(settingsSectionOfHref("/employer/settings")).toBeNull();
        expect(settingsSectionOfHref(workspaceHref("people", { focus: "audit" }))).toBe("people");
        expect(settingsSectionOfHref("/employer/documents?feature=workspace")).toBeNull();
        expect(settingsSectionOfHref("/employer/documents?feature=agents-nodes")).toBe("agents");
        expect(settingsSectionOfHref("/employer/documents?feature=growth&at=%2Fbrand")).toBeNull();
    });

    it("opens the old company-profile pane and the palette's workspace rows on their screens", () => {
        expect(TOOL_ALIASES.metadata).toEqual({ toolId: "workspace", at: "/company" });
        for (const id of ["people-access", "profile", "agents-nodes"]) {
            const row = DEMOTED_FEATURES.find(feature => feature.id === id)!;
            // Picking the row (by id) and following its link land in the same place.
            expect(toolTargetFromHref(row.href)).toEqual(TOOL_ALIASES[id]);
        }
    });
});
