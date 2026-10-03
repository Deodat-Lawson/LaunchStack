/**
 * The server half of a setting with a workspace default and a personal
 * override: anyone may write their own value, only the permission writes the
 * workspace's, and the chat route reads whichever wins for the person asking.
 *
 * Pinned on `chat.responseStyle`, the setting that has both.
 */

import { settingsValues, workspaceAuditEvents } from "~/server/db/schema";
import { readSettingValue, writeSetting } from "~/server/settings/store";

import { fakeDb } from "../helpers/fake-db";
import { makeWorkspaceContext } from "../helpers/workspace-context";

jest.mock("~/server/db", () => ({ db: jest.requireActual("../helpers/fake-db").fakeDb.db }));

const KEY = "chat.responseStyle";

function stored(scopeType: string, scopeId: string, value: unknown) {
    return { scopeType, scopeId, key: KEY, value, updatedBy: "someone", updatedAt: null };
}

beforeEach(() => fakeDb.reset());

describe("writeSetting for the answer style", () => {
    it("lets a Member store their own choice, unaudited", async () => {
        const member = makeWorkspaceContext({ authUserId: "u-member", role: "member" });
        expect(member.can("settings.manage")).toBe(false);
        // No row yet; then the re-read after the write finds it.
        fakeDb.onSelect(settingsValues, [], [stored("member", "u-member", "detailed")]);

        const resolved = await writeSetting(member, {
            key: KEY,
            scope: "member",
            value: "detailed",
        });

        expect(fakeDb.insertedInto(settingsValues)).toEqual([
            expect.objectContaining({
                scopeType: "member",
                scopeId: "u-member",
                value: "detailed",
            }),
        ]);
        expect(fakeDb.insertedInto(workspaceAuditEvents)).toEqual([]);
        expect(resolved).toEqual(
            expect.objectContaining({
                value: "detailed",
                source: "member",
                canEdit: { workspace: false, folder: false, member: true },
            })
        );
    });

    it("refuses a Member the workspace default", async () => {
        const member = makeWorkspaceContext({ authUserId: "u-member", role: "member" });

        await expect(
            writeSetting(member, { key: KEY, scope: "workspace", value: "detailed" })
        ).rejects.toMatchObject({ status: 403 });
        expect(fakeDb.inserts).toEqual([]);
    });

    it("refuses anyone else's personal value", async () => {
        const admin = makeWorkspaceContext({ authUserId: "u-admin", role: "admin" });

        await expect(
            writeSetting(admin, {
                key: KEY,
                scope: "member",
                scopeId: "u-member",
                value: "detailed",
            })
        ).rejects.toMatchObject({ status: 403 });
        expect(fakeDb.inserts).toEqual([]);
    });

    it("lets an admin set the workspace default, and audits it", async () => {
        const admin = makeWorkspaceContext({ authUserId: "u-admin", role: "admin" });
        fakeDb.onSelect(settingsValues, [], [stored("workspace", "", "organized")]);

        const resolved = await writeSetting(admin, {
            key: KEY,
            scope: "workspace",
            value: "organized",
        });

        expect(fakeDb.insertedInto(settingsValues)).toEqual([
            expect.objectContaining({ scopeType: "workspace", scopeId: "", value: "organized" }),
        ]);
        expect(fakeDb.insertedInto(workspaceAuditEvents)).toEqual([
            expect.objectContaining({
                action: "settings.changed",
                targetId: KEY,
                detail: expect.objectContaining({ scope: "workspace", to: "organized" }) as unknown,
            }),
        ]);
        expect(resolved).toEqual(
            expect.objectContaining({ value: "organized", source: "workspace" })
        );
    });
});

describe("readSettingValue for the answer style", () => {
    const member = makeWorkspaceContext({ authUserId: "u-member", role: "member" });

    it("serves the workspace default to someone who has not picked their own", async () => {
        fakeDb.onSelect(settingsValues, [stored("workspace", "", "academic")]);
        await expect(readSettingValue(member, KEY)).resolves.toBe("academic");
    });

    it("serves a person's own choice over the workspace default", async () => {
        fakeDb.onSelect(settingsValues, [
            stored("workspace", "", "academic"),
            stored("member", "u-member", "detailed"),
        ]);
        await expect(readSettingValue(member, KEY)).resolves.toBe("detailed");
    });
});
