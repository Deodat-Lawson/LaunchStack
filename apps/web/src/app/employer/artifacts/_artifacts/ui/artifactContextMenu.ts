import type { ActionMenuItem } from "~/components/ui/action-menu";
import type { ArtifactSummary } from "../lib/api";

/**
 * Declarative items for an artifact — a gallery card or the open viewer.
 * The trash gets its own, shorter menu: what is in the bin can only come
 * back or go for good.
 */
export interface ArtifactMenuHandlers {
    /** Absent in the viewer, where the artifact is already open. */
    onOpen?: () => void;
    onOpenInNewTab: () => void;
    onToggleStar: () => void;
    onDownload: () => void;
    onCopyLink: () => void;
    onCopySource?: () => void;
    onOpenOriginal?: () => void;
    /** Every folder the workspace has, for the move submenu. */
    folders: string[];
    onMoveToFolder: (folder: string) => void;
    onTrash: () => void;
}

export function buildArtifactMenuItems(
    artifact: ArtifactSummary,
    handlers: ArtifactMenuHandlers
): ActionMenuItem[] {
    const items: ActionMenuItem[] = [{ type: "label", id: "title", label: artifact.title }];
    if (handlers.onOpen) {
        items.push({
            type: "item",
            id: "open",
            label: "Open",
            icon: "open",
            onSelect: () => handlers.onOpen?.(),
        });
    }
    items.push({
        type: "item",
        id: "open-tab",
        label: "Open in a new tab",
        icon: "external",
        onSelect: handlers.onOpenInNewTab,
    });
    items.push({
        type: "item",
        id: "star",
        label: artifact.starred ? "Unstar" : "Star",
        icon: "star",
        checked: artifact.starred,
        onSelect: handlers.onToggleStar,
    });
    items.push({ type: "separator", id: "sep-share" });
    items.push({
        type: "item",
        id: "download",
        label: "Download",
        icon: "download",
        onSelect: handlers.onDownload,
    });
    items.push({
        type: "item",
        id: "copy-link",
        label: "Copy link",
        icon: "link",
        onSelect: handlers.onCopyLink,
    });
    if (handlers.onCopySource) {
        items.push({
            type: "item",
            id: "copy-source",
            label: "Copy source",
            icon: "code",
            onSelect: () => handlers.onCopySource?.(),
        });
    }
    if (artifact.sourceUrl && handlers.onOpenOriginal) {
        items.push({
            type: "item",
            id: "open-original",
            label: "Open the original on claude.ai",
            icon: "globe",
            onSelect: () => handlers.onOpenOriginal?.(),
        });
    }
    const folders = [...new Set([...handlers.folders, artifact.folder])].sort((a, b) =>
        a.localeCompare(b)
    );
    items.push({
        type: "submenu",
        id: "move",
        label: "Move to folder",
        icon: "folder",
        items: folders.map(name => ({
            type: "item" as const,
            id: `move-${name}`,
            label: name,
            icon: name === artifact.folder ? "check" : undefined,
            checked: name === artifact.folder,
            disabled: name === artifact.folder,
            onSelect: () => handlers.onMoveToFolder(name),
        })),
    });
    items.push({ type: "separator", id: "sep-danger" });
    items.push({
        type: "item",
        id: "trash",
        label: "Move to trash",
        icon: "delete",
        danger: true,
        onSelect: handlers.onTrash,
    });
    return items;
}

export interface TrashedArtifactMenuHandlers {
    onRestore: () => void;
    onPurge: () => void;
}

export function buildTrashedArtifactMenuItems(
    artifact: ArtifactSummary,
    handlers: TrashedArtifactMenuHandlers
): ActionMenuItem[] {
    return [
        { type: "label", id: "title", label: artifact.title },
        {
            type: "item",
            id: "restore",
            label: "Restore",
            icon: "restore",
            onSelect: handlers.onRestore,
        },
        { type: "separator", id: "sep-danger" },
        {
            type: "item",
            id: "purge",
            label: "Delete permanently…",
            icon: "delete",
            danger: true,
            onSelect: handlers.onPurge,
        },
    ];
}
