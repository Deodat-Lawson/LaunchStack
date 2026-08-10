"use client";

/**
 * The left sidebar: search, favourites, the page tree, trash, and the new-page
 * button.
 *
 * The tree supports drag-to-reorder and drag-to-nest. Which of the two a drop
 * means is decided by where in the row you release — top/bottom thirds
 * reorder, the middle nests — which is how Notion disambiguates it too.
 */

import {
    ChevronRight,
    Clock,
    FileText,
    MoreHorizontal,
    Plus,
    PanelLeftClose,
    Search,
    Settings,
    Star,
    Trash2,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { MenuDivider, MenuItem, Popover } from "../ui/Popover";
import type { TreeNode, WorkspaceStore } from "../useWorkspace";
import type { WorkspacePageSummary } from "~/types/workspace";

type DropZone = "before" | "inside" | "after";

export interface SidebarProps {
    store: WorkspaceStore;
    activePageId: string | null;
    collapsed: boolean;
    onToggleCollapsed: () => void;
    onNavigate: (pageId: string) => void;
    onOpenSearch: () => void;
    onOpenTrash: () => void;
    onCreatePage: (parentPageId: string | null) => void;
}

export function Sidebar({
    store,
    activePageId,
    collapsed,
    onToggleCollapsed,
    onNavigate,
    onOpenSearch,
    onOpenTrash,
    onCreatePage,
}: SidebarProps) {
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [drag, setDrag] = useState<{ id: string; over: string | null; zone: DropZone } | null>(
        null
    );

    const toggle = useCallback((id: string) => {
        setExpanded((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const recents = useMemo(
        () =>
            [...store.pages]
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                .slice(0, 5),
        [store.pages]
    );

    const onDrop = useCallback(
        async (target: TreeNode) => {
            if (!drag || drag.id === target.id) {
                setDrag(null);
                return;
            }
            if (drag.zone === "inside") {
                await store.movePage(drag.id, target.id, 0);
                setExpanded((current) => new Set(current).add(target.id));
            } else {
                const siblings = target.parentPageId
                    ? (store.tree
                          .flatMap(function flatten(node: TreeNode): TreeNode[] {
                              return [node, ...node.children.flatMap(flatten)];
                          })
                          .find((node) => node.id === target.parentPageId)?.children ?? [])
                    : store.tree;
                const index = siblings.findIndex((node) => node.id === target.id);
                await store.movePage(
                    drag.id,
                    target.parentPageId,
                    drag.zone === "before" ? index : index + 1
                );
            }
            setDrag(null);
        },
        [drag, store]
    );

    if (collapsed) {
        return (
            <aside className="ntn-sidebar ntn-sidebar--collapsed">
                <button
                    type="button"
                    className="ntn-sidebar__expand"
                    title="Open sidebar"
                    onClick={onToggleCollapsed}
                >
                    <PanelLeftClose size={16} style={{ transform: "rotate(180deg)" }} />
                </button>
            </aside>
        );
    }

    return (
        <aside className="ntn-sidebar">
            <div className="ntn-sidebar__top">
                <span className="ntn-sidebar__workspace">
                    <span className="ntn-sidebar__badge">W</span>
                    <span>Workspace</span>
                </span>
                <button
                    type="button"
                    className="ntn-sidebar__icon"
                    title="Close sidebar"
                    onClick={onToggleCollapsed}
                >
                    <PanelLeftClose size={15} />
                </button>
            </div>

            <div className="ntn-sidebar__quick">
                <button type="button" className="ntn-sidebar__row" onClick={onOpenSearch}>
                    <Search size={15} /> <span>Search</span>
                    <kbd>⌘K</kbd>
                </button>
                <button
                    type="button"
                    className="ntn-sidebar__row"
                    onClick={() => recents[0] && onNavigate(recents[0].id)}
                >
                    <Clock size={15} /> <span>Recent</span>
                </button>
                <button type="button" className="ntn-sidebar__row" disabled>
                    <Settings size={15} /> <span>Settings</span>
                </button>
            </div>

            <div className="ntn-sidebar__scroll">
                {store.favorites.length > 0 && (
                    <Section label="Favourites">
                        {store.favorites.map((page) => (
                            <FlatRow
                                key={page.id}
                                page={page}
                                active={page.id === activePageId}
                                onNavigate={onNavigate}
                            />
                        ))}
                    </Section>
                )}

                <Section
                    label="Private"
                    action={
                        <button
                            type="button"
                            title="New page"
                            onClick={() => onCreatePage(null)}
                        >
                            <Plus size={13} />
                        </button>
                    }
                >
                    {store.loading && store.tree.length === 0 && (
                        <div className="ntn-sidebar__empty">Loading…</div>
                    )}
                    {!store.loading && store.tree.length === 0 && (
                        <div className="ntn-sidebar__empty">No pages yet.</div>
                    )}
                    {store.tree.map((node) => (
                        <TreeRow
                            key={node.id}
                            node={node}
                            activePageId={activePageId}
                            expanded={expanded}
                            onToggle={toggle}
                            onNavigate={onNavigate}
                            onCreateChild={(id) => {
                                setExpanded((current) => new Set(current).add(id));
                                onCreatePage(id);
                            }}
                            store={store}
                            drag={drag}
                            setDrag={setDrag}
                            onDrop={onDrop}
                        />
                    ))}
                </Section>
            </div>

            <div className="ntn-sidebar__bottom">
                <button type="button" className="ntn-sidebar__row" onClick={onOpenTrash}>
                    <Trash2 size={15} /> <span>Trash</span>
                    {store.trash.length > 0 && (
                        <span className="ntn-sidebar__count">{store.trash.length}</span>
                    )}
                </button>
                <button
                    type="button"
                    className="ntn-sidebar__row ntn-sidebar__row--accent"
                    onClick={() => onCreatePage(null)}
                >
                    <Plus size={15} /> <span>New page</span>
                </button>
            </div>
        </aside>
    );
}

function Section({
    label,
    action,
    children,
}: {
    label: string;
    action?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <div className="ntn-sidebar__section">
            <div className="ntn-sidebar__label">
                <span>{label}</span>
                {action}
            </div>
            {children}
        </div>
    );
}

function FlatRow({
    page,
    active,
    onNavigate,
}: {
    page: WorkspacePageSummary;
    active: boolean;
    onNavigate: (id: string) => void;
}) {
    return (
        <button
            type="button"
            className={`ntn-sidebar__page${active ? " is-active" : ""}`}
            onClick={() => onNavigate(page.id)}
        >
            <span className="ntn-sidebar__pageicon">
                {page.icon?.type === "emoji" ? page.icon.value : <FileText size={14} />}
            </span>
            <span className="ntn-sidebar__pagetitle">{page.title || "Untitled"}</span>
        </button>
    );
}

interface TreeRowProps {
    node: TreeNode;
    activePageId: string | null;
    expanded: Set<string>;
    onToggle: (id: string) => void;
    onNavigate: (id: string) => void;
    onCreateChild: (id: string) => void;
    store: WorkspaceStore;
    drag: { id: string; over: string | null; zone: DropZone } | null;
    setDrag: (value: { id: string; over: string | null; zone: DropZone } | null) => void;
    onDrop: (target: TreeNode) => void;
}

function TreeRow({
    node,
    activePageId,
    expanded,
    onToggle,
    onNavigate,
    onCreateChild,
    store,
    drag,
    setDrag,
    onDrop,
}: TreeRowProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLButtonElement>(null);
    const isOpen = expanded.has(node.id);
    const isOver = drag?.over === node.id;

    return (
        <>
            <div
                className={`ntn-sidebar__page${node.id === activePageId ? " is-active" : ""}${
                    isOver ? ` is-drop-${drag.zone}` : ""
                }`}
                style={{ paddingLeft: 8 + node.depth * 14 }}
                draggable
                onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    setDrag({ id: node.id, over: null, zone: "inside" });
                }}
                onDragOver={(event) => {
                    event.preventDefault();
                    if (!drag) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const offset = (event.clientY - rect.top) / rect.height;
                    const zone: DropZone =
                        offset < 0.28 ? "before" : offset > 0.72 ? "after" : "inside";
                    if (drag.over !== node.id || drag.zone !== zone) {
                        setDrag({ ...drag, over: node.id, zone });
                    }
                }}
                onDragLeave={() => {
                    if (drag?.over === node.id) setDrag({ ...drag, over: null });
                }}
                onDrop={(event) => {
                    event.preventDefault();
                    onDrop(node);
                }}
                onDragEnd={() => setDrag(null)}
            >
                <button
                    type="button"
                    className={`ntn-sidebar__chev${isOpen ? " is-open" : ""}`}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggle(node.id);
                    }}
                    style={{ visibility: node.children.length > 0 ? "visible" : "hidden" }}
                >
                    <ChevronRight size={12} />
                </button>

                <button
                    type="button"
                    className="ntn-sidebar__pagemain"
                    onClick={() => onNavigate(node.id)}
                >
                    <span className="ntn-sidebar__pageicon">
                        {node.icon?.type === "emoji" ? node.icon.value : <FileText size={14} />}
                    </span>
                    <span className="ntn-sidebar__pagetitle">{node.title || "Untitled"}</span>
                </button>

                <button
                    ref={menuRef}
                    type="button"
                    className="ntn-sidebar__pageaction"
                    title="More"
                    onClick={(event) => {
                        event.stopPropagation();
                        setMenuOpen((open) => !open);
                    }}
                >
                    <MoreHorizontal size={13} />
                </button>
                <button
                    type="button"
                    className="ntn-sidebar__pageaction"
                    title="Add a page inside"
                    onClick={(event) => {
                        event.stopPropagation();
                        onCreateChild(node.id);
                    }}
                >
                    <Plus size={13} />
                </button>
            </div>

            <Popover
                anchor={menuRef.current}
                open={menuOpen}
                onClose={() => setMenuOpen(false)}
                ignore={[menuRef.current]}
            >
                <div className="ntn-menu">
                    <MenuItem
                        icon={<Star size={15} />}
                        label={node.isFavorite ? "Remove from favourites" : "Add to favourites"}
                        onClick={() => {
                            void store.toggleFavorite(node.id);
                            setMenuOpen(false);
                        }}
                    />
                    <MenuItem
                        icon={<FileText size={15} />}
                        label="Duplicate"
                        onClick={() => {
                            void store.duplicatePage(node.id);
                            setMenuOpen(false);
                        }}
                    />
                    <MenuDivider />
                    <MenuItem
                        icon={<Trash2 size={15} />}
                        label="Move to trash"
                        danger
                        onClick={() => {
                            void store.trashPage(node.id);
                            setMenuOpen(false);
                        }}
                    />
                </div>
            </Popover>

            {isOpen &&
                node.children.map((child) => (
                    <TreeRow
                        key={child.id}
                        node={child}
                        activePageId={activePageId}
                        expanded={expanded}
                        onToggle={onToggle}
                        onNavigate={onNavigate}
                        onCreateChild={onCreateChild}
                        store={store}
                        drag={drag}
                        setDrag={setDrag}
                        onDrop={onDrop}
                    />
                ))}
        </>
    );
}
