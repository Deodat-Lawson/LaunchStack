import type { ActionMenuItem } from "~/components/ui/action-menu";
import type { WorkspaceSource, WorkspaceTranslator } from "./types";

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
    /**
     * The caller may rename or delete it (ADR-014 edit). False for a file
     * shared with them to view; absent means the server did not say.
     */
    editable?: boolean;
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
    handlers: DocumentMenuHandlers,
    t: WorkspaceTranslator
): ActionMenuItem[] {
    const indexingReason = t("common.indexingReason");
    const viewOnly = state.editable === false;
    /** Rename and delete: the row must exist and be one the caller may change. */
    const changeReason = !state.persisted
        ? indexingReason
        : viewOnly
          ? t("common.viewOnly")
          : undefined;
    const items: ActionMenuItem[] = [{ type: "label", id: "title", label: source.title }];
    items.push({
        type: "item",
        id: "ask",
        // Named for what it is: a text selection's own "Ask about this" can
        // sit in the same menu, right above this one.
        label: state.isMindmap ? t("documentMenu.askMindmap") : t("documentMenu.askDocument"),
        icon: "ask",
        disabled: !state.askable,
        disabledReason: state.askable ? undefined : t("documentMenu.makeCitableFirst"),
        onSelect: handlers.onAskAbout,
    });
    items.push({
        type: "item",
        id: "rename",
        label: t("documentMenu.rename"),
        icon: "rename",
        disabled: changeReason !== undefined,
        disabledReason: changeReason,
        onSelect: handlers.onRename,
    });
    if (handlers.onOpenInNewTab && !state.isMindmap) {
        items.push({
            type: "item",
            id: "open-tab",
            label: t("common.openInANewTab"),
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
            label: t("documentMenu.downloadOriginal"),
            icon: "download",
            disabled: !state.originalUrl,
            disabledReason: state.originalUrl ? undefined : t("documentMenu.originalLoading"),
            onSelect: () => handlers.onDownload?.(),
        });
    }
    items.push({
        type: "item",
        id: "copy-link",
        label: t("documentMenu.copyLink"),
        icon: "link",
        onSelect: handlers.onCopyLink,
    });
    items.push({ type: "separator", id: "sep-panels" });
    if (handlers.onShowVersions) {
        items.push({
            type: "item",
            id: "versions",
            label: state.isMindmap
                ? t("documentMenu.revisionHistory")
                : t("documentMenu.versionHistory"),
            icon: "history",
            onSelect: () => handlers.onShowVersions?.(),
        });
    }
    if (handlers.onShowNotes) {
        items.push({
            type: "item",
            id: "notes",
            label: t("documentMenu.notes"),
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
            label: t("documentMenu.share"),
            icon: "share",
            disabled: !state.persisted,
            disabledReason: state.persisted ? undefined : indexingReason,
            onSelect: () => handlers.onRestrictAccess?.(),
        });
    }
    items.push({ type: "separator", id: "sep-danger" });
    items.push({
        type: "item",
        id: "delete",
        label: state.isMindmap ? t("documentMenu.moveToTrash") : t("documentMenu.delete"),
        icon: "delete",
        danger: true,
        disabled: changeReason !== undefined,
        disabledReason: changeReason,
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
    handlers: VersionMenuHandlers,
    t: WorkspaceTranslator
): ActionMenuItem[] {
    const label = version.isCurrent
        ? t("documentViewer.versionCurrent", { number: version.versionNumber })
        : t("documentViewer.versionLabel", { number: version.versionNumber });
    return [
        { type: "label", id: "title", label },
        {
            type: "item",
            id: "preview",
            label: t("documentMenu.previewVersion"),
            icon: "open",
            disabled: version.isCurrent,
            disabledReason: version.isCurrent ? t("documentMenu.isCurrent") : undefined,
            onSelect: handlers.onPreview,
        },
        {
            type: "item",
            id: "download",
            label: t("documentMenu.downloadVersion"),
            icon: "download",
            onSelect: handlers.onDownload,
        },
        { type: "separator", id: "sep-restore" },
        {
            type: "item",
            id: "restore",
            label: t("documentMenu.restoreVersion"),
            icon: "restore",
            disabled: version.isCurrent || state.reverting,
            disabledReason: version.isCurrent
                ? t("documentMenu.isCurrent")
                : state.reverting
                  ? t("documentMenu.restoreRunning")
                  : undefined,
            onSelect: handlers.onRestore,
        },
    ];
}
