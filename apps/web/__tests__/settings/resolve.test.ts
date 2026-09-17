/**
 * The scope ladder: member beats folder beats workspace beats default, the
 * nearest folder ancestor wins, and a stored value the schema rejects is
 * ignored rather than served.
 */

import { z } from "zod";

import { resolveSetting, type StoredSettingRow } from "~/server/settings/resolve";
import type { SettingDefinition } from "~/lib/settings/registry";

const definition: SettingDefinition<string> = {
    key: "test.level",
    section: "documents",
    label: "Level",
    description: "",
    aliases: [],
    scopes: ["workspace", "folder", "member"],
    permission: "settings.manage",
    schema: z.enum(["a", "b", "c", "d"]),
    default: "a",
    control: { kind: "text" },
};

function row(scopeType: string, scopeId: string, value: unknown): StoredSettingRow {
    return { scopeType, scopeId, key: "test.level", value, updatedBy: "u1", updatedAt: null };
}

const viewer = { authUserId: "me", folderPath: "Legal/Contracts/2026", can: () => true };

describe("resolveSetting", () => {
    it("serves the default when nothing is stored", () => {
        const resolved = resolveSetting(definition, [], viewer);
        expect(resolved.value).toBe("a");
        expect(resolved.source).toBe("default");
        expect(resolved.stored).toEqual({});
    });

    it("walks the ladder from the most specific scope", () => {
        const rows = [
            row("workspace", "", "b"),
            row("folder", "Legal", "c"),
            row("member", "me", "d"),
        ];
        expect(resolveSetting(definition, rows, viewer).value).toBe("d");
        expect(resolveSetting(definition, rows.slice(0, 2), viewer).value).toBe("c");
        expect(resolveSetting(definition, rows.slice(0, 1), viewer).value).toBe("b");
    });

    it("picks the nearest folder ancestor", () => {
        const rows = [row("folder", "Legal", "b"), row("folder", "Legal/Contracts", "c")];
        const resolved = resolveSetting(definition, rows, viewer);
        expect(resolved.value).toBe("c");
        expect(resolved.source).toBe("folder");
        expect(resolved.sourceId).toBe("Legal/Contracts");
    });

    it("ignores folder rows off the path and other members' rows", () => {
        const rows = [row("folder", "Finance", "b"), row("member", "someone-else", "d")];
        expect(resolveSetting(definition, rows, viewer).source).toBe("default");
    });

    it("ignores a stored value the schema rejects", () => {
        const rows = [row("workspace", "", "not-a-level"), row("workspace", "", "b")];
        const resolved = resolveSetting(definition, rows, viewer);
        expect(resolved.value).toBe("b");
    });

    it("only offers the scopes the definition allows, gated on the permission", () => {
        const memberOnly = { ...definition, scopes: ["member"] as const, permission: null };
        const resolved = resolveSetting(memberOnly, [], viewer);
        expect(resolved.canEdit).toEqual({ workspace: false, folder: false, member: true });

        const denied = resolveSetting(definition, [], { ...viewer, can: () => false });
        expect(denied.canEdit).toEqual({ workspace: false, folder: false, member: true });
    });

    it("reports every stored scope so a row can say what a reset restores", () => {
        const rows = [row("workspace", "", "b"), row("member", "me", "d")];
        expect(resolveSetting(definition, rows, viewer).stored).toEqual({
            workspace: "b",
            member: "d",
        });
    });
});
