"use client";

/**
 * The workspace root: sidebar plus the open page.
 *
 * Owns navigation, the page-level fetch, and the context every node view
 * reads. Everything below it is either presentational or scoped to one page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Plus } from "lucide-react";

import { NotionEditorProvider, type NotionEditorContextValue } from "./context";
import { PageShell } from "./page/PageShell";
import { QuickFind } from "./sidebar/QuickFind";
import { Sidebar } from "./sidebar/Sidebar";
import { TrashDialog } from "./sidebar/TrashDialog";
import { useWorkspace } from "./useWorkspace";
import type {
    PageIcon,
    WorkspaceBacklink,
    WorkspacePageDto,
} from "~/types/workspace";

const SIDEBAR_KEY = "ntn:sidebar-collapsed";

export interface NotionWorkspaceProps {
    /** Page to open on mount; null shows the empty state. */
    initialPageId: string | null;
    /** Server-rendered first page, so the editor paints without a round-trip. */
    initialPage?: WorkspacePageDto | null;
    initialBreadcrumb?: Array<{ id: string; title: string; icon: PageIcon | null }>;
    initialBacklinks?: WorkspaceBacklink[];
    /** Route prefix pages live under, e.g. `/employer/workspace`. */
    basePath: string;
}

interface LoadedPage {
    page: WorkspacePageDto;
    breadcrumb: Array<{ id: string; title: string; icon: PageIcon | null }>;
    backlinks: WorkspaceBacklink[];
}

export function NotionWorkspace({
    initialPageId,
    initialPage = null,
    initialBreadcrumb = [],
    initialBacklinks = [],
    basePath,
}: NotionWorkspaceProps) {
    const router = useRouter();
    const store = useWorkspace();

    const [activeId, setActiveId] = useState<string | null>(initialPageId);
    const [loaded, setLoaded] = useState<LoadedPage | null>(
        initialPage
            ? {
                  page: initialPage,
                  breadcrumb: initialBreadcrumb,
                  backlinks: initialBacklinks,
              }
            : null
    );
    const [loadingPage, setLoadingPage] = useState(false);
    const [collapsed, setCollapsed] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [trashOpen, setTrashOpen] = useState(false);
    const [commentedBlockIds, setCommentedBlockIds] = useState<Set<string>>(new Set());
    const requestId = useRef(0);

    useEffect(() => {
        setCollapsed(window.localStorage.getItem(SIDEBAR_KEY) === "true");
    }, []);

    const toggleCollapsed = useCallback(() => {
        setCollapsed((current) => {
            const next = !current;
            window.localStorage.setItem(SIDEBAR_KEY, String(next));
            return next;
        });
    }, []);

    /** Fetch a page body. Stale responses are dropped by sequence number. */
    const loadPage = useCallback(async (pageId: string) => {
        const seq = ++requestId.current;
        setLoadingPage(true);
        try {
            const response = await fetch(`/api/workspace/pages/${pageId}`);
            if (!response.ok || seq !== requestId.current) return;
            const data = (await response.json()) as LoadedPage;
            if (seq !== requestId.current) return;
            setLoaded(data);

            const comments = await fetch(`/api/workspace/pages/${pageId}/comments`);
            if (comments.ok && seq === requestId.current) {
                const payload = (await comments.json()) as {
                    comments: Array<{ blockId: string | null; resolved: boolean }>;
                };
                setCommentedBlockIds(
                    new Set(
                        payload.comments
                            .filter((comment) => !comment.resolved && comment.blockId)
                            .map((comment) => comment.blockId!)
                    )
                );
            }
        } finally {
            if (seq === requestId.current) setLoadingPage(false);
        }
    }, []);

    useEffect(() => {
        if (!activeId) {
            setLoaded(null);
            return;
        }
        // The server already handed us the first page; do not refetch it.
        if (loaded?.page.id === activeId) return;
        void loadPage(activeId);
        // `loaded` is intentionally excluded: including it would refetch on
        // every local page edit.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeId, loadPage]);

    const navigate = useCallback(
        (pageId: string) => {
            setActiveId(pageId);
            // Keep the URL shareable without a full navigation, which would
            // discard the editor and the sidebar's expansion state.
            window.history.pushState(null, "", `${basePath}/${pageId}`);
        },
        [basePath]
    );

    // Back/forward must move between pages, not out of the workspace.
    useEffect(() => {
        const onPopState = () => {
            const id = window.location.pathname.split("/").filter(Boolean).pop();
            setActiveId(id && id !== basePath.split("/").pop() ? id : null);
        };
        window.addEventListener("popstate", onPopState);
        return () => window.removeEventListener("popstate", onPopState);
    }, [basePath]);

    const createPage = useCallback(
        async (parentPageId: string | null) => {
            const page = await store.createPage({ parentPageId });
            if (page) {
                setLoaded({ page, breadcrumb: [], backlinks: [] });
                navigate(page.id);
                void loadPage(page.id);
            }
        },
        [store, navigate, loadPage]
    );

    // ⌘K anywhere in the workspace.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                // Inside the editor with a selection, ⌘K means "link".
                const selection = window.getSelection();
                const inEditor = (event.target as HTMLElement | null)?.closest?.(".ntn-prose");
                if (inEditor && selection && !selection.isCollapsed) return;
                event.preventDefault();
                setSearchOpen(true);
            }
            if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
                event.preventDefault();
                toggleCollapsed();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [toggleCollapsed]);

    const editorContext = useMemo<NotionEditorContextValue>(
        () => ({
            pageId: activeId ?? "",
            pages: store.pages,
            getPageSummary: store.getPage,
            navigateToPage: navigate,
            createChildPage: async (input) => {
                if (!activeId) return null;
                const page = await store.createPage({
                    parentPageId: activeId,
                    title: input?.title,
                    icon: input?.icon ?? null,
                });
                return page;
            },
            uploadFile: async (file) => {
                const form = new FormData();
                form.append("file", file);
                const response = await fetch("/api/workspace/upload", {
                    method: "POST",
                    body: form,
                });
                if (!response.ok) return null;
                return (await response.json()) as {
                    url: string;
                    name: string;
                    size: number;
                    contentType: string;
                };
            },
            fetchBookmark: async (url) => {
                const response = await fetch(
                    `/api/workspace/bookmark?url=${encodeURIComponent(url)}`
                );
                if (!response.ok) return null;
                return (await response.json()) as {
                    url: string;
                    title: string;
                    description: string;
                    image: string | null;
                    favicon: string | null;
                    siteName: string;
                };
            },
            commentedBlockIds,
            breadcrumb: loaded?.breadcrumb ?? [],
            readOnly: Boolean(loaded?.page.locked),
        }),
        [activeId, store, navigate, commentedBlockIds, loaded]
    );

    return (
        <NotionEditorProvider value={editorContext}>
            <div className="ntn-root lsw-root">
                <Sidebar
                    store={store}
                    activePageId={activeId}
                    collapsed={collapsed}
                    onToggleCollapsed={toggleCollapsed}
                    onNavigate={navigate}
                    onOpenSearch={() => setSearchOpen(true)}
                    onOpenTrash={() => setTrashOpen(true)}
                    onCreatePage={(parentPageId) => void createPage(parentPageId)}
                />

                <main className="ntn-main">
                    {loaded ? (
                        <PageShell
                            key={loaded.page.id}
                            page={loaded.page}
                            breadcrumb={loaded.breadcrumb}
                            backlinks={loaded.backlinks}
                            onNavigate={navigate}
                            onLocalChange={(patch) => store.patchLocal(loaded.page.id, patch)}
                            onDuplicate={() => {
                                void store.duplicatePage(loaded.page.id).then((page) => {
                                    if (page) navigate(page.id);
                                });
                            }}
                            onTrash={() => {
                                void store.trashPage(loaded.page.id).then(() => {
                                    setActiveId(null);
                                    setLoaded(null);
                                    router.replace(basePath);
                                });
                            }}
                            onMove={(parentPageId) => {
                                void store.movePage(loaded.page.id, parentPageId, 0);
                            }}
                        />
                    ) : loadingPage ? (
                        <div className="ntn-blank">
                            <Loader2 size={18} className="ntn-spin" />
                        </div>
                    ) : (
                        <div className="ntn-blank">
                            <FileText size={26} />
                            <h2>No page open</h2>
                            <p>Pick a page from the sidebar, or start a new one.</p>
                            <button
                                type="button"
                                className="ntn-btn ntn-btn--primary"
                                onClick={() => void createPage(null)}
                            >
                                <Plus size={14} /> New page
                            </button>
                        </div>
                    )}
                </main>

                <QuickFind
                    open={searchOpen}
                    onClose={() => setSearchOpen(false)}
                    onNavigate={navigate}
                />
                <TrashDialog
                    store={store}
                    open={trashOpen}
                    onClose={() => setTrashOpen(false)}
                    onNavigate={navigate}
                />
            </div>
        </NotionEditorProvider>
    );
}
