/**
 * Wire types for the internal page workspace.
 *
 * The editor is a client component and the tables live behind Drizzle, so this
 * is the one shape both sides agree on. Timestamps are ISO strings (JSON has
 * no Date) and every id is a string.
 */

import type {
    DatabaseProperty,
    DatabaseView,
    PageCover,
    PageIcon,
} from "~/server/db/schema/workspace";

export type {
    DatabaseFilter,
    DatabaseProperty,
    DatabasePropertyType,
    DatabaseSort,
    DatabaseView,
    DatabaseViewType,
    FilterOperator,
    PageCover,
    PageIcon,
    SelectOption,
} from "~/server/db/schema/workspace";

/** A page as returned by the API. `content` is a ProseMirror JSON document. */
export interface WorkspacePageDto {
    id: string;
    parentPageId: string | null;
    parentType: "workspace" | "page" | "database";
    databaseId: string | null;
    title: string;
    icon: PageIcon | null;
    cover: PageCover | null;
    content: unknown;
    properties: Record<string, unknown> | null;
    font: "default" | "serif" | "mono";
    smallText: boolean;
    fullWidth: boolean;
    locked: boolean;
    isFavorite: boolean;
    isTemplate: boolean;
    inTrash: boolean;
    trashedAt: string | null;
    position: number;
    publicSlug: string | null;
    createdAt: string;
    updatedAt: string;
    lastEditedBy: string | null;
}

/**
 * A node in the sidebar tree. Deliberately without `content`: the sidebar
 * loads the whole tree at once and page bodies would make that payload
 * enormous.
 */
export interface WorkspacePageSummary {
    id: string;
    parentPageId: string | null;
    parentType: "workspace" | "page" | "database";
    databaseId: string | null;
    title: string;
    icon: PageIcon | null;
    isFavorite: boolean;
    isTemplate: boolean;
    inTrash: boolean;
    trashedAt: string | null;
    position: number;
    hasChildren: boolean;
    updatedAt: string;
}

export interface WorkspaceDatabaseDto {
    id: string;
    pageId: string;
    title: string;
    description: string | null;
    icon: PageIcon | null;
    properties: DatabaseProperty[];
    views: DatabaseView[];
    isInline: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface WorkspaceCommentDto {
    id: number;
    pageId: string;
    blockId: string | null;
    anchorText: string | null;
    parentCommentId: number | null;
    authorName: string | null;
    authorAvatar: string | null;
    body: string;
    resolved: boolean;
    createdAt: string;
    updatedAt: string | null;
    /** Populated for thread roots. */
    replies?: WorkspaceCommentDto[];
}

export interface WorkspaceVersionDto {
    id: number;
    pageId: string;
    title: string | null;
    icon: PageIcon | null;
    label: string | null;
    createdAt: string;
    /** Only present when a single version is fetched. */
    content?: unknown;
}

export interface WorkspaceSearchHit {
    id: string;
    title: string;
    icon: PageIcon | null;
    breadcrumb: string[];
    snippet: string;
    updatedAt: string;
}

export interface WorkspaceBacklink {
    id: string;
    title: string;
    icon: PageIcon | null;
}
