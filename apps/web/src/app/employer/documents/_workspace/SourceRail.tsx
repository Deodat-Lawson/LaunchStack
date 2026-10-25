"use client";

import React, {
    Fragment,
    type Dispatch,
    type MouseEvent,
    type ReactNode,
    type SetStateAction,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { useTranslations } from "next-intl";
import {
    Folder,
    FolderOpen,
    Lock,
    Plus,
    ChevronLeft as IconChevronLeft,
    ChevronRight as IconChevronRight,
    Ellipsis as IconMore,
    Search as IconSearch,
    Shield as IconShield,
    Users,
    X as IconX,
} from "lucide-react";
import { ShortcutHint, type ShortcutHints, withShortcut } from "./ShortcutHint";

import { LaunchstackMark } from "~/app/_components/LaunchstackLogo";
import { LandingLogoLink } from "~/components/LandingLogoLink";
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
import { Checkbox as UiCheckbox } from "~/components/ui/checkbox";
import { useActionMenu, useContextTarget } from "~/components/context-menu";
import { usePeople } from "~/lib/profile/use-people";
import { cn } from "~/lib/utils";
import { HistoryRail, type HistoryRailProps } from "./HistoryRail";
import { InboxBell } from "./team/InboxBell";
import type { InboxRailProps, TeamTarget } from "./team/types";
import { SOURCE_DRAG_MIME } from "./dragData";
import { SourceFailureStatus, SourceProgressStatus } from "./SourceStatus";
import {
    buildBlankRailMenuItems,
    buildSelectionMenuItems,
    buildFolderMenuItems,
    buildSourceMenuItems,
    canChangeSource,
} from "./sourceContextMenu";
import {
    RAIL_SECTION_ORDER,
    audienceLabel,
    showsAudienceGlyph,
    sourceAudience,
    splitRailSections,
    type RailSection,
} from "./railSections";
import {
    SOURCE_META,
    type SourceAudience,
    type WorkspaceFolder,
    type WorkspaceSource,
} from "./types";

/** What is being dragged over the rail: a source into a folder, or a folder into a folder. */
type RailDrag = { kind: "source"; id: string } | { kind: "folder"; path: string };

async function copyText(value: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(value);
    } catch {
        // Private mode / missing permission — the action still closes the menu.
    }
}

/** What a row's audience glyph says: Lock for only you, Users for specific people. */
interface Glyph {
    kind: Exclude<SourceAudience, "workspace">;
    label: string;
}

/**
 * Who can see a row, as a small icon with its words for screen readers and on
 * hover. Everyone-in-the-workspace rows carry none ("nothing = everyone").
 */
function AudienceGlyph({ glyph, className }: { glyph: Glyph; className?: string }) {
    const Icon = glyph.kind === "private" ? Lock : Users;
    return (
        <span
            role="img"
            aria-label={glyph.label}
            title={glyph.label}
            data-audience={glyph.kind}
            className={cn("text-ink-3 inline-flex shrink-0 items-center", className)}
        >
            <Icon className="size-2.5" aria-hidden />
        </span>
    );
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
    disabled?: boolean;
}

function Checkbox({ state, onClick, title, disabled }: CheckboxProps) {
    return (
        <UiCheckbox
            checked={state === "some" ? "indeterminate" : state === "all"}
            disabled={disabled}
            onClick={e => {
                e.stopPropagation();
                onClick?.(e);
            }}
            title={title}
            aria-label={title}
            className="border-ink-4 enabled:hover:border-brand data-[state=indeterminate]:border-brand data-[state=indeterminate]:bg-brand-soft data-[state=indeterminate]:text-brand size-[15px] rounded-[3px] border-[1.5px] shadow-none enabled:cursor-pointer [&_svg]:size-2.5"
        />
    );
}

interface SourceRowProps {
    source: WorkspaceSource;
    selected: boolean;
    toggleSelected: (id: string) => void;
    onOpen?: (source: WorkspaceSource) => void;
    /** ⌘/Ctrl-click: open it in a pane beside what is showing, as an editor would. */
    onOpenBeside?: (source: WorkspaceSource) => void;
    /** The row's actions; absent when the rail is read-only. */
    menuItems?: (source: WorkspaceSource) => ActionMenuItem[];
    /** Who can see it, when the row should say so. */
    glyph?: Glyph | null;
    /** "Added by Ada · 2h ago", shown on hover. */
    addedLine?: string | null;
    /** Run a failed source's processing again; absent where the caller may not. */
    onRetry?: (source: WorkspaceSource) => Promise<void>;
}

function SourceRow({
    source,
    selected,
    toggleSelected,
    onOpen,
    onOpenBeside,
    menuItems,
    glyph,
    addedLine,
    onRetry,
}: SourceRowProps) {
    const t = useTranslations("sources.sourceRail");
    const meta = SOURCE_META[source.type] ?? SOURCE_META.doc;
    const Icon = meta.Icon;
    const [hover, setHover] = useState(false);
    const [menuFocus, setMenuFocus] = useState(false);
    const menu = useActionMenu();
    const menuLabel = t("actionsFor", { title: source.title });
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
    const failed = source.indexStatus === "failed";
    const processing = source.indexStatus === "processing" || source.syncing === true;

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
                state={!failed && selected ? "all" : "none"}
                disabled={failed}
                onClick={() => toggleSelected(source.id)}
                title={
                    failed
                        ? t("unavailableAsContext")
                        : selected
                          ? t("removeFromContext")
                          : t("addToContext")
                }
            />
            <div
                onClick={event => {
                    if ((event.metaKey || event.ctrlKey) && onOpenBeside) onOpenBeside(source);
                    else onOpen?.(source);
                }}
                title={[addedLine, onOpenBeside ? t("openBesideHint") : null]
                    .filter(Boolean)
                    .join("\n")}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
            >
                <Icon size={14} style={{ color: meta.color, flexShrink: 0 }} />
                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1">
                        <span
                            className={cn(
                                "min-w-0 flex-1 truncate text-[13px] leading-[1.35]",
                                selected ? "text-brand-ink font-semibold" : "text-ink"
                            )}
                        >
                            {source.title}
                        </span>
                        {glyph && <AudienceGlyph glyph={glyph} />}
                    </div>
                    {(visibleTags.length > 0 || failed || (source.gaps?.length ?? 0) > 0) && (
                        <div className="text-ink-3 mt-px flex items-center gap-1 overflow-hidden whitespace-nowrap text-[11px]">
                            {failed && <SourceFailureStatus source={source} onRetry={onRetry} />}
                            {visibleTags.map((tag, i) => (
                                <Fragment key={tag}>
                                    {i > 0 && <span style={{ opacity: 0.4 }}>·</span>}
                                    <TagChip tag={tag} />
                                </Fragment>
                            ))}
                            {extra > 0 && (
                                <span style={{ fontSize: 10, opacity: 0.6 }}>+{extra}</span>
                            )}
                            {(source.gaps?.length ?? 0) > 0 && (
                                <span
                                    title={source.gaps?.join(" · ")}
                                    className="text-warn-ink ml-auto inline-flex items-center gap-0.5 text-[10px] font-semibold"
                                >
                                    <IconShield size={9} />
                                    {source.gaps?.length}
                                </span>
                            )}
                        </div>
                    )}
                    {processing && !failed && <SourceProgressStatus source={source} />}
                </div>
            </div>
            {menuItems && (
                <button
                    type="button"
                    data-testid={`source-row-menu-${source.id}`}
                    aria-label={menuLabel}
                    aria-haspopup="menu"
                    title={t("actions")}
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

/** Every source id in a subtree; context selection excludes failed documents. */
function collectItemIds(node: SourceNode, excludeFailed = false, ids: string[] = []): string[] {
    for (const item of node.items) {
        if (!excludeFailed || item.indexStatus !== "failed") ids.push(item.id);
    }
    for (const child of node.children) collectItemIds(child, excludeFailed, ids);
    return ids;
}

interface FolderHeaderProps {
    node: SourceNode;
    /** Who can see it, when the row should say so (a top-level folder, or one unlike its parent). */
    glyph?: Glyph | null;
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
    glyph,
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
    const t = useTranslations("sources.sourceRail");
    const [hover, setHover] = useState(false);
    const [menuFocus, setMenuFocus] = useState(false);
    const menu = useActionMenu();
    const isUnfiled = node.path === UNFILED_FOLDER;
    const folderName = isUnfiled ? t("unfiled") : displayFolderPath(node.path);
    const menuLabel = t("actionsForFolder", { path: folderName });
    const ctxTarget = useContextTarget(
        menuItems
            ? { kind: "folder", id: node.path, label: menuLabel, data: node, items: menuItems }
            : null
    );
    const selectableIds = collectItemIds(node, true);
    const selCount = selectableIds.filter(id => selected.includes(id)).length;
    const state: CheckState =
        selCount === 0
            ? "none"
            : selCount === selectableIds.length && selectableIds.length > 0
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
                disabled={selectableIds.length === 0}
                onClick={() => onSelectAll(selectableIds, state !== "all")}
                title={state === "all" ? t("deselectFolder") : t("selectAllInFolder")}
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
                    title={folderName}
                >
                    {isUnfiled ? folderName : node.name}
                </span>
                {glyph && <AudienceGlyph glyph={glyph} />}
                {menuItems && (
                    <button
                        type="button"
                        data-testid={`folder-menu-${node.path}`}
                        aria-label={menuLabel}
                        aria-haspopup="menu"
                        title={t("folderActions")}
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
    /**
     * Create a folder; `parentPath` names the folder it goes inside, null or
     * undefined for the top level. Offered inside a folder only when the
     * caller can add to it (ADR-014 edit).
     */
    onNewFolder?: (parentPath?: string | null) => void;
    /** Rename, move and delete are offered per folder, where the caller manages it. */
    onRenameFolder?: (folder: WorkspaceFolder) => void;
    /** "Share…" — the Share dialog for a folder: who can open it and everything inside. */
    onShareFolder?: (folder: WorkspaceFolder) => void;
    /** Move a folder (and everything in it) under `targetParent`; null means the top level. */
    onMoveFolder?: (path: string, targetParent: string | null) => void;
    onDeleteFolder?: (folder: WorkspaceFolder) => void;
    /** File a source; offered per file where the caller can edit it, into folders they can add to. */
    onMoveToFolder?: (sourceId: string, folderName: string) => void;
    onRenameSource?: (source: WorkspaceSource) => void;
    /** "Share…" — the Share dialog for one file. */
    onRestrictAccess?: (source: WorkspaceSource) => void;
    onDeleteSource?: (source: WorkspaceSource) => void;
    /**
     * Run a failed source's processing again. Offered on the failed row where
     * the caller can edit the file — the same gate as uploading a new version.
     */
    onRetrySource?: (source: WorkspaceSource) => Promise<void>;
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
     * The app-wide controls the sidebar carries: the command palette and the
     * account. They used to sit at the end of the first column's tab strip,
     * which put them mid-screen whenever a second column opened. Opening an
     * app is not one of them — each column's "+" does that, in that column.
     */
    onOpenPalette?: () => void;
    accountSlot?: ReactNode;
    /** Its width in pixels. The docked sidebar's is the member's, dragged from its edge. */
    width?: number;
    /** The member's own keys for the sidebar's commands, formatted for show. */
    shortcuts?: ShortcutHints;
    /**
     * Everything the History tab needs. Omit it and the rail is sources-only,
     * with no tab strip — which is what the minimal embeddings want.
     */
    history?: Omit<HistoryRailProps, "query">;
    /**
     * The shared-with-you inbox bell (ADR-014), in the full workspace. The
     * rest of the team layer — people, groups, activity — is the Team tab,
     * not the sidebar: the sidebar makes, files and shares sources.
     */
    inbox?: InboxRailProps;
    /**
     * Show the Sources or History half — something opened from elsewhere (the
     * Team tab) lives there. Answered once: the rail calls `onRevealed` with
     * the nonce and the shell drops the request, so a rail that mounts again
     * later starts on the tab the member left it on.
     */
    revealTab?: { tab: "sources" | "history"; nonce: number } | null;
    onRevealed?: (nonce: number) => void;
    /** "Everyone at <name>" on a workspace-wide row's glyph. */
    workspaceName?: string | null;
    /** The signed-in person's auth id: their own files read "Added by you". */
    selfAuthId?: string | null;
    /**
     * The library is still loading: draw no sections yet, so the rail never
     * flashes "Files you add start here" over a library that has files.
     */
    loading?: boolean;
}

/**
 * Which part of the rail is showing. Persisted, so a habit survives a reload.
 * A saved "team" — the tab the team layer once had here — reads as Sources.
 */
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
    /** The folder's audience glyph; `topLevel` rows always say, nested ones only when unlike their parent. */
    folderGlyph: (path: string, topLevel: boolean) => Glyph | null;
    sourceGlyph: (source: WorkspaceSource, topLevel: boolean) => Glyph | null;
    /** "Added by Ada · 2h ago". */
    addedLine: (source: WorkspaceSource) => string | null;
    /** Retry for this failed source, when the caller may run it again. */
    retryFor: (source: WorkspaceSource) => ((source: WorkspaceSource) => Promise<void>) | undefined;
    /** May the caller rename, move or delete this folder (ADR-014 manage)? */
    canManageFolder: (path: string) => boolean;
    /** May the caller add to this folder — a file dropped on it, a subfolder (edit)? */
    canEditFolder: (path: string) => boolean;
    /** May the source being dragged be filed here: the caller edits both it and the folder. */
    canDropSource: (sourceId: string, path: string) => boolean;
}

/** Every folder path in a subtree, the root included. */
function collectFolderPaths(node: SourceNode): string[] {
    return [node.path, ...node.children.flatMap(collectFolderPaths)];
}

function SourceRows({
    items,
    ctx,
    topLevel = false,
}: {
    items: WorkspaceSource[];
    ctx: BranchContext;
    /** Loose files at a section's top level always show who can see them. */
    topLevel?: boolean;
}) {
    return (
        <>
            {items.map(s => (
                <div
                    key={s.id}
                    draggable
                    onDragStart={e => {
                        e.stopPropagation();
                        ctx.setDrag({ kind: "source", id: s.id });
                        // Also a drag the workspace's panes can take: drop it
                        // on a pane to open it there, or on an edge to split.
                        // jsdom fires drag events without a dataTransfer.
                        if (e.dataTransfer) {
                            e.dataTransfer.effectAllowed = "copyMove";
                            e.dataTransfer.setData(SOURCE_DRAG_MIME, s.id);
                            e.dataTransfer.setData("text/plain", s.title);
                        }
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
                        onOpenBeside={ctx.onOpenSourceBeside}
                        menuItems={ctx.sourceMenuItems}
                        glyph={ctx.sourceGlyph(s, topLevel)}
                        addedLine={ctx.addedLine(s)}
                        onRetry={ctx.retryFor(s)}
                    />
                </div>
            ))}
        </>
    );
}

function FolderBranch({
    node,
    ctx,
    topLevel = false,
}: {
    node: SourceNode;
    ctx: BranchContext;
    /** The first row of a section (or of a scoped view) — it always says who can see it. */
    topLevel?: boolean;
}) {
    const isCollapsed = !!ctx.collapsed[node.path];
    const isDragOver = ctx.dragOverFolder === node.path;
    // A folder cannot be dropped on itself, inside itself, or under Unfiled;
    // nothing lands in a folder the caller cannot add to (ADR-014 edit).
    const acceptsDrag =
        (ctx.drag?.kind === "source" && ctx.canDropSource(ctx.drag.id, node.path)) ||
        (ctx.drag?.kind === "folder" &&
            node.path !== UNFILED_FOLDER &&
            !isFolderOrDescendant(node.path, ctx.drag.path) &&
            ctx.canEditFolder(node.path));
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
                glyph={ctx.folderGlyph(node.path, topLevel)}
                selected={ctx.selected}
                collapsed={isCollapsed}
                onToggle={() => ctx.toggleCollapsed(node.path)}
                onSelectAll={ctx.selectMany}
                menuItems={() => ctx.folderMenuItems(node)}
                dragOver={isDragOver}
                draggable={ctx.canDragFolders && !isUnfiled && ctx.canManageFolder(node.path)}
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

/** Drag-over key for the Private section: dropping a file there files it loose (Unfiled), private to you. */
const PRIVATE_DROP_KEY = "section:private";

/**
 * One of the rail's three sections (ADR-014 §6): a small sentence-case
 * label with a count, then its top-level folders and loose files. Private
 * also takes a dropped file — that is how a file goes back to being only
 * yours — and when empty says where new files land.
 */
function RailSectionBlock({
    section,
    ctx,
    showEmptyHint,
}: {
    section: RailSection;
    ctx: BranchContext;
    /** Browsing (no filter): an empty Private section explains itself. */
    showEmptyHint: boolean;
}) {
    const t = useTranslations("sources.sourceRail");
    const label = t(`sections.${section.id}`);
    const empty = section.folders.length === 0 && section.items.length === 0;
    const takesDrop =
        section.id === "private" &&
        ctx.drag?.kind === "source" &&
        ctx.canDropSource(ctx.drag.id, UNFILED_FOLDER);
    const dragOver = takesDrop && ctx.dragOverFolder === PRIVATE_DROP_KEY;
    return (
        <section
            aria-label={label}
            data-testid={`rail-section-${section.id}`}
            className={cn(
                "mt-3 rounded-md border border-transparent first:mt-1",
                dragOver && "border-brand bg-brand-soft border-dashed"
            )}
            onDragEnter={e => {
                if (!takesDrop) return;
                e.preventDefault();
                ctx.setDragOverFolder(PRIVATE_DROP_KEY);
            }}
            onDragOver={e => {
                if (takesDrop) e.preventDefault();
            }}
            onDrop={e => {
                if (!takesDrop) return;
                e.preventDefault();
                e.stopPropagation();
                ctx.dropOnFolder(UNFILED_FOLDER);
            }}
        >
            <h3 className="text-ink-3 flex items-center gap-1.5 px-2.5 pb-0.5 text-[11px] font-medium">
                <span>{label}</span>
                {/* Files in the section; a section of empty folders shows none rather than "0". */}
                {section.count > 0 && (
                    <span className="mono text-ink-4 text-[10px]">{section.count}</span>
                )}
            </h3>
            {empty ? (
                showEmptyHint && (
                    <p className="text-ink-3 px-2.5 py-1 text-xs leading-snug">
                        {t("privateEmptyHint")}
                    </p>
                )
            ) : (
                <>
                    {section.folders.map(node => (
                        <FolderBranch key={node.path} node={node} ctx={ctx} topLevel />
                    ))}
                    <SourceRows items={section.items} ctx={ctx} topLevel />
                </>
            )}
        </section>
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
    onRetrySource,
    onDeleteSources,
    onAddToFolder,
    activeFolder,
    setActiveFolder,
    activeTag,
    setActiveTag,
    logoLabel = "Launchstack",
    onClose,
    onOpenKnowledge,
    onOpenPalette,
    accountSlot,
    width = 280,
    shortcuts,
    history,
    inbox,
    revealTab,
    onRevealed,
    workspaceName,
    selfAuthId,
    loading = false,
}: SourceRailProps) {
    const t = useTranslations("sources.sourceRail");
    const tr = useTranslations("sources.railCommands");
    const tm = useTranslations("sources.contextMenu");
    const ta = useTranslations("sources.audience");
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
            const saved = localStorage.getItem(RAIL_TAB_KEY);
            if (saved === "history") setTab(saved);
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

    // Declared after the restore above, so a request made while the rail was
    // hidden (it mounts fresh) wins over the saved tab.
    useEffect(() => {
        if (!revealTab) return;
        setTab(revealTab.tab);
        onRevealed?.(revealTab.nonce);
    }, [revealTab, onRevealed]);

    /** Opening something from the inbox shows where it lives. */
    const inboxOpen = useCallback(
        (target: TeamTarget) => {
            if (target.type === "chat") {
                if (history) setTab("history");
            } else {
                setTab("sources");
            }
            inbox?.onOpenTarget(target);
        },
        [inbox, history]
    );

    // A rail without history props can never sit on a tab that isn't there.
    const activeTab: RailTab = history ? tab : "sources";

    // A source may have been pinned while processing, before indexing failed.
    useEffect(() => {
        const failedIds = new Set<string>();
        for (const source of sources) {
            if (source.indexStatus === "failed") failedIds.add(source.id);
        }
        if (selected.some(id => failedIds.has(id))) {
            setSelected(prev => prev.filter(id => !failedIds.has(id)));
        }
    }, [sources, selected, setSelected]);

    const folderFor = useCallback(
        (path: string): WorkspaceFolder =>
            folders.find(f => f.name === path) ?? {
                id: `f-${path}`,
                name: path,
                color: "var(--ink-3)",
            },
        [folders]
    );

    // ADR-014, per item. A folder or file the server has not described
    // (a staged upload, an implied folder) is not refused here: the server
    // still decides, and the rail does not hide what it cannot judge.
    const canManageFolder = useCallback(
        (path: string) => folderFor(path).access?.canManage !== false,
        [folderFor]
    );
    const canEditFolder = useCallback(
        (path: string) => path === UNFILED_FOLDER || folderFor(path).access?.canEdit !== false,
        [folderFor]
    );

    const folderGlyph = useCallback(
        (path: string, topLevel: boolean): Glyph | null => {
            const folder = folderFor(path);
            const access = folder.access;
            if (!access) {
                // From a server without per-caller access: the old lock.
                return folder.restricted && topLevel
                    ? { kind: "shared", label: t("onlyPeopleWithAccess") }
                    : null;
            }
            if (!showsAudienceGlyph(access, topLevel) || access.audience === "workspace") {
                return null;
            }
            return { kind: access.audience, label: audienceLabel(access, workspaceName, ta) };
        },
        [folderFor, workspaceName, t, ta]
    );

    const sourceGlyph = useCallback(
        (source: WorkspaceSource, topLevel: boolean): Glyph | null => {
            const audience = sourceAudience(source);
            if (audience === "workspace") return null;
            const access = source.access ?? {
                audience,
                // A staged upload or a legacy restricted row: it is its own.
                ownAudience: true,
                principalCount: 0,
            };
            if (!showsAudienceGlyph(access, topLevel)) return null;
            return { kind: audience, label: audienceLabel(access, workspaceName, ta) };
        },
        [workspaceName, ta]
    );

    // Names as people appear in this workspace now, not as they were when
    // they uploaded.
    const adderIds = useMemo(
        () =>
            sources.flatMap(s =>
                s.addedBy?.authUserId && s.addedBy.authUserId !== selfAuthId
                    ? [s.addedBy.authUserId]
                    : []
            ),
        [sources, selfAuthId]
    );
    const people = usePeople(adderIds);
    const addedLine = useCallback(
        (source: WorkspaceSource): string | null => {
            const by = source.addedBy;
            if (!by) return null;
            const name =
                by.authUserId === selfAuthId
                    ? t("you")
                    : (people[by.authUserId]?.displayName ?? by.name);
            return source.added
                ? t("addedByWhen", { name, added: source.added })
                : t("addedBy", { name });
        },
        [people, selfAuthId, t]
    );

    const canDropSource = useCallback(
        (sourceId: string, path: string) => {
            const source = sources.find(s => s.id === sourceId);
            return Boolean(source) && canChangeSource(source!) && canEditFolder(path);
        },
        [sources, canEditFolder]
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
                return buildSelectionMenuItems(tm, chosen, folders, {
                    onRemoveFromContext: ids =>
                        setSelected(prev => prev.filter(id => !ids.includes(id))),
                    onMoveToFolder: onMoveToFolder
                        ? (ids, name) => ids.forEach(id => onMoveToFolder(id, name))
                        : undefined,
                    onDelete: onDeleteSources,
                });
            }
            return buildSourceMenuItems(tm, source, folders, selected, {
                onOpen: onOpenSource,
                onOpenBeside: onOpenSourceBeside,
                onToggleContext:
                    source.indexStatus === "failed" && !selected.includes(source.id)
                        ? undefined
                        : s => {
                              setSelected(prev =>
                                  prev.includes(s.id)
                                      ? prev.filter(id => id !== s.id)
                                      : [...prev, s.id]
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
            tm,
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
            cut.forEach(id => {
                if (canDropSource(id, target)) onMoveToFolder(id, target);
            });
            setCut([]);
        },
        [cut, onMoveToFolder, canDropSource]
    );

    const folderMenuItems = useCallback(
        (node: SourceNode): ActionMenuItem[] => {
            const path = node.path;
            const itemIds = collectItemIds(node, true);
            const isUnfiled = path === UNFILED_FOLDER;
            const selCount = itemIds.filter(id => selected.includes(id)).length;
            const selectState: "none" | "some" | "all" =
                selCount === 0
                    ? "none"
                    : selCount === itemIds.length && itemIds.length > 0
                      ? "all"
                      : "some";
            const subtree = collectFolderPaths(node);
            const manages = !isUnfiled && canManageFolder(path);
            const edits = canEditFolder(path);
            return buildFolderMenuItems(tm, path, {
                onOpen:
                    activeFolder === path
                        ? undefined
                        : () => {
                              setActiveFolder(path);
                              setActiveTag(null);
                          },
                onAddSource: onAddToFolder && edits ? () => onAddToFolder(path) : undefined,
                cutCount: cut.length,
                onPaste: onMoveToFolder && edits ? () => pasteCut(path) : undefined,
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
                onNewSubfolder:
                    onNewFolder && !isUnfiled && edits ? () => onNewFolder(path) : undefined,
                onRename:
                    onRenameFolder && manages ? () => onRenameFolder(folderFor(path)) : undefined,
                onMove: onMoveFolder && manages ? target => onMoveFolder(path, target) : undefined,
                onDelete:
                    onDeleteFolder && manages ? () => onDeleteFolder(folderFor(path)) : undefined,
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
                // A folder moves only into one the caller can add to.
                folders: folders.filter(f => f.access?.canEdit !== false).map(f => f.name),
            });
        },
        [
            tm,
            selected,
            setSelected,
            activeFolder,
            setActiveFolder,
            setActiveTag,
            folders,
            folderFor,
            canManageFolder,
            canEditFolder,
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
        label: t("sidebarActions"),
        items: () =>
            buildBlankRailMenuItems(tm, {
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
                  label: t("sidebarTabs"),
                  items: (): ActionMenuItem[] => [
                      {
                          type: "item",
                          id: "tab-sources",
                          label: t("tabSources"),
                          icon: activeTab === "sources" ? "check" : "folder",
                          checked: activeTab === "sources",
                          onSelect: () => setTab("sources"),
                      },
                      {
                          type: "item",
                          id: "tab-history",
                          label: t("tabHistory"),
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
                                    label: tr("hideSidebar"),
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

    // Browsing the whole library splits it by audience; inside one folder
    // the view is that folder's subtree, as before.
    const sections = useMemo(
        () => splitRailSections(tree, path => folderFor(path).access?.audience),
        [tree, folderFor]
    );
    const filtering = Boolean(search) || Boolean(activeTag);

    const toggle = (id: string) => {
        if (sources.some(source => source.id === id && source.indexStatus === "failed")) return;
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
            if (canDropSource(drag.id, target)) onMoveToFolder?.(drag.id, target);
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

    // Retrying re-runs processing for the file, so it takes what a new
    // version would: edit access. The server checks again.
    const retryFor = (source: WorkspaceSource) =>
        onRetrySource && source.indexStatus === "failed" && canChangeSource(source)
            ? onRetrySource
            : undefined;

    const branchCtx: BranchContext = {
        selected,
        collapsed,
        toggleCollapsed,
        folderGlyph,
        sourceGlyph,
        addedLine,
        retryFor,
        canManageFolder,
        canEditFolder,
        canDropSource,
        toggleSelected: toggle,
        selectMany,
        drag,
        setDrag,
        dragOverFolder,
        setDragOverFolder,
        canDragFolders: Boolean(onMoveFolder),
        dropOnFolder,
        onOpenSource,
        onOpenSourceBeside,
        sourceMenuItems,
        folderMenuItems,
    };

    return (
        // The width is the one inline style: it is the member's, dragged
        // from the edge (see RailResizeHandle), not a design value.
        <aside
            className="border-line bg-panel flex h-full shrink-0 flex-col overflow-hidden border-r"
            style={{ width }}
        >
            <div className="flex items-center gap-1 px-3.5 pb-2.5 pt-3.5">
                {/* mr-auto parks the hide control at the edge without making
                    the empty space between them part of the link. The name
                    yields before that control is pushed past the sidebar's
                    edge. */}
                <LandingLogoLink className="mr-auto flex min-w-0 items-center gap-[9px]">
                    <LaunchstackMark size={22} title={logoLabel} />
                    <span className="min-w-0 truncate text-[13px] font-bold tracking-[-0.01em]">
                        {logoLabel}
                    </span>
                </LandingLogoLink>
                {inbox && <InboxBell onOpenTarget={inboxOpen} />}
                {onClose && (
                    <button
                        onClick={onClose}
                        title={withShortcut(tr("hideSidebar"), shortcuts?.rail)}
                        aria-label={tr("hideSidebar")}
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

            {/* The sidebar's commands, named and with their keys showing.
                They were bare icons in the header, which hid ⌘K and ⌘U in
                tooltips; shortcuts are how this workspace is meant to be
                driven, so they sit where the action is, as in Linear's and
                Notion's sidebars. */}
            <div className="flex flex-col gap-px px-2 pb-2.5">
                {onOpenPalette && (
                    <RailCommand
                        icon={<IconSearch className="size-3.5" />}
                        label={tr("jumpToAnything")}
                        keys={shortcuts?.palette}
                        onClick={onOpenPalette}
                        testId="rail-palette"
                    />
                )}
                <RailCommand
                    icon={<Plus className="text-brand size-3.5" />}
                    label={tr("addKnowledge")}
                    keys={shortcuts?.add}
                    onClick={onOpenAdd}
                    testId="rail-add"
                />
            </div>

            {history && (
                <div
                    role="tablist"
                    aria-label={t("sidebarSection")}
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
                            { id: "sources", label: t("tabSources") },
                            { id: "history", label: t("tabHistory") },
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
                        // What `/` focuses. Found by this, not by the placeholder,
                        // which changes with the tab — on History, `/` found
                        // nothing and did nothing.
                        data-rail-search
                        // "Filter", not "Search": it narrows the list below and
                        // leaves you here to act on what is left — tick sources
                        // as context, move them, reopen a chat. ⌘K is the search
                        // that jumps; calling this one search too made it read
                        // as a smaller copy of that.
                        placeholder={
                            activeTab === "history" ? t("filterHistory") : t("filterSources")
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
                    {!searchFocus && !search && <ShortcutHint keys={shortcuts?.search} />}
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
                        title={t("backToAll")}
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
                            {activeFolder
                                ? activeFolder === UNFILED_FOLDER
                                    ? t("unfiled")
                                    : displayFolderPath(activeFolder)
                                : `#${activeTag}`}
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
                    {activeFolder ? (
                        <>
                            <SourceRows items={tree.items} ctx={branchCtx} />
                            {tree.children.map(node => (
                                <FolderBranch key={node.path} node={node} ctx={branchCtx} />
                            ))}
                        </>
                    ) : loading && sources.length === 0 && folders.length === 0 ? null : (
                        RAIL_SECTION_ORDER.map(id => {
                            const section = sections[id];
                            const empty =
                                section.folders.length === 0 && section.items.length === 0;
                            // Empty sections stay out of the way — except
                            // Private while browsing, which says where new
                            // files land.
                            if (empty && (id !== "private" || filtering)) return null;
                            return (
                                <RailSectionBlock
                                    key={id}
                                    section={section}
                                    ctx={branchCtx}
                                    showEmptyHint={!filtering}
                                />
                            );
                        })
                    )}
                    {filtered.length === 0 && (Boolean(activeFolder) || filtering) && (
                        <div
                            style={{
                                padding: "32px 14px",
                                textAlign: "center",
                                color: "var(--ink-3)",
                                fontSize: 13,
                            }}
                        >
                            {t.rich("empty", {
                                add: chunks => (
                                    <button
                                        onClick={onOpenAdd}
                                        style={{
                                            color: "var(--accent)",
                                            fontWeight: 600,
                                            textDecoration: "underline",
                                        }}
                                    >
                                        {chunks}
                                    </button>
                                ),
                            })}
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
                    {t.rich("selectedAsContext", {
                        count: selected.length,
                        b: chunks => <span style={{ fontWeight: 600 }}>{chunks}</span>,
                        dim: chunks => <span style={{ opacity: 0.7 }}>{chunks}</span>,
                    })}
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
                        {t("clear")}
                    </button>
                </div>
            )}

            {accountSlot && (
                // The account sits at the foot of the sidebar, as it does in
                // most apps with one — in the same place whatever the columns
                // beside it are doing.
                <div className="border-line shrink-0 border-t p-1.5">{accountSlot}</div>
            )}
        </aside>
    );
}

/** One of the sidebar's commands: an icon, its name, and its key. */
function RailCommand({
    icon,
    label,
    keys,
    onClick,
    testId,
}: {
    icon: ReactNode;
    label: string;
    keys: string | null | undefined;
    onClick: () => void;
    testId: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            data-testid={testId}
            className="text-ink-2 hover:bg-line-2 hover:text-ink focus-visible:ring-brand/50 flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] outline-none transition-colors focus-visible:ring-[3px]"
        >
            <span className="text-ink-3 flex shrink-0 items-center">{icon}</span>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <ShortcutHint keys={keys} />
        </button>
    );
}
