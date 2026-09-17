import type { ActionMenuItem } from "~/components/ui/action-menu";
import type { WorkspaceSource } from "./types";

/**
 * Declarative items for the document viewer's right-click targets: the
 * document itself and one row of its version history.
 */

/** What the viewer declares on its root target, for actions registered elsewhere. */
export interface DocumentTargetData {
    source: WorkspaceSource;
    /** Starts a new note with this text as its body — absent when notes are unavailable. */
    addNote?: (text: string) => void;
}

export interface DocumentMenuState {
    isMindmap: boolean;
    /** A mindmap that is not yet citable cannot be asked about. */
    askable: boolean;
    persisted: boolean;
    /** The original file's URL, when it is loaded. */
    originalUrl: string | null;
}

export interface DocumentMenuHandlers {
    onAskAbout: () => void;
    onRename: () => void;
    onOpenInNewTab?: () => void;
    onDownload?: () => void;
    onCopyLink: () => void;
    onShowVersions?: () => void;
    onShowNotes?: () => void;
    onRestrictAccess?: () => void;
    onDelete: () => void;
}

export function buildDocumentMenuItems(
    source: WorkspaceSource,
    state: DocumentMenuState,
    handlers: DocumentMenuHandlers
): ActionMenuItem[] {
    const indexingReason = "This source is still being indexed.";
    const items: ActionMenuItem[] = [{ type: "label", id: "title", label: source.title }];
    items.push({
        type: "item",
        id: "ask",
        label: "Ask about this",
        icon: "ask",
        disabled: !state.askable,
        disabledReason: state.askable ? undefined : "Make this map citable first.",
        onSelect: handlers.onAskAbout,
    });
    items.push({
        type: "item",
        id: "rename",
        label: "Rename…",
        icon: "rename",
        disabled: !state.persisted,
        disabledReason: state.persisted ? undefined : indexingReason,
        onSelect: handlers.onRename,
    });
    if (handlers.onOpenInNewTab && !state.isMindmap) {
        items.push({
            type: "item",
            id: "open-tab",
            label: "Open in a new tab",
            icon: "external",
            disabled: !state.persisted,
            disabledReason: state.persisted ? undefined : indexingReason,
            onSelect: () => handlers.onOpenInNewTab?.(),
        });
    }
    if (handlers.onDownload && !state.isMindmap) {
        items.push({
            type: "item",
            id: "download",
            label: "Download original",
            icon: "download",
            disabled: !state.originalUrl,
            disabledReason: state.originalUrl ? undefined : "The original is still loading.",
            onSelect: () => handlers.onDownload?.(),
        });
    }
    items.push({
        type: "item",
        id: "copy-link",
        label: "Copy link",
        icon: "link",
        onSelect: handlers.onCopyLink,
    });
    items.push({ type: "separator", id: "sep-panels" });
    if (handlers.onShowVersions) {
        items.push({
            type: "item",
            id: "versions",
            label: state.isMindmap ? "Revision history" : "Version history",
            icon: "history",
            onSelect: () => handlers.onShowVersions?.(),
        });
    }
    if (handlers.onShowNotes) {
        items.push({
            type: "item",
            id: "notes",
            label: "Notes",
            icon: "note",
            disabled: !state.persisted,
            disabledReason: state.persisted ? undefined : indexingReason,
            onSelect: () => handlers.onShowNotes?.(),
        });
    }
    if (handlers.onRestrictAccess) {
        items.push({
            type: "item",
            id: "access",
            label: source.restricted ? "Change access…" : "Restrict access…",
            icon: "lock",
            disabled: !state.persisted,
            disabledReason: state.persisted ? undefined : indexingReason,
            onSelect: () => handlers.onRestrictAccess?.(),
        });
    }
    items.push({ type: "separator", id: "sep-danger" });
    items.push({
        type: "item",
        id: "delete",
        label: state.isMindmap ? "Move to trash…" : "Delete…",
        icon: "delete",
        danger: true,
        disabled: !state.persisted,
        disabledReason: state.persisted ? undefined : indexingReason,
        onSelect: handlers.onDelete,
    });
    return items;
}

export interface VersionMenuHandlers {
    onPreview: () => void;
    onRestore: () => void;
    onDownload: () => void;
}

export function buildVersionMenuItems(
    version: { versionNumber: number; isCurrent: boolean },
    state: { reverting: boolean },
    handlers: VersionMenuHandlers
): ActionMenuItem[] {
    const label = `v${version.versionNumber}${version.isCurrent ? " (current)" : ""}`;
    return [
        { type: "label", id: "title", label },
        {
            type: "item",
            id: "preview",
            label: "Preview this version",
            icon: "open",
            disabled: version.isCurrent,
            disabledReason: version.isCurrent ? "This is the current version." : undefined,
            onSelect: handlers.onPreview,
        },
        {
            type: "item",
            id: "download",
            label: "Download this version",
            icon: "download",
            onSelect: handlers.onDownload,
        },
        { type: "separator", id: "sep-restore" },
        {
            type: "item",
            id: "restore",
            label: "Restore this version…",
            icon: "restore",
            disabled: version.isCurrent || state.reverting,
            disabledReason: version.isCurrent
                ? "This is the current version."
                : state.reverting
                  ? "A restore is already running."
                  : undefined,
            onSelect: handlers.onRestore,
        },
    ];
}
