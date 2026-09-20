import {
    buildAnswerMenuItems,
    buildChatPaneMenuItems,
    buildCitationMenuItems,
    buildComposerMenuItems,
    buildQuestionMenuItems,
} from "../chatContextMenu";
import type { ThreadMessage, WorkspaceSource } from "../types";

const source: WorkspaceSource = {
    id: "d1",
    documentId: 1,
    title: "Vendor MSA",
    type: "doc",
    size: "",
    added: "",
    folder: "Legal",
    tags: [],
    domain: "General",
};

function pick(items: ReturnType<typeof buildAnswerMenuItems>, id: string) {
    const item = items.find(i => i.id === id);
    if (item?.type !== "item") throw new Error(`no item ${id}`);
    item.onSelect();
    return item;
}

describe("chat menu builders", () => {
    it("copies an answer plain or as Markdown, and quotes it plain", () => {
        const msg: ThreadMessage = { role: "assistant", text: "Cap is **12 months**." };
        const onCopy = jest.fn();
        const onQuote = jest.fn();
        const items = buildAnswerMenuItems(msg, { onCopy, onQuote });
        pick(items, "copy");
        expect(onCopy).toHaveBeenLastCalledWith("Cap is 12 months.");
        pick(items, "copy-markdown");
        expect(onCopy).toHaveBeenLastCalledWith("Cap is **12 months**.");
        pick(items, "quote");
        expect(onQuote).toHaveBeenCalledWith("Cap is 12 months.");
    });

    it("puts a question back in the composer to edit", () => {
        const onEdit = jest.fn();
        const items = buildQuestionMenuItems(
            { role: "user", text: "Cap?" },
            {
                onCopy: jest.fn(),
                onQuote: jest.fn(),
                onEdit,
            }
        );
        pick(items, "edit");
        expect(onEdit).toHaveBeenCalledWith("Cap?");
    });

    it("gives a citation its passage, with and without the source, and a context toggle", () => {
        const onCopy = jest.fn();
        const onToggleContext = jest.fn();
        const onOpen = jest.fn();
        const cite = { sourceId: "d1", snippet: "capped at twelve months", page: 4 };
        const items = buildCitationMenuItems(cite, source, {
            onOpen,
            onCopy,
            inContext: false,
            onToggleContext,
        });
        pick(items, "open");
        expect(onOpen).toHaveBeenCalledWith(cite);
        pick(items, "copy-passage");
        expect(onCopy).toHaveBeenLastCalledWith("capped at twelve months");
        pick(items, "copy-cited");
        expect(onCopy).toHaveBeenLastCalledWith("“capped at twelve months” — Vendor MSA");
        expect(pick(items, "context").label).toBe("Add source to context");
        expect(onToggleContext).toHaveBeenCalledWith(source);

        const pinned = buildCitationMenuItems(cite, source, {
            onCopy,
            inContext: true,
            onToggleContext,
        });
        expect(pinned.find(i => i.id === "context")).toMatchObject({
            label: "Leave out of the next answer",
        });
        expect(pinned.find(i => i.id === "open")).toBeUndefined();

        const empty = buildCitationMenuItems({ sourceId: "d1", snippet: "  " }, source, {
            onCopy,
            inContext: false,
            onToggleContext,
        });
        expect(empty.find(i => i.id === "copy-passage")).toMatchObject({ disabled: true });
    });

    it("reflects composer state: clipboard verbs need a selection, toggles show their state", () => {
        const handlers = {
            onCut: jest.fn(),
            onCopy: jest.fn(),
            onPaste: jest.fn(),
            onAttach: jest.fn(),
            onToggleWebSearch: jest.fn(),
            onToggleThinking: jest.fn(),
            onClear: jest.fn(),
        };
        const items = buildComposerMenuItems(
            {
                hasSelection: false,
                hasContent: true,
                uploading: false,
                disabled: false,
                webSearch: true,
                thinking: true,
                reasoningEnabled: false,
                reasoningDisabledReason: "No reasoning route",
            },
            handlers
        );
        expect(items.find(i => i.id === "cut")).toMatchObject({ disabled: true });
        expect(items.find(i => i.id === "web")).toMatchObject({ checked: true, icon: "check" });
        expect(items.find(i => i.id === "think")).toMatchObject({
            checked: false,
            disabled: true,
            disabledReason: "No reasoning route",
        });
        pick(items, "clear");
        expect(handlers.onClear).toHaveBeenCalled();
    });

    it("disables pane verbs that have nothing to act on", () => {
        const items = buildChatPaneMenuItems({
            isEmpty: true,
            hasContext: false,
            onNewChat: jest.fn(),
            onClearContext: jest.fn(),
            onExportMarkdown: jest.fn(),
            onOpenPalette: jest.fn(),
        });
        expect(items.find(i => i.id === "new-chat")).toMatchObject({ disabled: true });
        expect(items.find(i => i.id === "clear-context")).toMatchObject({ disabled: true });
        expect(items.find(i => i.id === "export-markdown")).toMatchObject({ disabled: true });
        expect(items.find(i => i.id === "palette")).not.toMatchObject({ disabled: true });
    });
});
