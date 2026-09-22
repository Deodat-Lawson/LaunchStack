"use client";

import React, {
    Fragment,
    type CSSProperties,
    type Dispatch,
    type MouseEvent,
    type SetStateAction,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    IconCheck,
    IconChevronLeft,
    IconChevronRight,
    IconGrid,
    IconMore,
    IconPlus,
    IconSearch,
    IconShield,
    IconX,
} from "./icons";
import { Folder, FolderOpen, Lock } from "lucide-react";

import { LaunchstackMark } from "~/app/_components/LaunchstackLogo";
import { RailBackLink } from "~/app/employer/_chrome/RailBackLink";
import {
    UNFILED_FOLDER,
    buildFolderTree,
    displayFolderPath,
    folderLeafName,
    isFolderOrDescendant,
    joinFolderPath,
    type FolderTreeNode,
} from "~/lib/folders/path";
import type { ActionMenuItem } from "~/components/ui/action-menu";
import { useActionMenu, useContextTarget } from "~/components/context-menu";
import { HistoryRail, type HistoryRailProps } from "./HistoryRail";
import {
    buildBlankRailMenuItems,
    buildSelectionMenuItems,
    buildFolderMenuItems,
    buildSourceMenuItems,
} from "./sourceContextMenu";
import { SOURCE_META, type WorkspaceFolder, type WorkspaceSource } from "./types";

/** What is being dragged over the rail: a source into a folder, or a folder into a folder. */
type RailDrag = { kind: "source"; id: string } | { kind: "folder"; path: string };

async function copyText(value: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(value);
    } catch {
        // Private mode / missing permission — the action still closes the menu.
    }
}

interface TagChipProps {
    tag: string;
    onClick?: () => void;
    onRemove?: () => void;
    size?: "sm" | "md";
}

export function TagChip({ tag, onClick, onRemove, size = "sm" }: TagChipProps) {
    const small = size === "sm";
    return (
        <span
            onClick={onClick}
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 2,
                padding: small ? "0 5px" : "1px 7px",
                fontSize: small ? 10 : 11,
                fontWeight: 500,
                borderRadius: 3,
                color: "var(--ink-3)",
                cursor: onClick ? "pointer" : "default",
                whiteSpace: "nowrap",
            }}
            onMouseEnter={e => {
                if (onClick) e.currentTarget.style.color = "var(--accent-ink)";
            }}
            onMouseLeave={e => {
                if (onClick) e.currentTarget.style.color = "var(--ink-3)";
            }}
        >
            <span style={{ fontSize: small ? 10 : 11, fontWeight: 600, opacity: 0.6 }}>#</span>
            {tag}
            {onRemove && (
                <button
                    onClick={e => {
                        e.stopPropagation();
                        onRemove();
                    }}
                    style={{
                        marginLeft: 1,
                        color: "var(--ink-3)",
                        display: "flex",
                        alignItems: "center",
                    }}
                >
                    <IconX size={8} />
                </button>
            )}
        </span>
    );
}

type CheckState = "none" | "some" | "all";

interface CheckboxProps {
    state: CheckState;
    onClick?: (e: MouseEvent) => void;
    title?: string;
}

function Checkbox({ state, onClick, title }: CheckboxProps) {
    return (
        <button
            onClick={e => {
                e.stopPropagation();
                onClick?.(e);
            }}
            title={title}
            style={{
                width: 15,
                height: 15,
                borderRadius: 3,
                border: `1.5px solid ${state !== "none" ? "var(--accent)" : "var(--ink-4)"}`,
                background:
                    state === "all"
                        ? "var(--accent)"
                        : state === "some"
                          ? "var(--accent-soft)"
                          : "var(--panel)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transition: "all 100ms",
                cursor: "pointer",
            }}
            onMouseEnter={e => {
                if (state === "none") e.currentTarget.style.borderColor = "var(--accent)";
            }}
            onMouseLeave={e => {
                if (state === "none") e.currentTarget.style.borderColor = "var(--ink-4)";
            }}
        >
            {state === "all" && <IconCheck size={10} style={{ color: "white" }} />}
            {state === "some" && (
                <div style={{ width: 7, height: 1.5, background: "var(--accent)" }} />
            )}
        </button>
    );
}

interface SourceRowProps {
    source: WorkspaceSource;
    selected: boolean;
    toggleSelected: (id: string) => void;
    onOpen?: (source: WorkspaceSource) => void;
    /** The row's actions; absent when the rail is read-only. */
    menuItems?: (source: WorkspaceSource) => ActionMenuItem[];
}

function SourceRow({ source, selected, toggleSelected, onOpen, menuItems }: SourceRowProps) {
    const meta = SOURCE_META[source.type] ?? SOURCE_META.doc;
    const Icon = meta.Icon;
    const [hover, setHover] = useState(false);
    const [menuFocus, setMenuFocus] = useState(false);
    const menu = useActionMenu();
    const menuLabel = `Actions for ${source.title}`;
    const ctxTarget = useContextTarget(
        menuItems
            ? {
                  kind: "source",
                  id: source.id,
                  label: menuLabel,
                  data: source,
                  items: () => menuItems(source),
              }
            : null
    );
    const tags = source.tags ?? [];
    const visibleTags = tags.slice(0, 2);
    const extra = tags.length - visibleTags.length;
    const showActions = hover || menuFocus;

    return (
        <div
            data-testid={`source-row-${source.id}`}
            {...ctxTarget}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 10px",
                borderRadius: 6,
                background: selected
                    ? "var(--accent-soft)"
                    : hover
                      ? "var(--line-2)"
                      : "transparent",
                transition: "background 100ms",
            }}
        >
            <Checkbox
                state={selected ? "all" : "none"}
                onClick={() => toggleSelected(source.id)}
                title={selected ? "Remove from context" : "Add to context"}
            />
            <div
                onClick={() => onOpen?.(source)}
                title="Open"
                style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minWidth: 0,
                    cursor: "pointer",
                }}
            >
                <Icon size={14} style={{ color: meta.color, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                        style={{
                            fontSize: 13,
                            fontWeight: selected ? 600 : 400,
                            color: selected ? "var(--accent-ink)" : "var(--ink)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            lineHeight: 1.35,
                        }}
                    >
                        {source.restricted && (
                            <Lock
                                size={10}
                                aria-label="Restricted"
                                style={{
                                    display: "inline-block",
                                    verticalAlign: "-1px",
                                    marginRight: 4,
                                    color: "var(--ink-3)",
                                }}
                            />
                        )}
                        {source.title}
                    </div>
                    {(visibleTags.length > 0 ||
                        (source.syncing ?? false) ||
                        (source.gaps?.length ?? 0) > 0) && (
                        <div
                            style={{
                                fontSize: 11,
                                color: "var(--ink-3)",
                                marginTop: 1,
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                            }}
                        >
                            {source.syncing && (
                                <span
                                    style={{
                                        color: "var(--accent)",
                                        animation: "lsw-shimmer 1.6s ease-in-out infinite",
                                    }}
                                >
                                    syncing…
                                </span>
                            )}
                            {visibleTags.map((t, i) => (
                                <Fragment key={t}>
                                    {i > 0 && <span style={{ opacity: 0.4 }}>·</span>}
                                    <TagChip tag={t} />
                                </Fragment>
                            ))}
                            {extra > 0 && (
                                <span style={{ fontSize: 10, opacity: 0.6 }}>+{extra}</span>
                            )}
                            {(source.gaps?.length ?? 0) > 0 && (
                                <span
                                    title={source.gaps?.join(" · ")}
                                    style={{
                                        marginLeft: "auto",
                                        color: "oklch(0.55 0.16 45)",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 2,
                                        fontSize: 10,
                                        fontWeight: 600,
                                    }}
                                >
                                    <IconShield size={9} />
                                    {source.gaps?.length}
                                </span>
                            )}
                        </div>
                    )}
                </div>
            </div>
            {menuItems && (
                <button
                    type="button"
                    data-testid={`source-row-menu-${source.id}`}
                    aria-label={menuLabel}
                    aria-haspopup="menu"
                    title="Actions"
                    onClick={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        menu.open({
                            x: rect.right,
                            y: rect.bottom,
                            items: menuItems(source),
                            ariaLabel: menuLabel,
                            kind: "source",
                        });
                    }}
                    onFocus={() => setMenuFocus(true)}
                    onBlur={() => setMenuFocus(false)}
                    style={{
                        width: 18,
                        height: 18,
                        borderRadius: 4,
                        color: "var(--ink-3)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        opacity: showActions ? 1 : 0,
                    }}
                    onMouseEnter={e => {
                        e.currentTarget.style.color = "var(--ink)";
                        e.currentTarget.style.background = "var(--panel)";
                    }}
                    onMouseLeave={e => {
                        e.currentTarget.style.color = "var(--ink-3)";
                        e.currentTarget.style.background = "transparent";
                    }}
                >
                    <IconMore size={12} />
                </button>
            )}
        </div>
    );
}

type SourceNode = FolderTreeNode<WorkspaceSource>;

/** Every source id in a folder and the folders beneath it. */
function collectItemIds(node: SourceNode): string[] {
    return [...node.items.map(item => item.id), ...node.children.flatMap(collectItemIds)];
}

interface FolderHeaderProps {
    node: SourceNode;
    /** The folder, or an ancestor, is restricted to the people granted access. */
    restricted?: boolean;
    collapsed: boolean;
    onToggle: () => void;
    onSelectAll: (ids: string[], add: boolean) => void;
    /** The folder's actions; absent when folders are read-only. */
    menuItems?: () => ActionMenuItem[];
    selected: string[];
    dragOver: boolean;
    /** Folders can be picked up and dropped into other folders. */
    draggable: boolean;
    onDragStart?: () => void;
    onDragEnd?: () => void;
}

function FolderHeader({
    node,
    restricted,
    collapsed,
    onToggle,
    onSelectAll,
    menuItems,
    selected,
    dragOver,
    draggable,
    onDragStart,
    onDragEnd,
}: FolderHeaderProps) {
    const [hover, setHover] = useState(false);
    const [menuFocus, setMenuFocus] = useState(false);
    const menu = useActionMenu();
    const menuLabel = `Actions for folder ${displayFolderPath(node.path)}`;
    const ctxTarget = useContextTarget(
        menuItems
            ? { kind: "folder", id: node.path, label: menuLabel, data: node, items: menuItems }
            : null
    );
    const itemIds = collectItemIds(node);
    const selCount = itemIds.filter(id => selected.includes(id)).length;
    const state: CheckState =
        selCount === 0
            ? "none"
            : selCount === itemIds.length && itemIds.length > 0
              ? "all"
              : "some";
    const FolderIcon = collapsed ? Folder : FolderOpen;
    return (
        <div
            data-testid={`folder-row-${node.path}`}
            {...ctxTarget}
            draggable={draggable}
            onDragStart={e => {
                if (!draggable) return;
                e.stopPropagation();
                // jsdom fires drag events without a dataTransfer.
                if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
                onDragStart?.();
            }}
            onDragEnd={onDragEnd}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 10px",
                borderRadius: 5,
                marginTop: 2,
                background: dragOver
                    ? "var(--accent-soft)"
                    : hover
                      ? "var(--line-2)"
                      : "transparent",
                border: dragOver ? "1px dashed var(--accent)" : "1px solid transparent",
                cursor: draggable ? "grab" : undefined,
            }}
        >
            <Checkbox
                state={state}
                onClick={() => onSelectAll(itemIds, state !== "all")}
                title={state === "all" ? "Deselect folder" : "Select all in folder"}
            />
            <div
                onClick={onToggle}
                style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    cursor: "pointer",
                    minWidth: 0,
                }}
            >
                <IconChevronRight
                    size={10}
                    style={{
                        color: "var(--ink-3)",
                        opacity: 0.7,
                        transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
                        transition: "transform 100ms",
                        flexShrink: 0,
                    }}
                />
                <FolderIcon className="text-ink-3 size-3 shrink-0" aria-hidden />
                <span
                    style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--ink-2)",
                        letterSpacing: "0.02em",
                        flex: 1,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                    }}
                    title={displayFolderPath(node.path)}
                >
                    {node.name}
                </span>
                {restricted && (
                    <Lock
                        size={10}
                        aria-label="Restricted folder"
                        style={{ color: "var(--ink-3)", flexShrink: 0 }}
                    />
                )}
                {menuItems && (
                    <button
                        type="button"
                        data-testid={`folder-menu-${node.path}`}
                        aria-label={menuLabel}
                        aria-haspopup="menu"
                        title="Folder actions"
                        onClick={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            menu.open({
                                x: rect.right,
                                y: rect.bottom,
                                items: menuItems(),
                                ariaLabel: menuLabel,
                                kind: "folder",
                            });
                        }}
                        onFocus={() => setMenuFocus(true)}
                        onBlur={() => setMenuFocus(false)}
                        style={{
                            width: 18,
                            height: 18,
                            borderRadius: 4,
                            color: "var(--ink-3)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            opacity: hover || menuFocus ? 1 : 0,
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.color = "var(--ink)";
                            e.currentTarget.style.background = "var(--panel)";
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.color = "var(--ink-3)";
                            e.currentTarget.style.background = "transparent";
                        }}
                    >
                        <IconMore size={12} />
                    </button>
                )}
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
                    {node.totalItems}
                </span>
            </div>
        </div>
    );
}

export interface SourceRailProps {
    sources: WorkspaceSource[];
    folders: WorkspaceFolder[];
    selected: string[];
    setSelected: Dispatch<SetStateAction<string[]>>;
    onOpenAdd: () => void;
    /** Straight to the mindmap template picker — creating, not uploading. */
    onOpenSource?: (source: WorkspaceSource) => void;
    /** Open it in a column beside the chat instead of over the workspace. */
    onOpenSourceBeside?: (source: WorkspaceSource) => void;
    /** Create a folder; `parentPath` names the folder it goes inside, null or undefined for the top level. */
    onNewFolder?: (parentPath?: string | null) => void;
    onRenameFolder?: (folder: WorkspaceFolder) => void;
    /** "Share folder…" — who in the workspace can see this folder. */
    onShareFolder?: (folder: WorkspaceFolder) => void;
    /** Move a folder (and everything in it) under `targetParent`; null means the top level. */
    onMoveFolder?: (path: string, targetParent: string | null) => void;
    onDeleteFolder?: (folder: WorkspaceFolder) => void;
    onMoveToFolder?: (sourceId: string, folderName: string) => void;
    onRenameSource?: (source: WorkspaceSource) => void;
    /** "Restrict access…" — who can see this one document. */
    onRestrictAccess?: (source: WorkspaceSource) => void;
    onDeleteSource?: (source: WorkspaceSource) => void;
    /** Delete several at once — the multi-selection menu's Delete. */
    onDeleteSources?: (sources: WorkspaceSource[]) => void;
    /** Open the Add dialog with this folder pre-selected. */
    onAddToFolder?: (path: string) => void;
    activeFolder: string | null;
    setActiveFolder: Dispatch<SetStateAction<string | null>>;
    activeTag: string | null;
    setActiveTag: Dispatch<SetStateAction<string | null>>;
    /** Rendered at the rail header; omit in minimal mode. */
    logoLabel?: string;
    /** When provided, a collapse button appears in the header. */
    onClose?: () => void;
    /**
     * Opens the full Knowledge surface. The rail is a picker for scoping a
     * question; browsing and auditing the corpus happens there.
     */
    onOpenKnowledge?: () => void;
    /**
     * Everything the History tab needs. Omit it and the rail is sources-only,
     * with no tab strip — which is what the minimal embeddings want.
     */
    history?: Omit<HistoryRailProps, "query">;
}

/** Which half of the rail is showing. Persisted, so a habit survives a reload. */
type RailTab = "sources" | "history";

const RAIL_TAB_KEY = "workspace.railTab.v1";

/** Everything a branch of the tree needs from the rail, passed once per level. */
interface BranchContext {
    selected: string[];
    collapsed: Record<string, boolean>;
    toggleCollapsed: (path: string) => void;
    toggleSelected: (id: string) => void;
    selectMany: (ids: string[], add: boolean) => void;
    drag: RailDrag | null;
    setDrag: (drag: RailDrag | null) => void;
    dragOverFolder: string | null;
    setDragOverFolder: (path: string | null) => void;
    canDragFolders: boolean;
    dropOnFolder: (target: string) => void;
    onOpenSource?: (source: WorkspaceSource) => void;
    /** Open it in a column beside the chat instead of over the workspace. */
    onOpenSourceBeside?: (source: WorkspaceSource) => void;
    sourceMenuItems: (source: WorkspaceSource) => ActionMenuItem[];
    folderMenuItems: (node: SourceNode) => ActionMenuItem[];
    /** True when the folder, or an ancestor, is restricted to the people granted access. */
    isRestricted: (path: string) => boolean;
}

/** Every folder path in a subtree, the root included. */
function collectFolderPaths(node: SourceNode): string[] {
    return [node.path, ...node.children.flatMap(collectFolderPaths)];
}

function SourceRows({ items, ctx }: { items: WorkspaceSource[]; ctx: BranchContext }) {
    return (
        <>
            {items.map(s => (
                <div
                    key={s.id}
                    draggable
                    onDragStart={e => {
                        e.stopPropagation();
                        ctx.setDrag({ kind: "source", id: s.id });
                    }}
                    onDragEnd={() => {
                        ctx.setDrag(null);
                        ctx.setDragOverFolder(null);
                    }}
                >
                    <SourceRow
                        source={s}
                        selected={ctx.selected.includes(s.id)}
                        toggleSelected={ctx.toggleSelected}
                        onOpen={ctx.onOpenSource}
                        menuItems={ctx.sourceMenuItems}
                    />
                </div>
            ))}
        </>
    );
}

function FolderBranch({ node, ctx }: { node: SourceNode; ctx: BranchContext }) {
    const isCollapsed = !!ctx.collapsed[node.path];
    const isDragOver = ctx.dragOverFolder === node.path;
    // A folder cannot be dropped on itself, inside itself, or under Unfiled.
    const acceptsDrag =
        ctx.drag?.kind === "source" ||
        (ctx.drag?.kind === "folder" &&
            node.path !== UNFILED_FOLDER &&
            !isFolderOrDescendant(node.path, ctx.drag.path));
    const isUnfiled = node.path === UNFILED_FOLDER;
    return (
        <div
            style={{ position: "relative" }}
            onDragEnter={e => {
                if (!acceptsDrag) return;
                e.preventDefault();
                e.stopPropagation();
                ctx.setDragOverFolder(node.path);
            }}
            onDragOver={e => {
                if (!acceptsDrag) return;
                e.preventDefault();
                e.stopPropagation();
            }}
            onDragLeave={() => {
                if (ctx.dragOverFolder === node.path) ctx.setDragOverFolder(null);
            }}
            onDrop={e => {
                // A refused drop ends here; letting it bubble would read as a
                // drop on empty rail space, which means "move to the top level".
                e.stopPropagation();
                if (!acceptsDrag) return;
                e.preventDefault();
                ctx.dropOnFolder(node.path);
            }}
        >
            <FolderHeader
                node={node}
                restricted={ctx.isRestricted(node.path)}
                selected={ctx.selected}
                collapsed={isCollapsed}
                onToggle={() => ctx.toggleCollapsed(node.path)}
                onSelectAll={ctx.selectMany}
                menuItems={() => ctx.folderMenuItems(node)}
                dragOver={isDragOver}
                draggable={ctx.canDragFolders && !isUnfiled}
                onDragStart={() => ctx.setDrag({ kind: "folder", path: node.path })}
                onDragEnd={() => {
                    ctx.setDrag(null);
                    ctx.setDragOverFolder(null);
                }}
            />
            {!isCollapsed && (
                <div style={{ paddingLeft: 14 }}>
                    {node.children.map(child => (
                        <FolderBranch key={child.path} node={child} ctx={ctx} />
                    ))}
                    <SourceRows items={node.items} ctx={ctx} />
                </div>
            )}
        </div>
    );
}

export function SourceRail({
    sources,
    folders,
    selected,
    setSelected,
    onOpenAdd,
    onOpenSource,
    onOpenSourceBeside,
    onNewFolder,
    onRenameFolder,
    onShareFolder,
    onMoveFolder,
    onDeleteFolder,
    onMoveToFolder,
    onRenameSource,
    onRestrictAccess,
    onDeleteSource,
    onDeleteSources,
    onAddToFolder,
    activeFolder,
    setActiveFolder,
    activeTag,
    setActiveTag,
    logoLabel = "Launchstack",
    onClose,
    onOpenKnowledge,
    history,
}: SourceRailProps) {
    const [tab, setTab] = useState<RailTab>("sources");
    const tabReady = useRef(false);
    const [search, setSearch] = useState("");
    const [searchFocus, setSearchFocus] = useState(false);
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
    const [drag, setDrag] = useState<RailDrag | null>(null);
    /** Sources picked up with "Cut", waiting for "Paste" on a folder. */
    const [cut, setCut] = useState<string[]>([]);
    useEffect(() => {
        try {
            if (localStorage.getItem(RAIL_TAB_KEY) === "history") setTab("history");
        } catch {
            // Private mode / corrupt storage — Sources is the safe default.
        }
        tabReady.current = true;
    }, []);

    useEffect(() => {
        if (!tabReady.current) return;
        try {
            localStorage.setItem(RAIL_TAB_KEY, tab);
        } catch {
            // Quota / private mode — the tab just won't be remembered.
        }
    }, [tab]);

    // A rail without history props can never sit on a tab that isn't there.
    const activeTab: RailTab = history ? tab : "sources";

    const folderFor = useCallback(
        (path: string): WorkspaceFolder =>
            folders.find(f => f.name === path) ?? {
                id: `f-${path}`,
                name: path,
                color: "var(--ink-3)",
            },
        [folders]
    );

    /**
     * A source's menu. Inside a multi-selection every verb acts on the whole
     * selection; outside it, on the one row — the selection is left alone,
     * because here "selected" means "in the chat's context", and collapsing
     * it on a stray right-click would silently change the next answer.
     */
    const sourceMenuItems = useCallback(
        (source: WorkspaceSource): ActionMenuItem[] => {
            if (selected.length > 1 && selected.includes(source.id)) {
                const chosen = sources.filter(s => selected.includes(s.id));
                return buildSelectionMenuItems(chosen, folders, {
                    onRemoveFromContext: ids =>
                        setSelected(prev => prev.filter(id => !ids.includes(id))),
                    onMoveToFolder: onMoveToFolder
                        ? (ids, name) => ids.forEach(id => onMoveToFolder(id, name))
                        : undefined,
                    onDelete: onDeleteSources,
                });
            }
            return buildSourceMenuItems(source, folders, selected, {
                onOpen: onOpenSource,
                onOpenBeside: onOpenSourceBeside,
                onToggleContext: s => {
                    setSelected(prev =>
                        prev.includes(s.id) ? prev.filter(id => id !== s.id) : [...prev, s.id]
                    );
                },
                onOpenInNewTab: s => {
                    if (s.documentId) {
                        window.open(
                            `/employer/documents/viewer?docId=${s.documentId}`,
                            "_blank",
                            "noopener,noreferrer"
                        );
                    }
                },
                onShowInKnowledge: onOpenKnowledge ? () => onOpenKnowledge() : undefined,
                onRename: onRenameSource,
                onMoveToFolder,
                onCut: onMoveToFolder ? s => setCut([s.id]) : undefined,
                onCopyTitle: s => {
                    void copyText(s.title);
                },
                onCopyLink: s => {
                    void copyText(
                        `${window.location.origin}/employer/documents?source=${encodeURIComponent(s.id)}`
                    );
                },
                onRestrictAccess,
                onDelete: onDeleteSource,
            });
        },
        [
            sources,
            folders,
            selected,
            setSelected,
            onOpenSource,
            onOpenSourceBeside,
            onOpenKnowledge,
            onRenameSource,
            onMoveToFolder,
            onRestrictAccess,
            onDeleteSource,
            onDeleteSources,
        ]
    );

    /** Move whatever was cut into `target`, then empty the buffer. */
    const pasteCut = useCallback(
        (target: string) => {
            if (!onMoveToFolder) return;
            cut.forEach(id => onMoveToFolder(id, target));
            setCut([]);
        },
        [cut, onMoveToFolder]
    );

    const folderMenuItems = useCallback(
        (node: SourceNode): ActionMenuItem[] => {
            const path = node.path;
            const itemIds = collectItemIds(node);
            const isUnfiled = path === UNFILED_FOLDER;
            const selCount = itemIds.filter(id => selected.includes(id)).length;
            const selectState: "none" | "some" | "all" =
                selCount === 0
                    ? "none"
                    : selCount === itemIds.length && itemIds.length > 0
                      ? "all"
                      : "some";
            const subtree = collectFolderPaths(node);
            return buildFolderMenuItems(path, {
                onOpen:
                    activeFolder === path
                        ? undefined
                        : () => {
                              setActiveFolder(path);
                              setActiveTag(null);
                          },
                onAddSource: onAddToFolder ? () => onAddToFolder(path) : undefined,
                cutCount: cut.length,
                onPaste: onMoveToFolder ? () => pasteCut(path) : undefined,
                onCollapseAll:
                    subtree.length > 1 || node.items.length > 0
                        ? collapse =>
                              setCollapsed(prev => {
                                  const next = { ...prev };
                                  subtree.forEach(p => {
                                      next[p] = collapse;
                                  });
                                  return next;
                              })
                        : undefined,
                allCollapsed: subtree.every(p => collapsed[p]),
                onNewSubfolder: onNewFolder && !isUnfiled ? () => onNewFolder(path) : undefined,
                onRename:
                    onRenameFolder && !isUnfiled
                        ? () => onRenameFolder(folderFor(path))
                        : undefined,
                onMove:
                    onMoveFolder && !isUnfiled ? target => onMoveFolder(path, target) : undefined,
                onDelete:
                    onDeleteFolder && !isUnfiled
                        ? () => onDeleteFolder(folderFor(path))
                        : undefined,
                onShare:
                    onShareFolder && !isUnfiled ? () => onShareFolder(folderFor(path)) : undefined,
                onSelectAll: add => {
                    setSelected(prev => {
                        if (add) {
                            const set = new Set(prev);
                            itemIds.forEach(id => set.add(id));
                            return [...set];
                        }
                        return prev.filter(id => !itemIds.includes(id));
                    });
                },
                selectState,
                folders: folders.map(f => f.name),
            });
        },
        [
            selected,
            setSelected,
            activeFolder,
            setActiveFolder,
            setActiveTag,
            folders,
            folderFor,
            collapsed,
            cut.length,
            pasteCut,
            onAddToFolder,
            onMoveToFolder,
            onNewFolder,
            onRenameFolder,
            onMoveFolder,
            onDeleteFolder,
            onShareFolder,
        ]
    );

    /** Empty rail space: the verbs that make something new. */
    const railTarget = useContextTarget({
        kind: "rail",
        label: "Sidebar actions",
        items: () =>
            buildBlankRailMenuItems({
                onAddKnowledge: onOpenAdd,
                onNewFolder: onNewFolder ? () => onNewFolder(null) : undefined,
                cutCount: cut.length,
                onPaste: onMoveToFolder ? () => pasteCut(UNFILED_FOLDER) : undefined,
            }),
    });

    /** The tab strip: switch halves, or put the rail away. */
    const tabsTarget = useContextTarget(
        history
            ? {
                  kind: "rail-tabs",
                  label: "Sidebar tabs",
                  items: (): ActionMenuItem[] => [
                      {
                          type: "item",
                          id: "tab-sources",
                          label: "Sources",
                          icon: activeTab === "sources" ? "check" : "folder",
                          checked: activeTab === "sources",
                          onSelect: () => setTab("sources"),
                      },
                      {
                          type: "item",
                          id: "tab-history",
                          label: "History",
                          icon: activeTab === "history" ? "check" : "history",
                          checked: activeTab === "history",
                          onSelect: () => setTab("history"),
                      },
                      ...(onClose
                          ? [
                                { type: "separator" as const, id: "sep-hide" },
                                {
                                    type: "item" as const,
                                    id: "hide",
                                    label: "Hide sidebar",
                                    icon: "sidebar" as const,
                                    shortcut: "⌘\\",
                                    onSelect: onClose,
                                },
                            ]
                          : []),
                  ],
              }
            : null
    );

    const toggleCollapsed = (path: string) => setCollapsed(p => ({ ...p, [path]: !p[path] }));

    const filtered = useMemo(() => {
        const q = search.toLowerCase();
        return sources.filter(s => {
            if (activeFolder && !isFolderOrDescendant(s.folder || UNFILED_FOLDER, activeFolder)) {
                return false;
            }
            if (activeTag && !(s.tags ?? []).includes(activeTag)) return false;
            if (q) {
                const hay =
                    `${s.title} ${s.folder ?? ""} ${(s.tags ?? []).join(" ")} ${s.searchText ?? ""}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }, [sources, search, activeFolder, activeTag]);

    // Searching or filtering by tag shows only folders with a match; browsing
    // shows every folder, empty ones included, so a new folder is visible.
    const tree = useMemo(
        () =>
            buildFolderTree(
                folders.map(f => f.name),
                filtered,
                s => s.folder,
                { root: activeFolder, pruneEmpty: Boolean(search) || Boolean(activeTag) }
            ),
        [folders, filtered, activeFolder, search, activeTag]
    );

    const toggle = (id: string) => {
        setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
    };

    const selectMany = (ids: string[], add: boolean) => {
        setSelected(prev => {
            if (add) {
                const set = new Set(prev);
                ids.forEach(id => set.add(id));
                return [...set];
            }
            return prev.filter(id => !ids.includes(id));
        });
    };

    const dropOnFolder = (target: string) => {
        if (drag?.kind === "source") {
            onMoveToFolder?.(drag.id, target);
        } else if (
            drag?.kind === "folder" &&
            onMoveFolder &&
            target !== UNFILED_FOLDER &&
            !isFolderOrDescendant(target, drag.path)
        ) {
            onMoveFolder(drag.path, target);
        }
        setDrag(null);
        setDragOverFolder(null);
    };

    const branchCtx: BranchContext = {
        selected,
        collapsed,
        toggleCollapsed,
        isRestricted: path => folderFor(path).restricted === true,
        toggleSelected: toggle,
        selectMany,
        drag,
        setDrag,
        dragOverFolder,
        setDragOverFolder,
        canDragFolders: Boolean(onMoveFolder),
        dropOnFolder,
        onOpenSource,
        sourceMenuItems,
        folderMenuItems,
    };

    const asideStyle: CSSProperties = {
        width: 280,
        flexShrink: 0,
        height: "100%",
        borderRight: "1px solid var(--line)",
        background: "var(--panel)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
    };

    return (
        <aside style={asideStyle}>
            {/* The way back sits in the sidebar's own header, above the
                brand, instead of in a strip across the whole page. */}
            <div style={{ padding: "8px 8px 0" }}>
                <RailBackLink />
            </div>
            <div
                style={{ padding: "8px 14px 10px", display: "flex", alignItems: "center", gap: 9 }}
            >
                <LaunchstackMark size={22} title={logoLabel} />
                <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em", flex: 1 }}>
                    {logoLabel}
                </div>
                {onOpenKnowledge && (
                    <button
                        onClick={onOpenKnowledge}
                        title="Open Knowledge"
                        aria-label="Open Knowledge"
                        style={{
                            width: 26,
                            height: 26,
                            borderRadius: 6,
                            background: "transparent",
                            color: "var(--ink-3)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            transition: "background 120ms, color 120ms",
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.background = "var(--line-2)";
                            e.currentTarget.style.color = "var(--ink)";
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.background = "transparent";
                            e.currentTarget.style.color = "var(--ink-3)";
                        }}
                    >
                        <IconGrid size={13} />
                    </button>
                )}
                <button
                    onClick={onOpenAdd}
                    title="Add knowledge  ⌘U"
                    style={{
                        width: 26,
                        height: 26,
                        borderRadius: 6,
                        background: "var(--accent)",
                        color: "white",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "filter 120ms",
                    }}
                >
                    <IconPlus size={13} />
                </button>
                {onClose && (
                    <button
                        onClick={onClose}
                        title="Hide sidebar  ⌘\"
                        aria-label="Hide sidebar"
                        style={{
                            width: 26,
                            height: 26,
                            borderRadius: 6,
                            background: "transparent",
                            color: "var(--ink-3)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            transition: "background 120ms, color 120ms",
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.background = "var(--line-2)";
                            e.currentTarget.style.color = "var(--ink)";
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.background = "transparent";
                            e.currentTarget.style.color = "var(--ink-3)";
                        }}
                    >
                        <IconChevronLeft size={14} />
                    </button>
                )}
            </div>

            {history && (
                <div
                    role="tablist"
                    aria-label="Sidebar section"
                    {...tabsTarget}
                    style={{
                        margin: "0 14px 10px",
                        display: "flex",
                        gap: 2,
                        padding: 2,
                        borderRadius: 7,
                        background: "var(--line-2)",
                    }}
                >
                    {(
                        [
                            { id: "sources", label: "Sources" },
                            { id: "history", label: "History" },
                        ] as const
                    ).map(item => {
                        const selected = activeTab === item.id;
                        return (
                            <button
                                key={item.id}
                                role="tab"
                                aria-selected={selected}
                                data-testid={`rail-tab-${item.id}`}
                                onClick={() => setTab(item.id)}
                                style={{
                                    flex: 1,
                                    padding: "4px 8px",
                                    borderRadius: 5,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    background: selected ? "var(--panel)" : "transparent",
                                    color: selected ? "var(--ink)" : "var(--ink-3)",
                                    boxShadow: selected ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                                    transition: "background 120ms, color 120ms",
                                }}
                            >
                                {item.label}
                            </button>
                        );
                    })}
                </div>
            )}

            <div style={{ padding: "0 14px 10px" }}>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        padding: "6px 10px",
                        borderRadius: 6,
                        background: "var(--line-2)",
                        border: `1px solid ${searchFocus ? "var(--accent)" : "transparent"}`,
                        transition: "border-color 120ms",
                    }}
                >
                    <IconSearch size={12} style={{ color: "var(--ink-3)" }} />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        onFocus={() => setSearchFocus(true)}
                        onBlur={() => setSearchFocus(false)}
                        placeholder={
                            activeTab === "history" ? "Search history" : "Search your knowledge"
                        }
                        style={{
                            flex: 1,
                            background: "transparent",
                            border: "none",
                            outline: "none",
                            fontSize: 13,
                            color: "var(--ink)",
                        }}
                    />
                </div>
            </div>

            {activeTab === "sources" && (Boolean(activeFolder) || Boolean(activeTag)) && (
                <div style={{ padding: "0 14px 8px" }}>
                    <button
                        data-testid="source-rail-scope"
                        onClick={() => {
                            setActiveFolder(null);
                            setActiveTag(null);
                        }}
                        title="Back to all folders"
                        style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "6px 10px",
                            borderRadius: 6,
                            background: "var(--accent-soft)",
                            color: "var(--accent-ink)",
                            fontSize: 12,
                            fontWeight: 500,
                        }}
                    >
                        <IconChevronLeft size={11} />
                        <span
                            style={{
                                flex: 1,
                                textAlign: "left",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                            }}
                        >
                            {activeFolder ? displayFolderPath(activeFolder) : `#${activeTag}`}
                        </span>
                        <IconX size={11} style={{ opacity: 0.5 }} />
                    </button>
                </div>
            )}

            {activeTab === "history" && history ? (
                <HistoryRail {...history} query={search} />
            ) : (
                <div
                    data-testid="source-rail-list"
                    {...railTarget}
                    onDragOver={e => {
                        // Empty rail space is the top level: a nested folder dropped
                        // here moves out of its parent.
                        if (drag?.kind === "folder" && onMoveFolder) e.preventDefault();
                    }}
                    onDrop={e => {
                        if (drag?.kind === "folder" && onMoveFolder) {
                            e.preventDefault();
                            const target = activeFolder;
                            if (joinFolderPath(target, folderLeafName(drag.path)) !== drag.path) {
                                onMoveFolder(drag.path, target);
                            }
                        }
                        setDrag(null);
                        setDragOverFolder(null);
                    }}
                    style={{ flex: 1, overflowY: "auto", padding: "2px 8px 8px" }}
                >
                    <SourceRows items={tree.items} ctx={branchCtx} />
                    {tree.children.map(node => (
                        <FolderBranch key={node.path} node={node} ctx={branchCtx} />
                    ))}
                    {filtered.length === 0 && (
                        <div
                            style={{
                                padding: "32px 14px",
                                textAlign: "center",
                                color: "var(--ink-3)",
                                fontSize: 13,
                            }}
                        >
                            Nothing here.{" "}
                            <button
                                onClick={onOpenAdd}
                                style={{
                                    color: "var(--accent)",
                                    fontWeight: 600,
                                    textDecoration: "underline",
                                }}
                            >
                                Add a source
                            </button>
                            .
                        </div>
                    )}
                </div>
            )}

            {selected.length > 0 && (
                <div
                    style={{
                        padding: "8px 14px",
                        borderTop: "1px solid var(--line)",
                        background: "var(--accent-soft)",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 12,
                        color: "var(--accent-ink)",
                    }}
                >
                    <span style={{ fontWeight: 600 }}>{selected.length}</span>
                    <span style={{ opacity: 0.7 }}>selected as context</span>
                    <div style={{ flex: 1 }} />
                    <button
                        onClick={() => setSelected([])}
                        style={{
                            fontSize: 12,
                            color: "var(--accent-ink)",
                            opacity: 0.7,
                            fontWeight: 500,
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.opacity = "1";
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.opacity = "0.7";
                        }}
                    >
                        clear
                    </button>
                </div>
            )}
        </aside>
    );
}
