import type { useTranslations } from "next-intl";
import type { ActionMenuItem } from "~/components/ui/action-menu";
import { citationOfReference, passagesMarkdown, plainTextOfAnswer } from "./transcript";
import type { EphemeralAttachment, ThreadMessage, ThreadReference, WorkspaceSource } from "./types";

/**
 * Declarative items for the chat's right-click targets: an answer, a
 * question, a citation, a context chip, an attachment, the composer and the
 * pane itself. The shell layers session-level verbs (ask again, branch, save)
 * on top through the action registry; these are the verbs the panel can do
 * by itself.
 *
 * Each builder takes the `chat.contextMenu` translator last, so the labels
 * read in the interface language.
 */

/** `useTranslations("chat.contextMenu")`. */
export type ChatMenuTranslator = ReturnType<typeof useTranslations<"chat.contextMenu">>;

export interface AnswerMenuHandlers {
    onCopy: (text: string) => void;
    onQuote: (text: string) => void;
}

export function buildAnswerMenuItems(
    msg: ThreadMessage,
    handlers: AnswerMenuHandlers,
    t: ChatMenuTranslator
): ActionMenuItem[] {
    return [
        {
            type: "item",
            id: "copy",
            label: t("copyAnswer"),
            icon: "copy",
            onSelect: () => handlers.onCopy(plainTextOfAnswer(msg.text)),
        },
        {
            type: "item",
            id: "copy-markdown",
            label: t("copyMarkdown"),
            icon: "code",
            onSelect: () => handlers.onCopy(msg.text),
        },
        {
            type: "item",
            id: "quote",
            label: t("quote"),
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
    handlers: QuestionMenuHandlers,
    t: ChatMenuTranslator
): ActionMenuItem[] {
    return [
        {
            type: "item",
            id: "edit",
            label: t("editAndAsk"),
            icon: "rename",
            onSelect: () => handlers.onEdit(msg.text),
        },
        {
            type: "item",
            id: "copy",
            label: t("copy"),
            icon: "copy",
            onSelect: () => handlers.onCopy(`${passagesMarkdown(msg)}${msg.text}`),
        },
        {
            type: "item",
            id: "quote",
            label: t("quote"),
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
    handlers: CitationMenuHandlers,
    t: ChatMenuTranslator
): ActionMenuItem[] {
    const items: ActionMenuItem[] = [{ type: "label", id: "title", label: source.title }];
    if (handlers.onOpen) {
        items.push({
            type: "item",
            id: "open",
            label: t("openAtPassage"),
            icon: "open",
            onSelect: () => handlers.onOpen?.(cite),
        });
    }
    items.push(
        {
            type: "item",
            id: "copy-passage",
            label: t("copyPassage"),
            icon: "copy",
            disabled: !cite.snippet.trim(),
            disabledReason: cite.snippet.trim() ? undefined : t("noPassage"),
            onSelect: () => handlers.onCopy(cite.snippet.trim()),
        },
        {
            type: "item",
            id: "copy-cited",
            label: t("copyWithCitation"),
            icon: "quote",
            disabled: !cite.snippet.trim(),
            disabledReason: cite.snippet.trim() ? undefined : t("noPassage"),
            onSelect: () => handlers.onCopy(citationOfReference(cite, source)),
        },
        { type: "separator", id: "sep-context" },
        {
            type: "item",
            id: "context",
            label: handlers.inContext ? t("leaveOut") : t("addToContext"),
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
    handlers: ContextChipMenuHandlers,
    t: ChatMenuTranslator
): ActionMenuItem[] {
    const items: ActionMenuItem[] = [{ type: "label", id: "title", label: source.title }];
    if (handlers.onOpen) {
        items.push({
            type: "item",
            id: "open",
            label: t("open"),
            icon: "open",
            onSelect: () => handlers.onOpen?.(),
        });
    }
    if (handlers.onRemove) {
        items.push({
            type: "item",
            id: "remove",
            label: t("removeFromContext"),
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
    handlers: AttachmentMenuHandlers,
    t: ChatMenuTranslator
): ActionMenuItem[] {
    const items: ActionMenuItem[] = [
        { type: "label", id: "title", label: attachment.name },
        {
            type: "item",
            id: "open",
            label: t("openInNewTab"),
            icon: "external",
            onSelect: handlers.onOpen,
        },
    ];
    if (handlers.onRemove) {
        items.push({
            type: "item",
            id: "remove",
            label: t("removeAttachment"),
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
}

export interface ComposerMenuHandlers {
    onCut: () => void;
    onCopy: () => void;
    onPaste: () => void;
    onAttach: () => void;
    onClear: () => void;
}

export function buildComposerMenuItems(
    state: ComposerMenuState,
    handlers: ComposerMenuHandlers,
    t: ChatMenuTranslator
): ActionMenuItem[] {
    return [
        {
            type: "item",
            id: "cut",
            label: t("cut"),
            icon: "cut",
            shortcut: "⌘X",
            disabled: !state.hasSelection,
            onSelect: handlers.onCut,
        },
        {
            type: "item",
            id: "copy",
            label: t("copy"),
            icon: "copy",
            shortcut: "⌘C",
            disabled: !state.hasSelection,
            onSelect: handlers.onCopy,
        },
        {
            type: "item",
            id: "paste",
            label: t("paste"),
            icon: "paste",
            shortcut: "⌘V",
            onSelect: handlers.onPaste,
        },
        { type: "separator", id: "sep-tools" },
        {
            type: "item",
            id: "attach",
            label: t("attach"),
            icon: "attach",
            disabled: state.uploading || state.disabled,
            onSelect: handlers.onAttach,
        },
        { type: "separator", id: "sep-clear" },
        {
            type: "item",
            id: "clear",
            label: t("clear"),
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

export function buildChatPaneMenuItems(
    handlers: ChatPaneMenuHandlers,
    t: ChatMenuTranslator
): ActionMenuItem[] {
    return [
        {
            type: "item",
            id: "new-chat",
            label: t("newChat"),
            icon: "newChat",
            disabled: handlers.isEmpty,
            disabledReason: handlers.isEmpty ? t("alreadyNew") : undefined,
            onSelect: handlers.onNewChat,
        },
        {
            type: "item",
            id: "clear-context",
            label: t("clearContext"),
            icon: "eraser",
            disabled: !handlers.hasContext,
            disabledReason: handlers.hasContext ? undefined : t("noPinned"),
            onSelect: handlers.onClearContext,
        },
        {
            type: "item",
            id: "export-markdown",
            label: t("exportMarkdown"),
            icon: "export",
            disabled: handlers.isEmpty,
            disabledReason: handlers.isEmpty ? t("nothingToExport") : undefined,
            onSelect: handlers.onExportMarkdown,
        },
        { type: "separator", id: "sep-palette" },
        {
            type: "item",
            id: "palette",
            label: t("palette"),
            icon: "command",
            shortcut: "⌘K",
            onSelect: handlers.onOpenPalette,
        },
    ];
}
