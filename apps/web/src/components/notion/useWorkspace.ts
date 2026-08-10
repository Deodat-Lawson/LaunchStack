"use client";

/**
 * Workspace-level state: the page tree and the operations that reshape it.
 *
 * The tree is small enough to hold entirely in memory, so every mutation
 * updates it locally and then persists. That is what makes creating a page
 * feel instantaneous — the router navigates to a page the server has not
 * acknowledged yet, which is safe because the client generates the id.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
    PageIcon,
    WorkspacePageDto,
    WorkspacePageSummary,
} from "~/types/workspace";

export interface TreeNode extends WorkspacePageSummary {
    children: TreeNode[];
    depth: number;
}

export interface WorkspaceStore {
    pages: WorkspacePageSummary[];
    tree: TreeNode[];
    favorites: WorkspacePageSummary[];
    trash: WorkspacePageSummary[];
    loading: boolean;
    reload: () => Promise<void>;
    getPage: (id: string) => WorkspacePageSummary | undefined;
    createPage: (input?: {
        parentPageId?: string | null;
        title?: string;
        icon?: PageIcon | null;
    }) => Promise<WorkspacePageDto | null>;
    duplicatePage: (id: string) => Promise<WorkspacePageDto | null>;
    trashPage: (id: string) => Promise<void>;
    restorePage: (id: string) => Promise<void>;
    deleteForever: (id: string) => Promise<void>;
    movePage: (id: string, parentPageId: string | null, index: number) => Promise<void>;
    toggleFavorite: (id: string) => Promise<void>;
    /** Locally reflect a title/icon edit so the sidebar keeps up with typing. */
    patchLocal: (id: string, patch: Partial<WorkspacePageSummary>) => void;
}

/** Assemble the flat list into a tree, respecting sibling order. */
function buildTree(pages: WorkspacePageSummary[]): TreeNode[] {
    const nodes = new Map<string, TreeNode>();
    for (const page of pages) {
        nodes.set(page.id, { ...page, children: [], depth: 0 });
    }

    const roots: TreeNode[] = [];
    for (const node of nodes.values()) {
        // Database rows are shown by their database, not as tree children.
        if (node.parentType === "database") continue;
        const parent = node.parentPageId ? nodes.get(node.parentPageId) : undefined;
        if (parent) parent.children.push(node);
        else roots.push(node);
    }

    const sortByPosition = (list: TreeNode[], depth: number) => {
        list.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
        for (const node of list) {
            node.depth = depth;
            sortByPosition(node.children, depth + 1);
        }
    };
    sortByPosition(roots, 0);

    return roots;
}

export function useWorkspace(): WorkspaceStore {
    const [pages, setPages] = useState<WorkspacePageSummary[]>([]);
    const [loading, setLoading] = useState(true);

    const reload = useCallback(async () => {
        try {
            const response = await fetch("/api/workspace/pages?includeTrash=true");
            if (!response.ok) return;
            const data = (await response.json()) as { pages: WorkspacePageSummary[] };
            setPages(data.pages);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    const getPage = useCallback(
        (id: string) => pages.find((page) => page.id === id),
        [pages]
    );

    const patchLocal = useCallback(
        (id: string, patch: Partial<WorkspacePageSummary>) => {
            setPages((current) =>
                current.map((page) => (page.id === id ? { ...page, ...patch } : page))
            );
        },
        []
    );

    const createPage = useCallback<WorkspaceStore["createPage"]>(
        async (input = {}) => {
            const id = crypto.randomUUID();
            const optimistic: WorkspacePageSummary = {
                id,
                parentPageId: input.parentPageId ?? null,
                parentType: input.parentPageId ? "page" : "workspace",
                databaseId: null,
                title: input.title ?? "",
                icon: input.icon ?? null,
                isFavorite: false,
                isTemplate: false,
                inTrash: false,
                trashedAt: null,
                position: Number.MAX_SAFE_INTEGER,
                hasChildren: false,
                updatedAt: new Date().toISOString(),
            };
            setPages((current) => [...current, optimistic]);

            const response = await fetch("/api/workspace/pages", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, ...input }),
            });
            if (!response.ok) {
                setPages((current) => current.filter((page) => page.id !== id));
                return null;
            }
            const data = (await response.json()) as { page: WorkspacePageDto };
            patchLocal(id, { position: data.page.position });
            return data.page;
        },
        [patchLocal]
    );

    const duplicatePage = useCallback<WorkspaceStore["duplicatePage"]>(
        async (id) => {
            const response = await fetch(`/api/workspace/pages/${id}/duplicate`, {
                method: "POST",
            });
            if (!response.ok) return null;
            const data = (await response.json()) as { page: WorkspacePageDto };
            await reload();
            return data.page;
        },
        [reload]
    );

    const trashPage = useCallback<WorkspaceStore["trashPage"]>(
        async (id) => {
            const response = await fetch(`/api/workspace/pages/${id}`, { method: "DELETE" });
            if (!response.ok) return;
            const data = (await response.json()) as { deleted: string[] };
            const trashed = new Set(data.deleted);
            setPages((current) =>
                current.map((page) =>
                    trashed.has(page.id)
                        ? {
                              ...page,
                              inTrash: true,
                              isFavorite: false,
                              trashedAt: new Date().toISOString(),
                          }
                        : page
                )
            );
        },
        []
    );

    const restorePage = useCallback<WorkspaceStore["restorePage"]>(
        async (id) => {
            const response = await fetch(`/api/workspace/pages/${id}/restore`, {
                method: "POST",
            });
            if (response.ok) await reload();
        },
        [reload]
    );

    const deleteForever = useCallback<WorkspaceStore["deleteForever"]>(
        async (id) => {
            const response = await fetch(`/api/workspace/pages/${id}?permanent=true`, {
                method: "DELETE",
            });
            if (!response.ok) return;
            const data = (await response.json()) as { deleted: string[] };
            const gone = new Set(data.deleted);
            setPages((current) => current.filter((page) => !gone.has(page.id)));
        },
        []
    );

    const movePage = useCallback<WorkspaceStore["movePage"]>(
        async (id, parentPageId, index) => {
            const response = await fetch(`/api/workspace/pages/${id}/move`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ parentPageId, index }),
            });
            if (response.ok) await reload();
        },
        [reload]
    );

    const toggleFavorite = useCallback<WorkspaceStore["toggleFavorite"]>(
        async (id) => {
            const page = pages.find((candidate) => candidate.id === id);
            if (!page) return;
            const next = !page.isFavorite;
            patchLocal(id, { isFavorite: next });
            const response = await fetch(`/api/workspace/pages/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ isFavorite: next }),
            });
            if (!response.ok) patchLocal(id, { isFavorite: !next });
        },
        [pages, patchLocal]
    );

    const live = useMemo(() => pages.filter((page) => !page.inTrash), [pages]);
    const tree = useMemo(() => buildTree(live), [live]);
    const favorites = useMemo(() => live.filter((page) => page.isFavorite), [live]);
    const trash = useMemo(
        () =>
            pages
                .filter((page) => page.inTrash)
                .sort((a, b) => (b.trashedAt ?? "").localeCompare(a.trashedAt ?? "")),
        [pages]
    );

    return {
        pages: live,
        tree,
        favorites,
        trash,
        loading,
        reload,
        getPage,
        createPage,
        duplicatePage,
        trashPage,
        restorePage,
        deleteForever,
        movePage,
        toggleFavorite,
        patchLocal,
    };
}
