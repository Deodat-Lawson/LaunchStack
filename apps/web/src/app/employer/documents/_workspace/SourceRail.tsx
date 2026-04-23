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
  IconMore,
  IconPlus,
  IconSearch,
  IconShield,
  IconX,
} from "./icons";
import { LaunchstackMark } from "~/app/_components/LaunchstackLogo";
import { SOURCE_META, type WorkspaceFolder, type WorkspaceSource } from "./types";

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
      onMouseEnter={(e) => {
        if (onClick) e.currentTarget.style.color = "var(--accent-ink)";
      }}
      onMouseLeave={(e) => {
        if (onClick) e.currentTarget.style.color = "var(--ink-3)";
      }}
    >
      <span style={{ fontSize: small ? 10 : 11, fontWeight: 600, opacity: 0.6 }}>#</span>
      {tag}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          style={{ marginLeft: 1, color: "var(--ink-3)", display: "flex", alignItems: "center" }}
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
      onClick={(e) => {
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
      onMouseEnter={(e) => {
        if (state === "none") e.currentTarget.style.borderColor = "var(--accent)";
      }}
      onMouseLeave={(e) => {
        if (state === "none") e.currentTarget.style.borderColor = "var(--ink-4)";
      }}
    >
      {state === "all" && <IconCheck size={10} style={{ color: "white" }} />}
      {state === "some" && <div style={{ width: 7, height: 1.5, background: "var(--accent)" }} />}
    </button>
  );
}

interface SourceRowProps {
  source: WorkspaceSource;
  selected: boolean;
  toggleSelected: (id: string) => void;
  onOpen?: (source: WorkspaceSource) => void;
}

function SourceRow({ source, selected, toggleSelected, onOpen }: SourceRowProps) {
  const meta = SOURCE_META[source.type] ?? SOURCE_META.doc;
  const Icon = meta.Icon;
  const [hover, setHover] = useState(false);
  const tags = source.tags ?? [];
  const visibleTags = tags.slice(0, 2);
  const extra = tags.length - visibleTags.length;

  return (
    <div
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
            {source.title}
          </div>
          {(visibleTags.length > 0 || source.syncing || (source.gaps?.length ?? 0) > 0) && (
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
              {extra > 0 && <span style={{ fontSize: 10, opacity: 0.6 }}>+{extra}</span>}
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
    </div>
  );
}

interface FolderHeaderProps {
  folder: { name: string; id?: string; color?: string };
  items: WorkspaceSource[];
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onSelectAll: (ids: string[], add: boolean) => void;
  onRename?: () => void;
  selected: string[];
  dragOver: boolean;
}

function FolderHeader({
  folder,
  items,
  count,
  collapsed,
  onToggle,
  onSelectAll,
  onRename,
  selected,
  dragOver,
}: FolderHeaderProps) {
  const [hover, setHover] = useState(false);
  const itemIds = items.map((i) => i.id);
  const selCount = itemIds.filter((id) => selected.includes(id)).length;
  const state: CheckState = selCount === 0 ? "none" : selCount === itemIds.length ? "all" : "some";
  return (
    <div
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
          }}
        />
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
        >
          {folder.name}
        </span>
        {onRename && hover && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRename();
            }}
            title="Rename or delete folder"
            style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              color: "var(--ink-3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--ink)";
              e.currentTarget.style.background = "var(--panel)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--ink-3)";
              e.currentTarget.style.background = "transparent";
            }}
          >
            <IconMore size={12} />
          </button>
        )}
        <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
          {count}
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
  onNewFolder?: () => void;
  onRenameFolder?: (folder: WorkspaceFolder) => void;
  onMoveToFolder?: (sourceId: string, folderName: string) => void;
  activeFolder: string | null;
  setActiveFolder: Dispatch<SetStateAction<string | null>>;
  activeTag: string | null;
  setActiveTag: Dispatch<SetStateAction<string | null>>;
  /** Rendered at the rail header; omit in minimal mode. */
  logoLabel?: string;
}

interface GroupEntry {
  key: string;
  name: string | null;
  folder: { name: string; id?: string; color?: string } | null;
  items: WorkspaceSource[];
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
  onMoveToFolder,
  activeFolder,
  setActiveFolder,
  activeTag,
  setActiveTag,
  logoLabel = "Launchstack",
}: SourceRailProps) {
  const [search, setSearch] = useState("");
  const [searchFocus, setSearchFocus] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const toggleCollapsed = (name: string) =>
    setCollapsed((p) => ({ ...p, [name]: !p[name] }));

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return sources.filter((s) => {
      if (activeFolder && s.folder !== activeFolder) return false;
      if (activeTag && !(s.tags ?? []).includes(activeTag)) return false;
      if (q) {
        const hay = `${s.title} ${s.folder ?? ""} ${(s.tags ?? []).join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [sources, search, activeFolder, activeTag]);

  const groups = useMemo<GroupEntry[]>(() => {
    if (activeFolder || activeTag) {
      return [{ key: "flat", name: null, folder: null, items: filtered }];
    }
    const byFolder = new Map<string, GroupEntry>();
    folders.forEach((f) =>
      byFolder.set(f.name, { key: `f-${f.id}`, name: f.name, folder: f, items: [] }),
    );
    filtered.forEach((s) => {
      const fname = s.folder || "Unfiled";
      if (!byFolder.has(fname)) {
        byFolder.set(fname, {
          key: `f-${fname}`,
          name: fname,
          folder: { name: fname, color: "var(--ink-3)" },
          items: [],
        });
      }
      byFolder.get(fname)!.items.push(s);
    });
    return [...byFolder.values()];
  }, [filtered, folders, activeFolder, activeTag]);

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
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
      <div style={{ padding: "14px 14px 10px", display: "flex", alignItems: "center", gap: 9 }}>
        <LaunchstackMark size={22} title={logoLabel} />
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em", flex: 1 }}>
          {logoLabel}
        </div>
        <button
          onClick={onOpenAdd}
          title="Add source  ⌘U"
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
          onMouseDown={(e) => {
            e.currentTarget.style.transform = "scale(0.94)";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = "scale(1)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "scale(1)";
          }}
        >
          <IconPlus size={13} />
        </button>
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
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setSearchFocus(true)}
            onBlur={() => setSearchFocus(false)}
            placeholder="Search your sources"
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

      {(activeFolder || activeTag) && (
        <div style={{ padding: "0 14px 8px" }}>
          <button
            onClick={() => {
              setActiveFolder(null);
              setActiveTag(null);
            }}
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
              {activeFolder ?? `#${activeTag}`}
            </span>
            <IconX size={11} style={{ opacity: 0.5 }} />
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", padding: "2px 8px 8px" }}>
        {groups.map((group) => {
          const isCollapsed = group.name ? !!collapsed[group.name] : false;
          const hasHeader = !!group.name;
          const isDragOver = dragOverFolder === group.name;
          return (
            <div
              key={group.key}
              style={{ position: "relative" }}
              onDragEnter={(e) => {
                if (draggingId && hasHeader && group.name) {
                  e.preventDefault();
                  setDragOverFolder(group.name);
                }
              }}
              onDragOver={(e) => {
                if (draggingId && hasHeader) e.preventDefault();
              }}
              onDragLeave={() => {
                if (dragOverFolder === group.name) setDragOverFolder(null);
              }}
              onDrop={() => {
                if (draggingId && hasHeader && group.name) {
                  onMoveToFolder?.(draggingId, group.name);
                  setDragOverFolder(null);
                  setDraggingId(null);
                }
              }}
            >
              {hasHeader && group.folder && group.name && (
                <FolderHeader
                  folder={group.folder}
                  items={group.items}
                  selected={selected}
                  count={group.items.length}
                  collapsed={isCollapsed}
                  onToggle={() => toggleCollapsed(group.name!)}
                  onRename={
                    onRenameFolder && group.folder
                      ? () => {
                          const match = folders.find(
                            (f) => f.name === group.name,
                          );
                          if (match) onRenameFolder(match);
                        }
                      : undefined
                  }
                  onSelectAll={(ids, add) => {
                    setSelected((prev) => {
                      if (add) {
                        const set = new Set(prev);
                        ids.forEach((id) => set.add(id));
                        return [...set];
                      }
                      return prev.filter((id) => !ids.includes(id));
                    });
                  }}
                  dragOver={isDragOver}
                />
              )}
              {!isCollapsed && (
                <div style={{ paddingLeft: hasHeader ? 14 : 0 }}>
                  {group.items.map((s) => (
                    <div
                      key={s.id}
                      draggable
                      onDragStart={() => setDraggingId(s.id)}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDragOverFolder(null);
                      }}
                    >
                      <SourceRow
                        source={s}
                        selected={selected.includes(s.id)}
                        toggleSelected={toggle}
                        onOpen={onOpenSource}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
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
              style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "underline" }}
            >
              Add a source
            </button>
            .
          </div>
        )}

        {!activeFolder && !activeTag && !search && onNewFolder && (
          <button
            onClick={onNewFolder}
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
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--accent)";
              e.currentTarget.style.background = "var(--line-2)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--ink-3)";
              e.currentTarget.style.background = "transparent";
            }}
          >
            <IconPlus size={11} />
            New folder
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
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = "1";
            }}
            onMouseLeave={(e) => {
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
