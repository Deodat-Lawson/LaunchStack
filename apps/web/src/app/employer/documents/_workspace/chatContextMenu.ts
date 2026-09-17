import type { ActionMenuItem } from "~/components/ui/action-menu";
import { citationOfReference, plainTextOfAnswer } from "./transcript";
import type { EphemeralAttachment, ThreadMessage, ThreadReference, WorkspaceSource } from "./types";

/**
 * Declarative items for the chat's right-click targets: an answer, a
 * question, a citation, a context chip, an attachment, the composer and the
 * pane itself. The shell layers session-level verbs (ask again, branch, save)
 * on top through the action registry; these are the verbs the panel can do
 * by itself.
 */

export interface AnswerMenuHandlers {
    onCopy: (text: string) => void;
    onQuote: (text: string) => void;
}

export function buildAnswerMenuItems(
    msg: ThreadMessage,
    handlers: AnswerMenuHandlers
): ActionMenuItem[] {
    return [
        {
            type: "item",
            id: "copy",
            label: "Copy answer",
            icon: "copy",
            onSelect: () => handlers.onCopy(plainTextOfAnswer(msg.text)),
        },
        {
            type: "item",
            id: "copy-markdown",
            label: "Copy as Markdown",
            icon: "code",
            onSelect: () => handlers.onCopy(msg.text),
        },
        {
            type: "item",
            id: "quote",
            label: "Quote in reply",
            icon: "quote",
            onSelect: () => handlers.onQuote(plainTextOfAnswer(msg.text)),
        },
    ];
}

export interface QuestionMenuHandlers {
    onCopy: (text: string) => void;
    onQuote: (text: string) => void;
    /** Put the question back in the composer to change and resend. */
    onEdit: (text: string) => void;
}

export function buildQuestionMenuItems(
    msg: ThreadMessage,
    handlers: QuestionMenuHandlers
): ActionMenuItem[] {
    return [
        {
            type: "item",
            id: "edit",
            label: "Edit and ask again",
            icon: "rename",
            onSelect: () => handlers.onEdit(msg.text),
        },
        {
            type: "item",
            id: "copy",
            label: "Copy",
            icon: "copy",
            onSelect: () => handlers.onCopy(msg.text),
        },
        {
            type: "item",
            id: "quote",
            label: "Quote in reply",
            icon: "quote",
            onSelect: () => handlers.onQuote(msg.text),
        },
    ];
}

export interface CitationMenuHandlers {
    onOpen?: (cite: ThreadReference) => void;
    onCopy: (text: string) => void;
    /** Whether the cited source is pinned as context right now. */
    inContext: boolean;
    onToggleContext: (source: WorkspaceSource) => void;
}

export function buildCitationMenuItems(
    cite: ThreadReference,
    source: WorkspaceSource,
    handlers: CitationMenuHandlers
): ActionMenuItem[] {
    const items: ActionMenuItem[] = [{ type: "label", id: "title", label: source.title }];
    if (handlers.onOpen) {
        items.push({
            type: "item",
            id: "open",
            label: "Open source at this passage",
            icon: "open",
            onSelect: () => handlers.onOpen?.(cite),
        });
    }
    items.push(
        {
            type: "item",
            id: "copy-passage",
            label: "Copy the passage",
            icon: "copy",
            disabled: !cite.snippet.trim(),
            disabledReason: cite.snippet.trim() ? undefined : "This citation carries no passage.",
            onSelect: () => handlers.onCopy(cite.snippet.trim()),
        },
        {
            type: "item",
            id: "copy-cited",
            label: "Copy passage with citation",
            icon: "quote",
            disabled: !cite.snippet.trim(),
            disabledReason: cite.snippet.trim() ? undefined : "This citation carries no passage.",
            onSelect: () => handlers.onCopy(citationOfReference(cite, source)),
        },
        { type: "separator", id: "sep-context" },
        {
            type: "item",
            id: "context",
            label: handlers.inContext ? "Leave out of the next answer" : "Add source to context",
            icon: handlers.inContext ? "hide" : "ask",
            onSelect: () => handlers.onToggleContext(source),
        }
    );
    return items;
}

export interface ContextChipMenuHandlers {
    onOpen?: () => void;
    onRemove?: () => void;
}

export function buildContextChipMenuItems(
    source: WorkspaceSource,
    handlers: ContextChipMenuHandlers
): ActionMenuItem[] {
    const items: ActionMenuItem[] = [{ type: "label", id: "title", label: source.title }];
    if (handlers.onOpen) {
        items.push({
            type: "item",
            id: "open",
            label: "Open",
            icon: "open",
            onSelect: () => handlers.onOpen?.(),
        });
    }
    if (handlers.onRemove) {
        items.push({
            type: "item",
            id: "remove",
            label: "Remove from context",
            icon: "hide",
            onSelect: () => handlers.onRemove?.(),
        });
    }
    return items;
}

export interface AttachmentMenuHandlers {
    onOpen: () => void;
    onRemove?: () => void;
}

export function buildAttachmentMenuItems(
    attachment: EphemeralAttachment,
    handlers: AttachmentMenuHandlers
): ActionMenuItem[] {
    const items: ActionMenuItem[] = [
        { type: "label", id: "title", label: attachment.name },
        {
            type: "item",
            id: "open",
            label: "Open in a new tab",
            icon: "external",
            onSelect: handlers.onOpen,
        },
    ];
    if (handlers.onRemove) {
        items.push({
            type: "item",
            id: "remove",
            label: "Remove attachment",
            icon: "delete",
            danger: true,
            onSelect: () => handlers.onRemove?.(),
        });
    }
    return items;
}

export interface ComposerMenuState {
    hasSelection: boolean;
    hasContent: boolean;
    uploading: boolean;
    disabled: boolean;
    webSearch: boolean;
    thinking: boolean;
    reasoningEnabled: boolean;
    reasoningDisabledReason?: string;
}

export interface ComposerMenuHandlers {
    onCut: () => void;
    onCopy: () => void;
    onPaste: () => void;
    onAttach: () => void;
    onToggleWebSearch: () => void;
    onToggleThinking: () => void;
    onClear: () => void;
}

export function buildComposerMenuItems(
    state: ComposerMenuState,
    handlers: ComposerMenuHandlers
): ActionMenuItem[] {
    return [
        {
            type: "item",
            id: "cut",
            label: "Cut",
            icon: "cut",
            shortcut: "⌘X",
            disabled: !state.hasSelection,
            onSelect: handlers.onCut,
        },
        {
            type: "item",
            id: "copy",
            label: "Copy",
            icon: "copy",
            shortcut: "⌘C",
            disabled: !state.hasSelection,
            onSelect: handlers.onCopy,
        },
        {
            type: "item",
            id: "paste",
            label: "Paste",
            icon: "paste",
            shortcut: "⌘V",
            onSelect: handlers.onPaste,
        },
        { type: "separator", id: "sep-tools" },
        {
            type: "item",
            id: "attach",
            label: "Attach files…",
            icon: "attach",
            disabled: state.uploading || state.disabled,
            onSelect: handlers.onAttach,
        },
        {
            type: "item",
            id: "web",
            label: "Search the web for this turn",
            icon: state.webSearch ? "check" : "globe",
            checked: state.webSearch,
            onSelect: handlers.onToggleWebSearch,
        },
        {
            type: "item",
            id: "think",
            label: "Extended thinking",
            icon: state.thinking && state.reasoningEnabled ? "check" : "brain",
            checked: state.thinking && state.reasoningEnabled,
            disabled: !state.reasoningEnabled,
            disabledReason: state.reasoningEnabled
                ? undefined
                : (state.reasoningDisabledReason ??
                  'Assign a reasoning-capable model to the "reasoning" route to enable this'),
            onSelect: handlers.onToggleThinking,
        },
        { type: "separator", id: "sep-clear" },
        {
            type: "item",
            id: "clear",
            label: "Clear",
            icon: "eraser",
            disabled: !state.hasContent,
            onSelect: handlers.onClear,
        },
    ];
}

export interface ChatPaneMenuHandlers {
    isEmpty: boolean;
    hasContext: boolean;
    onNewChat: () => void;
    onClearContext: () => void;
    onExportMarkdown: () => void;
    onOpenPalette: () => void;
}

export function buildChatPaneMenuItems(handlers: ChatPaneMenuHandlers): ActionMenuItem[] {
    return [
        {
            type: "item",
            id: "new-chat",
            label: "New chat",
            icon: "newChat",
            disabled: handlers.isEmpty,
            disabledReason: handlers.isEmpty ? "This is already a new chat." : undefined,
            onSelect: handlers.onNewChat,
        },
        {
            type: "item",
            id: "clear-context",
            label: "Clear context",
            icon: "eraser",
            disabled: !handlers.hasContext,
            disabledReason: handlers.hasContext ? undefined : "No sources are pinned.",
            onSelect: handlers.onClearContext,
        },
        {
            type: "item",
            id: "export-markdown",
            label: "Export transcript as Markdown",
            icon: "export",
            disabled: handlers.isEmpty,
            disabledReason: handlers.isEmpty ? "Nothing to export yet." : undefined,
            onSelect: handlers.onExportMarkdown,
        },
        { type: "separator", id: "sep-palette" },
        {
            type: "item",
            id: "palette",
            label: "Command palette",
            icon: "command",
            shortcut: "⌘K",
            onSelect: handlers.onOpenPalette,
        },
    ];
}
