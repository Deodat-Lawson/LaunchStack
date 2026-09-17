/**
 * The settings registry is the index everything else reads: search, deep
 * links, permissions, validation. These pin the properties the panel relies
 * on rather than the contents, which will change.
 */

import { SETTINGS, getSetting, searchSettings, settingsForSection } from "~/lib/settings/registry";
import { SETTINGS_SECTION_IDS } from "~/lib/settings/types";
import { PERMISSIONS } from "~/lib/authz/permissions";

describe("settings registry", () => {
    it("declares every key once, in a known section, with a default its own schema accepts", () => {
        const keys = new Set<string>();
        for (const definition of SETTINGS) {
            expect(keys.has(definition.key)).toBe(false);
            keys.add(definition.key);
            expect(SETTINGS_SECTION_IDS).toContain(definition.section);
            expect(definition.schema.safeParse(definition.default).success).toBe(true);
            expect(definition.scopes.length).toBeGreaterThan(0);
            if (definition.permission !== null)
                expect(PERMISSIONS).toContain(definition.permission);
        }
    });

    it("keeps member-scoped settings free of a permission gate", () => {
        for (const definition of SETTINGS) {
            if (definition.scopes.includes("member") && definition.scopes.length === 1) {
                expect(definition.permission).toBeNull();
            }
        }
    });

    it("never registers a secret", () => {
        for (const definition of SETTINGS) {
            expect(definition.key).not.toMatch(/api[_-]?key|secret|password|credential/i);
        }
    });

    it("finds a setting by what people call it", () => {
        expect(searchSettings("dark mode")[0]?.key).toBe("appearance.theme");
        expect(searchSettings("hotkeys")[0]?.key).toBe("shortcuts.bindings");
        expect(searchSettings("permission mode")[0]?.key).toBe("agents.defaultAutonomy");
        expect(searchSettings("")).toEqual([]);
    });

    it("ranks an exact label above a description hit", () => {
        const results = searchSettings("theme");
        expect(results[0]?.key).toBe("appearance.theme");
    });

    it("groups rows by section and resolves keys", () => {
        expect(settingsForSection("appearance").map(d => d.key)).toEqual([
            "appearance.theme",
            "appearance.density",
            "appearance.reducedMotion",
        ]);
        expect(getSetting("nope")).toBeUndefined();
    });
});
