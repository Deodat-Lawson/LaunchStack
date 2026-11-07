/**
 * Settings is yours alone; the Workspace tab is everything else about the
 * workspace; Models & usage (the Usage tab) holds what the workspace spends
 * (Spending), its own API keys and its models. Every `/employer/settings#…`
 * link that ever worked, and every link to a Workspace screen that moved,
 * must still land, on whichever of them now holds what it named. This table
 * is the contract a reviewer reads.
 */

import { SETTINGS } from "~/lib/settings/registry";
import {
    PERSONAL_SECTION_IDS,
    USAGE_SECTION_PATHS,
    WORKSPACE_SCREEN_IDS,
    modelsUsageHref,
    settingsDestination,
    settingsSectionOfHref,
    workspaceHref,
    workspaceScreenFromPath,
} from "~/lib/settings/surfaces";
import { SETTINGS_SECTION_IDS } from "~/lib/settings/types";
import { TOOL_ALIASES, movedToolScreen, toolTargetFromHref } from "~/lib/tool-app/locations";
import { WORKSPACE_SCREEN_GROUPS } from "~/app/employer/documents/_workspace/WorkspaceTool";
import { DEMOTED_FEATURES } from "~/app/employer/documents/_workspace/types";

describe("the two surfaces", () => {
    it("split every section between them, once", () => {
        // Models & usage is the third place: Spending, API keys and Models.
        expect(USAGE_SECTION_PATHS).toEqual({
            usage: "/spending",
            byok: "/keys",
            models: "/models",
        });
        const all = [
            ...PERSONAL_SECTION_IDS,
            ...WORKSPACE_SCREEN_IDS,
            ...Object.keys(USAGE_SECTION_PATHS),
        ];
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
            ["setup", ["agents", "integrations"]],
            ["data", ["archive", "labs"]],
        ]);
    });

    it("no longer lists API keys or Models among the Workspace tab's screens", () => {
        for (const gone of ["byok", "models", "usage"]) {
            expect(WORKSPACE_SCREEN_IDS).not.toContain(gone);
        }
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
        ["#agents", "/agents"],
        ["#integrations", "/integrations"],
        ["#archive", "/archive"],
        ["#labs", "/labs"],
        // The company profile's old page.
        ["#metadata", "/company"],
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

    it.each([
        // The workspace's own model key; Processing was its name once, and the
        // embedding key it also held is gone.
        ["#byok", "/keys"],
        ["#processing", "/keys"],
        ["#embedding", "/keys"],
        ["#openrouter", "/keys"],
        ["#keys", "/keys"],
        ["#api key", "/keys"],
        ["#models", "/models"],
        ["#routes", "/models"],
        ["#llm", "/models"],
    ])("opens %s on Models & usage at %s", (hash, location) => {
        expect(settingsDestination(hash)).toEqual({
            kind: "app",
            featureId: "usage",
            href: `/employer/documents?feature=usage&at=${encodeURIComponent(location)}`,
            at: location,
        });
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

    it("sends links to the Workspace tab's old API keys and Models screens to Models & usage", () => {
        expect(toolTargetFromHref("/employer/documents?feature=workspace&at=%2Fbyok")).toEqual({
            toolId: "usage",
            at: "/keys",
        });
        expect(toolTargetFromHref("/employer/documents?feature=workspace&at=%2Fmodels")).toEqual({
            toolId: "usage",
            at: "/models",
        });
        // The page's own query (OpenRouter's outcome) is not the tab's.
        expect(
            toolTargetFromHref(
                "/employer/documents?feature=workspace&at=%2Fbyok&openrouter=connected"
            )
        ).toEqual({ toolId: "usage", at: "/keys" });
        // The palette's old row id.
        expect(toolTargetFromHref("/employer/documents?feature=byok")).toEqual({
            toolId: "usage",
            at: "/keys",
        });
    });

    it("says where a moved screen is now, its query kept, and nothing for one that stayed", () => {
        expect(movedToolScreen("workspace", "/byok?focus=byok")).toEqual({
            toolId: "usage",
            at: "/keys?focus=byok",
        });
        expect(movedToolScreen("workspace", "/models/")).toEqual({
            toolId: "usage",
            at: "/models",
        });
        expect(movedToolScreen("workspace", "/usage")).toEqual({
            toolId: "usage",
            at: "/spending",
        });
        expect(movedToolScreen("workspace", "/agents")).toBeNull();
        expect(movedToolScreen("usage", "/models")).toBeNull();
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
        expect(workspaceScreenFromPath("/agents/")).toBe("agents");
        // Moved to Models & usage.
        expect(workspaceScreenFromPath("/models")).toBeNull();
        expect(workspaceScreenFromPath("/byok")).toBeNull();
        expect(workspaceScreenFromPath("/processing")).toBeNull();
        expect(workspaceScreenFromPath("/people/8")).toBeNull();
    });

    it("rides the page's own query along, for OpenRouter's outcome", () => {
        expect(modelsUsageHref("keys", { query: { openrouter: "connected" } })).toBe(
            "/employer/documents?feature=usage&at=%2Fkeys&openrouter=connected"
        );
        expect(toolTargetFromHref(modelsUsageHref("keys"))).toEqual({
            toolId: "usage",
            at: "/keys",
        });
        expect(modelsUsageHref("models")).toBe("/employer/documents?feature=usage&at=%2Fmodels");
        expect(modelsUsageHref("keys", { focus: "byok" })).toBe(
            "/employer/documents?feature=usage&at=%2Fkeys%3Ffocus%3Dbyok"
        );
        expect(workspaceHref("people", { focus: "audit", query: { x: "1" } })).toBe(
            "/employer/documents?feature=workspace&at=%2Fpeople%3Ffocus%3Daudit&x=1"
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
        // API keys and Models are its screens too, however the link is written.
        expect(settingsSectionOfHref(modelsUsageHref("keys"))).toBe("byok");
        expect(settingsSectionOfHref(modelsUsageHref("models"))).toBe("models");
        expect(settingsSectionOfHref("/employer/documents?feature=byok")).toBe("byok");
        expect(settingsSectionOfHref("/employer/documents?feature=workspace&at=%2Fbyok")).toBe(
            "byok"
        );
        expect(settingsSectionOfHref("/employer/documents?feature=workspace&at=%2Fmodels")).toBe(
            "models"
        );
        expect(settingsSectionOfHref("/employer/documents?feature=usage&at=%2Fyou")).toBeNull();
    });

    it("opens the old company-profile pane and the palette's settings rows on their screens", () => {
        expect(TOOL_ALIASES.byok).toEqual({ toolId: "usage", at: "/keys" });
        expect(TOOL_ALIASES.metadata).toEqual({ toolId: "workspace", at: "/company" });
        for (const id of ["people-access", "profile", "agents-nodes", "byok"]) {
            const row = DEMOTED_FEATURES.find(feature => feature.id === id)!;
            // Picking the row (by id) and following its link land in the same place.
            expect(toolTargetFromHref(row.href)).toEqual(TOOL_ALIASES[id]);
        }
    });
});
