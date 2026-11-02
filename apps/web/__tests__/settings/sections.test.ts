/**
 * Who sees which settings section, per built-in role.
 *
 * Settings (yours alone) and the Workspace tab are open to everyone; each
 * section carries its own gate. The table below is the contract a reviewer
 * reads: You is everyone's, a section whose data is refused to a role is
 * left out for it, and a section a role may only read is shown read-only.
 */

import {
    BUILTIN_ROLE_PERMISSIONS,
    BUILTIN_ROLES,
    type BuiltinRole,
    type Permission,
} from "~/lib/authz/permissions";
import { SETTINGS } from "~/lib/settings/registry";
import {
    SETTINGS_SECTION_ACCESS,
    canSeeSettingsSection,
    settingsSectionFromHash,
} from "~/lib/settings/sections";
import { SETTINGS_SECTION_IDS, type SettingsSectionId } from "~/lib/settings/types";

function canFor(role: BuiltinRole) {
    return (p: Permission | undefined) => p === undefined || BUILTIN_ROLE_PERMISSIONS[role].has(p);
}

function visibleTo(role: BuiltinRole): SettingsSectionId[] {
    return SETTINGS_SECTION_IDS.filter(id => canSeeSettingsSection(id, canFor(role)));
}

function readOnlyFor(role: BuiltinRole): SettingsSectionId[] {
    const can = canFor(role);
    return visibleTo(role).filter(id => !can(SETTINGS_SECTION_ACCESS[id].edit));
}

const YOU: SettingsSectionId[] = ["account", "appearance", "shortcuts"];

describe("SETTINGS_SECTION_ACCESS", () => {
    it("gives every role the You sections, editable", () => {
        for (const role of BUILTIN_ROLES) {
            expect(visibleTo(role)).toEqual(expect.arrayContaining(YOU));
            for (const id of YOU) expect(readOnlyFor(role)).not.toContain(id);
        }
    });

    it("shows an Owner and an Admin every section, none of them read-only", () => {
        for (const role of ["owner", "admin"] as const) {
            expect(visibleTo(role)).toEqual([...SETTINGS_SECTION_IDS]);
            expect(readOnlyFor(role)).toEqual([]);
        }
    });

    it("shows a Member and a Viewer the people list and the readable policy, read-only", () => {
        for (const role of ["member", "viewer"] as const) {
            expect(visibleTo(role)).toEqual([
                "account",
                "appearance",
                "shortcuts",
                "general",
                "people",
                "company",
                "privacy",
                "labs",
            ]);
            expect(readOnlyFor(role)).toEqual(["general", "company", "labs"]);
        }
    });

    it("shows a Guest no member list", () => {
        expect(visibleTo("guest")).toEqual([
            "account",
            "appearance",
            "shortcuts",
            "general",
            "company",
            "privacy",
            "labs",
        ]);
    });

    it("lets everyone read the workspace's own details, and only settings.manage change them", () => {
        // The same gate as PATCH /api/workspace/details.
        expect(SETTINGS_SECTION_ACCESS.general.view).toBeUndefined();
        expect(SETTINGS_SECTION_ACCESS.general.edit).toBe("settings.manage");
    });

    it("leaves out every section whose own read the server refuses", () => {
        // The API gates behind each section's mount-time GET. A section is
        // never shown to someone its data would answer 403.
        const refusedReads: Partial<Record<SettingsSectionId, Permission>> = {
            byok: "settings.manage", // GET /api/settings/models/workspace
            models: "settings.manage", // GET /api/settings/models
            usage: "analytics.view", // GET /api/settings/usage
            archive: "settings.manage", // GET /api/settings/archive
            people: "members.view", // GET /api/workspace/members
        };
        for (const [section, permission] of Object.entries(refusedReads)) {
            expect(SETTINGS_SECTION_ACCESS[section as SettingsSectionId].view).toBe(permission);
        }
    });

    it("keeps the registry's write permission and its section's edit gate in step", () => {
        // A workspace-scoped row in a section gated on X is written with X.
        for (const definition of SETTINGS) {
            if (!definition.permission || !definition.scopes.includes("workspace")) continue;
            // People's one row is a policy card above the member list, which
            // every member may see; the row itself is read-only to them.
            if (definition.section === "people") continue;
            const { view, edit } =
                SETTINGS_SECTION_ACCESS[definition.workspaceSection ?? definition.section];
            expect({ key: definition.key, gate: edit ?? view }).toEqual({
                key: definition.key,
                gate: definition.permission,
            });
        }
    });

    it("puts a personal override where every role can change it", () => {
        // A setting with both a workspace default and a member override is
        // the member's to change; its row must not sit behind an admin gate.
        for (const definition of SETTINGS) {
            if (!definition.scopes.includes("member")) continue;
            const { key, section } = definition;
            for (const role of BUILTIN_ROLES) {
                expect({
                    key,
                    role,
                    sees: visibleTo(role).includes(section),
                    readOnly: readOnlyFor(role).includes(section),
                }).toEqual({ key, role, sees: true, readOnly: false });
            }
        }
    });

    it("draws the answer style twice: yours under Appearance, the workspace's for admins", () => {
        const style = SETTINGS.find(definition => definition.key === "chat.responseStyle")!;
        expect(style.section).toBe("appearance");
        expect(style.workspaceSection).toBe("agents");
        expect(visibleTo("member")).not.toContain("agents");
        expect(visibleTo("admin")).toContain("agents");
    });
});

describe("settingsSectionFromHash", () => {
    it("lands old deep links and registry keys where the hub did", () => {
        expect(settingsSectionFromHash("#byok")).toBe("byok");
        expect(settingsSectionFromHash("#processing")).toBe("byok");
        // The embedding key that lived here is gone; its old links still land.
        expect(settingsSectionFromHash("#embedding")).toBe("byok");
        expect(settingsSectionFromHash("#openrouter")).toBe("byok");
        expect(settingsSectionFromHash("#profile")).toBe("company");
        expect(settingsSectionFromHash("#keys")).toBe("byok");
        expect(settingsSectionFromHash("#models")).toBe("models");
        // Document defaults is gone, with no section of its own to land on.
        expect(settingsSectionFromHash("#documents")).toBeNull();
        expect(settingsSectionFromHash("#appearance.theme")).toBe("appearance");
        // Hashes arrive lower-cased; the personal row is the one everyone reaches.
        expect(settingsSectionFromHash("#chat.responseStyle")).toBe("appearance");
        expect(settingsSectionFromHash("#chat.responsestyle")).toBe("appearance");
        expect(settingsSectionFromHash("#nope")).toBeNull();
    });
});
