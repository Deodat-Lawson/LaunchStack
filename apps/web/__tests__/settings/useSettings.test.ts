/**
 * The client store's scope decisions: which scope a plain write targets, and
 * what a row pinned to a scope shows. The second is what keeps an admin's own
 * answer style from posing as the workspace default.
 */

import { getSetting, type SettingDefinition } from "~/lib/settings/registry";
import type { ResolvedSetting } from "~/lib/settings/types";
import {
    defaultWriteScope,
    resetSettingsForTests,
    settingAtScope,
    writeSettingValue,
} from "~/lib/settings/useSettings";

const style = getSetting("chat.responseStyle") as SettingDefinition<string>;

function resolved(
    partial: Partial<ResolvedSetting<string>> & Pick<ResolvedSetting<string>, "value" | "source">
): ResolvedSetting<string> {
    return {
        key: "chat.responseStyle",
        sourceId: null,
        updatedBy: null,
        updatedAt: null,
        canEdit: { workspace: true, folder: false, member: true },
        stored: {},
        ...partial,
    };
}

describe("defaultWriteScope", () => {
    it("writes a setting with a personal override at member scope unless told otherwise", () => {
        // Why the Agents row has to pin its scope: left alone, an admin's
        // change there would only ever be their own.
        expect(defaultWriteScope(style, null)).toBe("member");
    });

    it("writes a folder-scoped setting on the folder in view, else the workspace", () => {
        const processing = getSetting("documents.defaultProcessingMethod")!;
        expect(defaultWriteScope(processing, "Legal")).toBe("folder");
        expect(defaultWriteScope(processing, null)).toBe("workspace");
    });
});

describe("settingAtScope", () => {
    it("shows the default before the server answers", () => {
        expect(settingAtScope(style, null, "workspace")).toEqual({
            value: "concise",
            source: "default",
        });
    });

    it("shows the workspace row the workspace's value, not the viewer's own", () => {
        const both = resolved({
            value: "detailed",
            source: "member",
            sourceId: "u-admin",
            stored: { workspace: "organized", member: "detailed" },
        });
        expect(settingAtScope(style, both, "workspace")).toEqual({
            value: "organized",
            source: "workspace",
        });
        expect(settingAtScope(style, both, "member")).toEqual({
            value: "detailed",
            source: "member",
        });
    });

    it("falls back to the default when only a personal value is stored", () => {
        const own = resolved({
            value: "academic",
            source: "member",
            stored: { member: "academic" },
        });
        expect(settingAtScope(style, own, "workspace")).toEqual({
            value: "concise",
            source: "default",
        });
    });

    it("leaves a row at or above the winning scope exactly as resolved", () => {
        const workspaceOnly = resolved({
            value: "organized",
            source: "workspace",
            stored: { workspace: "organized" },
        });
        // The personal row inherits; its provenance says from where.
        expect(settingAtScope(style, workspaceOnly, "member")).toEqual({
            value: "organized",
            source: "workspace",
        });
        expect(settingAtScope(style, workspaceOnly, "workspace")).toEqual({
            value: "organized",
            source: "workspace",
        });
    });

    it("walks folder before workspace when the row writes at folder scope", () => {
        const processing = getSetting("documents.defaultProcessingMethod")!;
        const ladder: ResolvedSetting = {
            key: processing.key,
            value: "azure",
            source: "member",
            sourceId: "u1",
            updatedBy: null,
            updatedAt: null,
            canEdit: { workspace: true, folder: true, member: false },
            stored: { workspace: "standard", folder: "docling", member: "azure" },
        };
        expect(settingAtScope(processing, ladder, "folder")).toEqual({
            value: "docling",
            source: "folder",
        });
    });
});

describe("writeSettingValue", () => {
    const originalFetch = global.fetch;
    afterEach(() => {
        global.fetch = originalFetch;
        resetSettingsForTests();
    });

    it("sends the scope it is given", async () => {
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () =>
                Promise.resolve({
                    setting: resolved({
                        value: "organized",
                        source: "workspace",
                        stored: { workspace: "organized" },
                    }),
                }),
        });
        global.fetch = fetchMock as unknown as typeof fetch;

        await writeSettingValue({
            key: "chat.responseStyle",
            scope: "workspace",
            value: "organized",
        });

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(init.body as string)).toEqual({
            key: "chat.responseStyle",
            scope: "workspace",
            value: "organized",
        });
    });
});
