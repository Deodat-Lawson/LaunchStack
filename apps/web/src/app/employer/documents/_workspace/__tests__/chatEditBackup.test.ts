/** @jest-environment jsdom */
import { backupChatEdit, removeChatEditBackup } from "../chatEditBackup";
import type { ComposerSend } from "../types";
const send: ComposerSend = {
    text: "The removed question",
    refs: ["d7"],
    attachments: [
        {
            id: "file",
            name: "note.txt",
            mimeType: "text/plain",
            size: 10,
            url: "https://files.test/note",
            kind: "text",
        },
    ],
    webSearch: true,
    thinking: true,
    agentKey: "research",
    modelRoute: "reasoning",
    reasoningEffort: "high",
    chatMode: "plan",
};
beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: () => "edit-backup" });
});
test("persists the removed prompt and full controls in its original scope without touching an unsent draft", () => {
    localStorage.setItem(
        "launchstack:composer:origin",
        JSON.stringify({ text: "My independent draft" })
    );
    localStorage.setItem(
        "launchstack:composer:origin:stashes",
        JSON.stringify([{ ...send, id: "earlier", savedAt: 1 }])
    );
    expect(backupChatEdit("origin", send)).toBe("edit-backup");
    const stashes = JSON.parse(
        localStorage.getItem("launchstack:composer:origin:stashes")!
    ) as unknown[];
    expect(stashes).toEqual([
        expect.objectContaining({ ...send, id: "edit-backup", failedSend: true }),
        expect.objectContaining({ id: "earlier" }),
    ]);
    expect(JSON.parse(localStorage.getItem("launchstack:composer:origin")!)).toEqual({
        text: "My independent draft",
    });
    expect(localStorage.getItem("launchstack:composer:new-chat:stashes")).toBeNull();
});
test("successful retry removes only its own backup and preserves newer saved prompts", () => {
    backupChatEdit("origin", send);
    const key = "launchstack:composer:origin:stashes";
    localStorage.setItem(
        key,
        JSON.stringify([
            { ...send, id: "newer", savedAt: 2 },
            ...JSON.parse(localStorage.getItem(key)!),
        ])
    );
    removeChatEditBackup("origin", "edit-backup");
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual([
        expect.objectContaining({ id: "newer" }),
    ]);
});
test("storage quota failure prevents a destructive edit from proceeding without recovery", () => {
    const write = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("Quota full", "QuotaExceededError");
    });
    expect(backupChatEdit("origin", send)).toBeUndefined();
    write.mockRestore();
});
