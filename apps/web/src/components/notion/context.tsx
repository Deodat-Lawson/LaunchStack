"use client";

/**
 * Everything a node view needs from the app around it.
 *
 * Tiptap node views are rendered outside the React tree that owns the page, so
 * they cannot receive props. This context is the seam: uploads, page lookups,
 * navigation, and comments all arrive through it, which also means a node view
 * never talks to `fetch` directly and stays testable.
 */

import {
    createContext,
    useContext,
    type ReactNode,
} from "react";

import type {
    PageIcon,
    WorkspacePageDto,
    WorkspacePageSummary,
} from "~/types/workspace";

export interface UploadedFile {
    url: string;
    name: string;
    size: number;
    contentType: string;
}

export interface BookmarkMeta {
    url: string;
    title: string;
    description: string;
    image: string | null;
    favicon: string | null;
    siteName: string;
}

export interface NotionEditorContextValue {
    /** The page currently open in the editor. */
    pageId: string;
    /** Every page in the workspace, for mentions, links, and the move dialog. */
    pages: WorkspacePageSummary[];
    getPageSummary: (id: string) => WorkspacePageSummary | undefined;
    navigateToPage: (id: string) => void;
    /** Create a page nested under the open one. */
    createChildPage: (input?: {
        title?: string;
        icon?: PageIcon | null;
    }) => Promise<WorkspacePageDto | null>;
    uploadFile: (file: File) => Promise<UploadedFile | null>;
    fetchBookmark: (url: string) => Promise<BookmarkMeta | null>;
    /** Block ids that already have an unresolved thread, for the gutter marker. */
    commentedBlockIds: Set<string>;
    /** Root → current chain, rendered by the breadcrumb block. */
    breadcrumb: Array<{ id: string; title: string; icon: PageIcon | null }>;
    readOnly: boolean;
}

const NotionEditorContext = createContext<NotionEditorContextValue | null>(null);

export function NotionEditorProvider({
    value,
    children,
}: {
    value: NotionEditorContextValue;
    children: ReactNode;
}) {
    return (
        <NotionEditorContext.Provider value={value}>
            {children}
        </NotionEditorContext.Provider>
    );
}

/**
 * Node views render inside a portal that React re-parents; during the first
 * paint of a freshly-mounted view the provider may not be above it yet, so
 * this returns a no-op shape rather than throwing and blanking the page.
 */
export function useNotionEditor(): NotionEditorContextValue {
    return useContext(NotionEditorContext) ?? FALLBACK;
}

const FALLBACK: NotionEditorContextValue = {
    pageId: "",
    pages: [],
    getPageSummary: () => undefined,
    navigateToPage: () => undefined,
    createChildPage: async () => null,
    uploadFile: async () => null,
    fetchBookmark: async () => null,
    commentedBlockIds: new Set(),
    breadcrumb: [],
    readOnly: true,
};
