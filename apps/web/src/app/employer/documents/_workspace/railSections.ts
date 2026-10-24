/**
 * The Sources rail's three sections (ADR-014 §6), as in Notion's sidebar:
 *
 *   Workspace — everyone in the workspace can open it
 *   Shared    — specific people: what you shared out, and what was shared with you
 *   Private   — only you
 *
 * Each top-level folder sits in the section its own audience names, with its
 * whole subtree — a subfolder whose access differs stays inside its parent and
 * shows a badge instead of jumping sections. Loose files (Unfiled) are filed
 * one by one; the workspace-visible ones from before private-by-default stay
 * together under Workspace › Unfiled.
 *
 * Pure, so the sorting and the wording are pinned by tests.
 */

import type { useTranslations } from "next-intl";

import { UNFILED_FOLDER, type FolderTree, type FolderTreeNode } from "~/lib/folders/path";

import type { ItemAccessView, SourceAudience, WorkspaceSource } from "./types";

export type RailSectionId = SourceAudience;

export const RAIL_SECTION_ORDER: readonly RailSectionId[] = ["workspace", "shared", "private"];

/** `useTranslations("sources.audience")` — the words for who can see a row. */
export type AudienceTranslator = ReturnType<typeof useTranslations<"sources.audience">>;

type SourceNode = FolderTreeNode<WorkspaceSource>;

export interface RailSection {
    id: RailSectionId;
    /** Top-level folders, each with its whole subtree. */
    folders: SourceNode[];
    /** Loose files, at the section's top level. */
    items: WorkspaceSource[];
    /** Every source the section holds, nested ones included. */
    count: number;
}

/**
 * Where a source belongs. The server's answer when it gave one; otherwise a
 * staged upload is private (that is where a new file lands), a legacy
 * restricted row is shared, and anything else is the workspace's.
 */
export function sourceAudience(source: WorkspaceSource): SourceAudience {
    if (source.access) return source.access.audience;
    if (source.pending) return "private";
    if (source.restricted) return "shared";
    return "workspace";
}

/**
 * A top-level folder's section. A folder the server did not describe (one
 * only implied by a visible subfolder, inside a parent the caller cannot
 * open) goes where the first thing inside it that has an audience goes.
 */
function nodeAudience(
    node: SourceNode,
    folderAudience: (path: string) => SourceAudience | undefined
): SourceAudience | undefined {
    const own = folderAudience(node.path);
    if (own) return own;
    for (const child of node.children) {
        const found = nodeAudience(child, folderAudience);
        if (found) return found;
    }
    const item = node.items.find(i => i.access);
    return item ? sourceAudience(item) : undefined;
}

export function splitRailSections(
    tree: FolderTree<WorkspaceSource>,
    folderAudience: (path: string) => SourceAudience | undefined
): Record<RailSectionId, RailSection> {
    const sections: Record<RailSectionId, RailSection> = {
        workspace: { id: "workspace", folders: [], items: [], count: 0 },
        shared: { id: "shared", folders: [], items: [], count: 0 },
        private: { id: "private", folders: [], items: [], count: 0 },
    };

    // Items at the root only exist when the tree is scoped to a folder; the
    // rail does not split a scoped view, but stay total anyway.
    for (const item of tree.items) {
        const section = sections[sourceAudience(item)];
        section.items.push(item);
        section.count += 1;
    }

    for (const node of tree.children) {
        if (node.path === UNFILED_FOLDER) {
            const everyone: WorkspaceSource[] = [];
            for (const item of node.items) {
                const audience = sourceAudience(item);
                if (audience === "workspace") {
                    everyone.push(item);
                } else {
                    sections[audience].items.push(item);
                    sections[audience].count += 1;
                }
            }
            if (everyone.length > 0) {
                sections.workspace.folders.push({
                    ...node,
                    items: everyone,
                    children: [],
                    totalItems: everyone.length,
                });
                sections.workspace.count += everyone.length;
            }
            continue;
        }
        const section = sections[nodeAudience(node, folderAudience) ?? "workspace"];
        section.folders.push(node);
        section.count += node.totalItems;
    }

    // Unfiled stays last within Workspace, as it is in the tree.
    sections.workspace.folders.sort(
        (a, b) => Number(a.path === UNFILED_FOLDER) - Number(b.path === UNFILED_FOLDER)
    );
    return sections;
}

/**
 * The words for an audience glyph and its tooltip: "Only you",
 * "Shared with 3", "Everyone at Acme". Counts the people, groups and roles
 * the governing grants name, the caller included.
 */
export function audienceLabel(
    access: Pick<ItemAccessView, "audience" | "principalCount">,
    workspaceName: string | null | undefined,
    /** The reader's language; without it, English. */
    t?: AudienceTranslator
): string {
    if (t) {
        switch (access.audience) {
            case "private":
                return t("onlyYou");
            case "shared":
                return access.principalCount > 0
                    ? t("sharedWith", { count: access.principalCount })
                    : t("sharedWithSpecific");
            case "workspace":
                return workspaceName
                    ? t("everyoneAt", { workspace: workspaceName })
                    : t("everyoneInWorkspace");
        }
    }
    switch (access.audience) {
        case "private":
            return "Only you";
        case "shared":
            return access.principalCount > 0
                ? `Shared with ${access.principalCount}`
                : "Shared with specific people";
        case "workspace":
            return workspaceName ? `Everyone at ${workspaceName}` : "Everyone in the workspace";
    }
}

/**
 * Whether a row shows its audience glyph. Everything under Workspace shows
 * none ("nothing = everyone"). A top-level folder or a loose file in Shared or
 * Private shows its section's glyph; a nested row shows one only when its
 * access differs from its parent's — the badge that says "this one is not
 * like the folder around it".
 */
export function showsAudienceGlyph(
    access: Pick<ItemAccessView, "audience" | "ownAudience"> | undefined,
    topLevel: boolean
): boolean {
    if (!access || access.audience === "workspace") return false;
    return topLevel || access.ownAudience;
}

/** What a move did to a file's audience, in words for a toast; null when nothing changed. */
export function moveOutcomeMessage(
    outcome: "inherits_folder" | "made_private" | "kept_audience" | "unchanged" | null | undefined,
    folderLeaf: string,
    /** The reader's language; without it, English. */
    t?: AudienceTranslator
): string | null {
    if (t) {
        switch (outcome) {
            case "inherits_folder":
                return t("moveInherits", { folder: folderLeaf });
            case "made_private":
                return t("moveMadePrivate");
            case "kept_audience":
                return t("moveKeptAudience");
            default:
                return null;
        }
    }
    switch (outcome) {
        case "inherits_folder":
            return `Now visible to everyone who can open ${folderLeaf}`;
        case "made_private":
            return "Now private to you";
        case "kept_audience":
            return "Still visible only to the people who could see it before";
        default:
            return null;
    }
}
