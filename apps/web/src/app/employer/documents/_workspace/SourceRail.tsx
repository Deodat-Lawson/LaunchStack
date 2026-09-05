"use client";

import React, {
    Fragment,
    type CSSProperties,
    type Dispatch,
    type MouseEvent,
    type SetStateAction,
    useMemo,
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
import {
    UNFILED_FOLDER,
    buildFolderTree,
    displayFolderPath,
    folderLeafName,
    isFolderOrDescendant,
    joinFolderPath,
    type FolderTreeNode,
} from "~/lib/folders/path";
import { ContextMenu } from "./ContextMenu";
import {
    buildBlankRailMenuItems,
    buildFolderMenuItems,
    buildSourceMenuItems,
    type SourceContextMenuItem,
} from "./sourceContextMenu";
import { SOURCE_META, type WorkspaceFolder, type WorkspaceSource } from "./types";

type RailMenu =
    | { kind: "source"; x: number; y: number; source: WorkspaceSource }
    | { kind: "folder"; x: number; y: number; folderPath: string; itemIds: string[] }
    | { kind: "blank"; x: number; y: number };

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
    onOpenMenu?: (point: { clientX: number; clientY: number }, source: WorkspaceSource) => void;
}

function SourceRow({ source, selected, toggleSelected, onOpen, onOpenMenu }: SourceRowProps) {
    const meta = SOURCE_META[source.type] ?? SOURCE_META.doc;
    const Icon = meta.Icon;
    const [hover, setHover] = useState(false);
    const [menuFocus, setMenuFocus] = useState(false);
    const tags = source.tags ?? [];
    const visibleTags = tags.slice(0, 2);
    const extra = tags.length - visibleTags.length;
    const showActions = hover || menuFocus;

    return (
        <div
            data-testid={`source-row-${source.id}`}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            onContextMenu={e => {
                if (!onOpenMenu) return;
                e.preventDefault();
                e.stopPropagation();
                onOpenMenu({ clientX: e.clientX, clientY: e.clientY }, source);
            }}
            onKeyDown={e => {
                if (!onOpenMenu) return;
                if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                onOpenMenu({ clientX: rect.left + 16, clientY: rect.bottom }, source);
            }}
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
            {onOpenMenu && (
                <button
                    type="button"
                    data-testid={`source-row-menu-${source.id}`}
                    aria-label={`Actions for ${source.title}`}
                    aria-haspopup="menu"
                    title="Actions"
                    onClick={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        onOpenMenu({ clientX: rect.right, clientY: rect.bottom }, source);
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
    onOpenMenu?: (point: { clientX: number; clientY: number }) => void;
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
    onOpenMenu,
    selected,
    dragOver,
    draggable,
    onDragStart,
    onDragEnd,
}: FolderHeaderProps) {
    const [hover, setHover] = useState(false);
    const [menuFocus, setMenuFocus] = useState(false);
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
            onContextMenu={e => {
                if (!onOpenMenu) return;
                e.preventDefault();
                e.stopPropagation();
                onOpenMenu({ clientX: e.clientX, clientY: e.clientY });
            }}
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
                {onOpenMenu && (
                    <button
                        type="button"
                        data-testid={`folder-menu-${node.path}`}
                        aria-label={`Actions for folder ${displayFolderPath(node.path)}`}
                        aria-haspopup="menu"
                        title="Folder actions"
                        onClick={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            onOpenMenu({ clientX: rect.right, clientY: rect.bottom });
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
    onOpenSource?: (source: WorkspaceSource) => void;
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
}

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
    openSourceMenu: (point: { clientX: number; clientY: number }, source: WorkspaceSource) => void;
    openFolderMenu: (point: { clientX: number; clientY: number }, node: SourceNode) => void;
    /** True when the folder, or an ancestor, is restricted to the people granted access. */
    isRestricted: (path: string) => boolean;
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
                        onOpenMenu={ctx.openSourceMenu}
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
                onOpenMenu={point => ctx.openFolderMenu(point, node)}
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
    onNewFolder,
    onRenameFolder,
    onShareFolder,
    onMoveFolder,
    onDeleteFolder,
    onMoveToFolder,
    onRenameSource,
    onRestrictAccess,
    onDeleteSource,
    activeFolder,
    setActiveFolder,
    activeTag,
    setActiveTag,
    logoLabel = "Launchstack",
    onClose,
    onOpenKnowledge,
}: SourceRailProps) {
    const [search, setSearch] = useState("");
    const [searchFocus, setSearchFocus] = useState(false);
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
    const [drag, setDrag] = useState<RailDrag | null>(null);
    const [menu, setMenu] = useState<RailMenu | null>(null);

    const closeMenu = () => setMenu(null);

    const folderFor = (path: string): WorkspaceFolder =>
        folders.find(f => f.name === path) ?? {
            id: `f-${path}`,
            name: path,
            color: "var(--ink-3)",
        };

    const menuItems = useMemo<SourceContextMenuItem[]>(() => {
        if (!menu) return [];
        if (menu.kind === "source") {
            return buildSourceMenuItems(menu.source, folders, selected, {
                onOpen: onOpenSource,
                onToggleContext: source => {
                    setSelected(prev =>
                        prev.includes(source.id)
                            ? prev.filter(id => id !== source.id)
                            : [...prev, source.id]
                    );
                },
                onRename: onRenameSource,
                onMoveToFolder,
                onCopyTitle: source => {
                    void copyText(source.title);
                },
                onRestrictAccess,
                onDelete: onDeleteSource,
            });
        }
        if (menu.kind === "folder") {
            const path = menu.folderPath;
            const isUnfiled = path === UNFILED_FOLDER;
            const selCount = menu.itemIds.filter(id => selected.includes(id)).length;
            const selectState: "none" | "some" | "all" =
                selCount === 0
                    ? "none"
                    : selCount === menu.itemIds.length && menu.itemIds.length > 0
                      ? "all"
                      : "some";
            return buildFolderMenuItems(path, {
                onOpen:
                    activeFolder === path
                        ? undefined
                        : () => {
                              setActiveFolder(path);
                              setActiveTag(null);
                          },
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
                            menu.itemIds.forEach(id => set.add(id));
                            return [...set];
                        }
                        return prev.filter(id => !menu.itemIds.includes(id));
                    });
                },
                selectState,
                folders: folders.map(f => f.name),
            });
        }
        return buildBlankRailMenuItems({
            onAddKnowledge: onOpenAdd,
            onNewFolder: onNewFolder ? () => onNewFolder(null) : undefined,
        });
        // folderFor is derived from `folders`, which is a dependency.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        menu,
        folders,
        selected,
        activeFolder,
        onOpenSource,
        onRenameSource,
        onRestrictAccess,
        onMoveToFolder,
        onDeleteSource,
        onRenameFolder,
        onShareFolder,
        onMoveFolder,
        onDeleteFolder,
        onOpenAdd,
        onNewFolder,
        setSelected,
        setActiveFolder,
        setActiveTag,
    ]);

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
                    `${s.title} ${s.folder ?? ""} ${(s.tags ?? []).join(" ")}`.toLowerCase();
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
        openSourceMenu: (point, source) =>
            setMenu({ kind: "source", x: point.clientX, y: point.clientY, source }),
        openFolderMenu: (point, node) =>
            setMenu({
                kind: "folder",
                x: point.clientX,
                y: point.clientY,
                folderPath: node.path,
                itemIds: collectItemIds(node),
            }),
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
            <div
                style={{ padding: "14px 14px 10px", display: "flex", alignItems: "center", gap: 9 }}
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
                        transition: "transform 80ms, filter 120ms",
                    }}
                    onMouseDown={e => {
                        e.currentTarget.style.transform = "scale(0.94)";
                    }}
                    onMouseUp={e => {
                        e.currentTarget.style.transform = "scale(1)";
                    }}
                    onMouseLeave={e => {
                        e.currentTarget.style.transform = "scale(1)";
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
                        placeholder="Search your knowledge"
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

            {(Boolean(activeFolder) || Boolean(activeTag)) && (
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

            <div
                data-testid="source-rail-list"
                onContextMenu={e => {
                    e.preventDefault();
                    setMenu({ kind: "blank", x: e.clientX, y: e.clientY });
                }}
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

                {!activeTag && !search && onNewFolder && (
                    <button
                        data-testid="source-rail-new-folder"
                        onClick={() => onNewFolder(activeFolder)}
                        style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                            padding: "6px 10px",
                            marginTop: 8,
                            borderRadius: 5,
                            color: "var(--ink-3)",
                            fontSize: 12,
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.color = "var(--accent)";
                            e.currentTarget.style.background = "var(--line-2)";
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.color = "var(--ink-3)";
                            e.currentTarget.style.background = "transparent";
                        }}
                    >
                        <IconPlus size={11} />
                        {activeFolder ? "New subfolder" : "New folder"}
                    </button>
                )}
            </div>

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
            {menu && (
                <ContextMenu
                    open
                    x={menu.x}
                    y={menu.y}
                    items={menuItems}
                    ariaLabel={
                        menu.kind === "source"
                            ? `Actions for ${menu.source.title}`
                            : menu.kind === "folder"
                              ? `Actions for folder ${displayFolderPath(menu.folderPath)}`
                              : "Sidebar actions"
                    }
                    onClose={closeMenu}
                />
            )}
        </aside>
    );
}
