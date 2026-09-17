/**
 * The shortcut registry: canonical keys, event matching across platforms,
 * overrides and unbinding, and conflicts reported rather than forbidden.
 */

import {
    SHORTCUT_COMMANDS,
    canonicalKeys,
    commandForEvent,
    eventMatches,
    findConflicts,
    formatKeys,
    keysFromEvent,
    resolveBindings,
} from "~/lib/shortcuts/commands";

const press = (
    key: string,
    mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}
) => ({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
});

describe("shortcut registry", () => {
    it("declares unique ids and parseable defaults", () => {
        const ids = new Set<string>();
        for (const command of SHORTCUT_COMMANDS) {
            expect(ids.has(command.id)).toBe(false);
            ids.add(command.id);
            expect(canonicalKeys(command.defaultKeys)).not.toBeNull();
        }
        expect(findConflicts(resolveBindings(null)).size).toBe(0);
    });

    it("canonicalises modifier order and letter case", () => {
        expect(canonicalKeys("Shift+Mod+d")).toBe("Mod+Shift+D");
        expect(canonicalKeys("Bogus+K")).toBeNull();
    });

    it("treats Mod as ⌘ on a Mac and Ctrl elsewhere", () => {
        expect(eventMatches(press("k", { metaKey: true }), "Mod+K", "mac")).toBe(true);
        expect(eventMatches(press("k", { ctrlKey: true }), "Mod+K", "mac")).toBe(false);
        expect(eventMatches(press("k", { ctrlKey: true }), "Mod+K", "other")).toBe(true);
        expect(keysFromEvent(press("Meta", { metaKey: true }), "mac")).toBeNull();
    });

    it("formats for the platform", () => {
        expect(formatKeys("Mod+Shift+D", "mac")).toBe("⌘⇧D");
        expect(formatKeys("Mod+Shift+D", "other")).toBe("Ctrl+Shift+D");
    });

    it("applies overrides, ignores garbage, and honours an unbind", () => {
        const bindings = resolveBindings({
            "palette.toggle": "Mod+P",
            "source.add": null,
            "studio.toggle": "not a key combo+",
        });
        expect(bindings.get("palette.toggle")).toBe("Mod+P");
        expect(bindings.get("source.add")).toBeNull();
        expect(bindings.get("studio.toggle")).toBe("Mod+J");
    });

    it("dispatches the matching command and respects outside-input", () => {
        const bindings = resolveBindings(null);
        expect(commandForEvent(press("/"), bindings, { inInput: false, platform: "mac" })?.id).toBe(
            "search.focus"
        );
        expect(
            commandForEvent(press("/"), bindings, { inInput: true, platform: "mac" })
        ).toBeNull();
        expect(
            commandForEvent(press("k", { metaKey: true }), bindings, {
                inInput: true,
                platform: "mac",
            })?.id
        ).toBe("palette.toggle");
    });

    it("reports a shared binding", () => {
        const conflicts = findConflicts(resolveBindings({ "source.add": "Mod+K" }));
        expect(conflicts.get("Mod+K")).toEqual(["palette.toggle", "source.add"]);
    });
});
