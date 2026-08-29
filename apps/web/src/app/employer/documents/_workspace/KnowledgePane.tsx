"use client";

/**
 * Knowledge — the full-surface view of everything the workspace can reason over.
 *
 * The rail on the left is a picker: it exists to scope a question. This is the
 * opposite job — browsing, auditing, and filling gaps in the corpus. Sources
 * are not a separate concept from knowledge here; a source *is* how knowledge
 * gets in, so uploads, connectors, and indexed documents share one screen and
 * one visual language.
 */

import React, { useMemo, useState } from "react";

import { IconCheck, IconFilter, IconGrid, IconList, IconPlus, IconSearch, IconX } from "./icons";
import { ContextMenu } from "./ContextMenu";
import { buildSourceMenuItems } from "./sourceContextMenu";
import { DOC_DOMAINS, SOURCE_META } from "./types";
import type { SourceTypeId, WorkspaceFolder, WorkspaceSource } from "./types";

/** A blank category reads as "Unfiled" everywhere in this surface. */
function collectionOf(source: WorkspaceSource): string {
    return source.folder.trim().length > 0 ? source.folder : "Unfiled";
}

export interface KnowledgePaneProps {
    sources: WorkspaceSource[];
    folders: WorkspaceFolder[];
    loading?: boolean;
    selected: string[];
    setSelected: React.Dispatch<React.SetStateAction<string[]>>;
    onOpenSource: (source: WorkspaceSource) => void;
    onOpenAdd: (tabId?: string) => void;
    onAskAbout: (sourceIds: string[]) => void;
    onRenameSource?: (source: WorkspaceSource) => void;
    onDeleteSource?: (source: WorkspaceSource) => void;
    onMoveToFolder?: (sourceId: string, folderName: string) => void;
}

type Layout = "grid" | "list";

export function KnowledgePane({
    sources,
    folders,
    loading = false,
    selected,
    setSelected,
    onOpenSource,
    onOpenAdd,
    onAskAbout,
    onRenameSource,
    onDeleteSource,
    onMoveToFolder,
}: KnowledgePaneProps) {
    const [query, setQuery] = useState("");
    const [folder, setFolder] = useState<string | null>(null);
    const [type, setType] = useState<SourceTypeId | null>(null);
    const [layout, setLayout] = useState<Layout>("grid");
    const [menu, setMenu] = useState<{
        x: number;
        y: number;
        source: WorkspaceSource;
    } | null>(null);

    const openSourceMenu = (
        source: WorkspaceSource,
        point: { clientX: number; clientY: number }
    ) => {
        setMenu({ source, x: point.clientX, y: point.clientY });
    };

    const menuItems = useMemo(
        () =>
            menu
                ? buildSourceMenuItems(menu.source, folders, selected, {
                      onOpen: onOpenSource,
                      onToggleContext: source => {
                          if (selected.includes(source.id)) {
                              setSelected(prev => prev.filter(id => id !== source.id));
                              return;
                          }
                          onAskAbout([source.id]);
                      },
                      onRename: onRenameSource,
                      onMoveToFolder,
                      onCopyTitle: source => {
                          void navigator.clipboard?.writeText(source.title).catch(() => undefined);
                      },
                      onDelete: onDeleteSource,
                  })
                : [],
        [
            menu,
            folders,
            selected,
            onOpenSource,
            onAskAbout,
            onRenameSource,
            onMoveToFolder,
            onDeleteSource,
            setSelected,
        ]
    );

    const counts = useMemo(() => {
        const byType = new Map<SourceTypeId, number>();
        const byFolder = new Map<string, number>();
        for (const source of sources) {
            byType.set(source.type, (byType.get(source.type) ?? 0) + 1);
            const name = collectionOf(source);
            byFolder.set(name, (byFolder.get(name) ?? 0) + 1);
        }
        return { byType, byFolder };
    }, [sources]);

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return sources.filter(source => {
            if (folder && collectionOf(source) !== folder) return false;
            if (type && source.type !== type) return false;
            if (!needle) return true;
            return (
                source.title.toLowerCase().includes(needle) ||
                source.tags.some(tag => tag.toLowerCase().includes(needle)) ||
                (source.folder ?? "").toLowerCase().includes(needle)
            );
        });
    }, [sources, query, folder, type]);

    const indexing = sources.filter(s => s.pending ?? s.syncing).length;
    const filtersActive = folder !== null || type !== null || query.trim().length > 0;

    const toggle = (id: string) =>
        setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
                minHeight: 0,
                background: "var(--bg)",
            }}
        >
            <header
                style={{
                    padding: "18px 24px 14px",
                    borderBottom: "1px solid var(--line)",
                    background: "var(--panel)",
                    flexShrink: 0,
                }}
            >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                            className="mono"
                            style={{
                                fontSize: 10,
                                fontWeight: 700,
                                letterSpacing: "0.1em",
                                textTransform: "uppercase",
                                color: "var(--ink-3)",
                            }}
                        >
                            Knowledge
                        </div>
                        <h2
                            className="serif"
                            style={{
                                fontSize: 24,
                                margin: "3px 0 0",
                                color: "var(--ink)",
                                letterSpacing: "-0.02em",
                            }}
                        >
                            Everything this workspace can reason over
                        </h2>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                marginTop: 7,
                                flexWrap: "wrap",
                            }}
                        >
                            <Stat
                                value={sources.length}
                                label={sources.length === 1 ? "source" : "sources"}
                            />
                            <Divider />
                            <Stat
                                value={folders.length}
                                label={folders.length === 1 ? "collection" : "collections"}
                            />
                            {indexing > 0 && (
                                <>
                                    <Divider />
                                    <span style={{ fontSize: 11.5, color: "oklch(0.5 0.13 55)" }}>
                                        {indexing} indexing…
                                    </span>
                                </>
                            )}
                        </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        <LayoutToggle layout={layout} onChange={setLayout} />
                        <button
                            onClick={() => onOpenAdd()}
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "8px 14px",
                                borderRadius: 8,
                                background: "var(--accent)",
                                color: "white",
                                fontSize: 12.5,
                                fontWeight: 600,
                                boxShadow: "0 2px 10px var(--accent-glow)",
                                whiteSpace: "nowrap",
                            }}
                        >
                            <IconPlus size={13} /> Add knowledge
                        </button>
                    </div>
                </div>

                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginTop: 14,
                        flexWrap: "wrap",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                            padding: "6px 10px",
                            border: "1px solid var(--line)",
                            borderRadius: 8,
                            background: "var(--panel-2)",
                            minWidth: 240,
                            flex: "1 1 240px",
                            maxWidth: 380,
                        }}
                    >
                        <IconSearch size={13} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
                        <input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search titles, tags, collections"
                            style={{
                                flex: 1,
                                border: "none",
                                outline: "none",
                                background: "transparent",
                                color: "var(--ink)",
                                fontSize: 12.5,
                                minWidth: 0,
                            }}
                        />
                        {query && (
                            <button
                                onClick={() => setQuery("")}
                                aria-label="Clear search"
                                style={{ color: "var(--ink-3)", display: "flex" }}
                            >
                                <IconX size={11} />
                            </button>
                        )}
                    </div>

                    <FilterMenu
                        label="Collection"
                        value={folder}
                        options={[...counts.byFolder.entries()].map(([name, count]) => ({
                            value: name,
                            label: name,
                            count,
                        }))}
                        onChange={setFolder}
                    />
                    <FilterMenu
                        label="Type"
                        value={type}
                        options={[...counts.byType.entries()].map(([id, count]) => ({
                            value: id,
                            label: SOURCE_META[id].label,
                            count,
                        }))}
                        onChange={value => setType(value as SourceTypeId | null)}
                    />

                    {filtersActive && (
                        <button
                            onClick={() => {
                                setQuery("");
                                setFolder(null);
                                setType(null);
                            }}
                            style={{ fontSize: 11.5, color: "var(--ink-3)", padding: "5px 4px" }}
                        >
                            Clear filters
                        </button>
                    )}

                    <div style={{ flex: 1 }} />

                    {selected.length > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                                {selected.length} selected
                            </span>
                            <button
                                onClick={() => onAskAbout(selected)}
                                style={{
                                    padding: "6px 12px",
                                    borderRadius: 7,
                                    border: "1px solid var(--accent)",
                                    color: "var(--accent-ink)",
                                    background: "var(--accent-soft)",
                                    fontSize: 12,
                                    fontWeight: 600,
                                }}
                            >
                                Ask about these
                            </button>
                            <button
                                onClick={() => setSelected([])}
                                style={{ fontSize: 11.5, color: "var(--ink-3)" }}
                            >
                                Clear
                            </button>
                        </div>
                    )}
                </div>
            </header>

            <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "18px 24px 40px" }}>
                {loading && sources.length === 0 ? (
                    <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
                        Loading your knowledge…
                    </div>
                ) : filtered.length === 0 ? (
                    <EmptyState
                        filtersActive={filtersActive}
                        onClear={() => {
                            setQuery("");
                            setFolder(null);
                            setType(null);
                        }}
                        onOpenAdd={onOpenAdd}
                    />
                ) : layout === "grid" ? (
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(248px, 1fr))",
                            gap: 12,
                        }}
                    >
                        {filtered.map(source => (
                            <SourceCard
                                key={source.id}
                                source={source}
                                selected={selected.includes(source.id)}
                                onToggle={() => toggle(source.id)}
                                onOpen={() => onOpenSource(source)}
                                onOpenMenu={openSourceMenu}
                            />
                        ))}
                    </div>
                ) : (
                    <SourceTable
                        sources={filtered}
                        selected={selected}
                        onToggle={toggle}
                        onOpen={onOpenSource}
                        onOpenMenu={openSourceMenu}
                    />
                )}
            </div>
            {menu && (
                <ContextMenu
                    open
                    x={menu.x}
                    y={menu.y}
                    items={menuItems}
                    ariaLabel={`Actions for ${menu.source.title}`}
                    onClose={() => setMenu(null)}
                />
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Header bits
// ---------------------------------------------------------------------------

function Stat({ value, label }: { value: number; label: string }) {
    return (
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
            <strong style={{ color: "var(--ink-2)", fontWeight: 600 }}>{value}</strong> {label}
        </span>
    );
}

function Divider() {
    return <span style={{ color: "var(--ink-3)", opacity: 0.4, fontSize: 11 }}>·</span>;
}

function LayoutToggle({ layout, onChange }: { layout: Layout; onChange: (next: Layout) => void }) {
    return (
        <div
            style={{
                display: "inline-flex",
                border: "1px solid var(--line)",
                borderRadius: 8,
                overflow: "hidden",
                background: "var(--panel-2)",
            }}
        >
            {(["grid", "list"] as const).map(option => {
                const active = layout === option;
                const Icon = option === "grid" ? IconGrid : IconList;
                return (
                    <button
                        key={option}
                        onClick={() => onChange(option)}
                        aria-label={`${option} view`}
                        aria-pressed={active}
                        style={{
                            padding: "6px 9px",
                            background: active ? "var(--accent-soft)" : "transparent",
                            color: active ? "var(--accent-ink)" : "var(--ink-3)",
                            display: "flex",
                        }}
                    >
                        <Icon size={13} />
                    </button>
                );
            })}
        </div>
    );
}

function FilterMenu({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string | null;
    options: Array<{ value: string; label: string; count: number }>;
    onChange: (next: string | null) => void;
}) {
    const [open, setOpen] = useState(false);
    const active = value !== null;

    return (
        <div style={{ position: "relative" }}>
            <button
                onClick={() => setOpen(v => !v)}
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 11px",
                    borderRadius: 8,
                    border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
                    background: active ? "var(--accent-soft)" : "var(--panel-2)",
                    color: active ? "var(--accent-ink)" : "var(--ink-2)",
                    fontSize: 12,
                    fontWeight: active ? 600 : 500,
                    whiteSpace: "nowrap",
                }}
            >
                <IconFilter size={11} />
                {active ? (options.find(o => o.value === value)?.label ?? value) : label}
            </button>

            {open && (
                <>
                    <div
                        onClick={() => setOpen(false)}
                        style={{ position: "fixed", inset: 0, zIndex: 20 }}
                    />
                    <div
                        style={{
                            position: "absolute",
                            top: "calc(100% + 5px)",
                            left: 0,
                            zIndex: 21,
                            minWidth: 200,
                            maxHeight: 300,
                            overflowY: "auto",
                            background: "var(--panel)",
                            border: "1px solid var(--line)",
                            borderRadius: 9,
                            boxShadow: "0 12px 32px rgba(0,0,0,0.14)",
                            padding: 5,
                        }}
                    >
                        <MenuItem
                            label={`All ${label.toLowerCase()}s`}
                            selected={value === null}
                            onClick={() => {
                                onChange(null);
                                setOpen(false);
                            }}
                        />
                        {options.map(option => (
                            <MenuItem
                                key={option.value}
                                label={option.label}
                                count={option.count}
                                selected={value === option.value}
                                onClick={() => {
                                    onChange(value === option.value ? null : option.value);
                                    setOpen(false);
                                }}
                            />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

function MenuItem({
    label,
    count,
    selected,
    onClick,
}: {
    label: string;
    count?: number;
    selected: boolean;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                borderRadius: 6,
                fontSize: 12.5,
                color: selected ? "var(--accent-ink)" : "var(--ink-2)",
                background: selected ? "var(--accent-soft)" : "transparent",
                textAlign: "left",
            }}
            onMouseEnter={e => {
                if (!selected) e.currentTarget.style.background = "var(--line-2)";
            }}
            onMouseLeave={e => {
                if (!selected) e.currentTarget.style.background = "transparent";
            }}
        >
            <span style={{ width: 12, display: "flex" }}>
                {selected && <IconCheck size={11} />}
            </span>
            <span
                style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                }}
            >
                {label}
            </span>
            {count !== undefined && (
                <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
                    {count}
                </span>
            )}
        </button>
    );
}

// ---------------------------------------------------------------------------
// Source presentation
// ---------------------------------------------------------------------------

function SourceCard({
    source,
    selected,
    onToggle,
    onOpen,
    onOpenMenu,
}: {
    source: WorkspaceSource;
    selected: boolean;
    onToggle: () => void;
    onOpen: () => void;
    onOpenMenu?: (source: WorkspaceSource, point: { clientX: number; clientY: number }) => void;
}) {
    const meta = SOURCE_META[source.type];
    const domain = DOC_DOMAINS[source.domain] ?? DOC_DOMAINS.General;

    return (
        <div
            onClick={onOpen}
            onContextMenu={e => {
                if (!onOpenMenu) return;
                e.preventDefault();
                e.stopPropagation();
                onOpenMenu(source, { clientX: e.clientX, clientY: e.clientY });
            }}
            role="button"
            tabIndex={0}
            data-testid={`knowledge-card-${source.id}`}
            onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen();
                    return;
                }
                if (!onOpenMenu) return;
                if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                onOpenMenu(source, { clientX: rect.left + 16, clientY: rect.bottom });
            }}
            style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                padding: "13px 14px",
                border: `1px solid ${selected ? "var(--accent)" : "var(--line)"}`,
                borderRadius: 11,
                background: selected ? "var(--accent-soft)" : "var(--panel)",
                cursor: "pointer",
                transition: "border-color 120ms, box-shadow 120ms, transform 120ms",
            }}
            onMouseEnter={e => {
                e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.07)";
                e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={e => {
                e.currentTarget.style.boxShadow = "none";
                e.currentTarget.style.transform = "none";
            }}
        >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span
                    style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "var(--panel-2)",
                        border: "1px solid var(--line)",
                        color: meta.color,
                        flexShrink: 0,
                    }}
                >
                    <meta.Icon size={15} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                        style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: "var(--ink)",
                            lineHeight: 1.35,
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                        }}
                        title={source.title}
                    >
                        {source.title}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 3 }}>
                        {meta.label}
                        {source.added ? ` · ${source.added}` : ""}
                    </div>
                </div>
                <button
                    onClick={e => {
                        e.stopPropagation();
                        onToggle();
                    }}
                    aria-label={selected ? "Deselect source" : "Select source"}
                    style={{
                        width: 17,
                        height: 17,
                        borderRadius: 4,
                        border: `1.5px solid ${selected ? "var(--accent)" : "var(--ink-4, var(--ink-3))"}`,
                        background: selected ? "var(--accent)" : "var(--panel)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                    }}
                >
                    {selected && <IconCheck size={11} style={{ color: "white" }} />}
                </button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span
                    title={domain.desc}
                    style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: "1px 7px",
                        borderRadius: 5,
                        color: domain.color,
                        border: `1px solid ${domain.color}`,
                        opacity: 0.9,
                    }}
                >
                    {source.domain}
                </span>
                <span
                    style={{
                        fontSize: 10,
                        padding: "1px 7px",
                        borderRadius: 5,
                        background: "var(--line-2)",
                        color: "var(--ink-3)",
                    }}
                >
                    {collectionOf(source)}
                </span>
                {(source.pending ?? source.syncing ?? false) && (
                    <span style={{ fontSize: 10, color: "oklch(0.5 0.13 55)" }}>indexing…</span>
                )}
            </div>

            {source.tags.length > 0 && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {source.tags.slice(0, 4).map(tag => (
                        <span
                            key={tag}
                            className="mono"
                            style={{ fontSize: 10, color: "var(--ink-3)" }}
                        >
                            #{tag}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

function SourceTable({
    sources,
    selected,
    onToggle,
    onOpen,
    onOpenMenu,
}: {
    sources: WorkspaceSource[];
    selected: string[];
    onToggle: (id: string) => void;
    onOpen: (source: WorkspaceSource) => void;
    onOpenMenu?: (source: WorkspaceSource, point: { clientX: number; clientY: number }) => void;
}) {
    return (
        <div
            style={{
                border: "1px solid var(--line)",
                borderRadius: 11,
                overflow: "hidden",
                background: "var(--panel)",
            }}
        >
            <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                    <thead>
                        <tr style={{ background: "var(--line-2)" }}>
                            <Th style={{ width: 34 }} />
                            <Th>Source</Th>
                            <Th style={{ width: 120 }}>Type</Th>
                            <Th style={{ width: 150 }}>Collection</Th>
                            <Th style={{ width: 120 }}>Domain</Th>
                            <Th style={{ width: 110 }}>Added</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {sources.map(source => {
                            const meta = SOURCE_META[source.type];
                            const domain = DOC_DOMAINS[source.domain] ?? DOC_DOMAINS.General;
                            const isSelected = selected.includes(source.id);
                            return (
                                <tr
                                    key={source.id}
                                    data-testid={`knowledge-row-${source.id}`}
                                    onClick={() => onOpen(source)}
                                    onContextMenu={e => {
                                        if (!onOpenMenu) return;
                                        e.preventDefault();
                                        e.stopPropagation();
                                        onOpenMenu(source, {
                                            clientX: e.clientX,
                                            clientY: e.clientY,
                                        });
                                    }}
                                    style={{
                                        borderTop: "1px solid var(--line)",
                                        cursor: "pointer",
                                        background: isSelected
                                            ? "var(--accent-soft)"
                                            : "transparent",
                                    }}
                                >
                                    <Td>
                                        <button
                                            onClick={e => {
                                                e.stopPropagation();
                                                onToggle(source.id);
                                            }}
                                            aria-label={
                                                isSelected ? "Deselect source" : "Select source"
                                            }
                                            style={{
                                                width: 15,
                                                height: 15,
                                                borderRadius: 4,
                                                border: `1.5px solid ${isSelected ? "var(--accent)" : "var(--ink-4, var(--ink-3))"}`,
                                                background: isSelected
                                                    ? "var(--accent)"
                                                    : "var(--panel)",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                            }}
                                        >
                                            {isSelected && (
                                                <IconCheck size={10} style={{ color: "white" }} />
                                            )}
                                        </button>
                                    </Td>
                                    <Td>
                                        <span
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 8,
                                            }}
                                        >
                                            <meta.Icon
                                                size={13}
                                                style={{ color: meta.color, flexShrink: 0 }}
                                            />
                                            <span
                                                style={{
                                                    fontSize: 12.5,
                                                    fontWeight: 500,
                                                    color: "var(--ink)",
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                    whiteSpace: "nowrap",
                                                }}
                                            >
                                                {source.title}
                                            </span>
                                        </span>
                                    </Td>
                                    <Td muted>{meta.label}</Td>
                                    <Td muted>{collectionOf(source)}</Td>
                                    <Td>
                                        <span
                                            style={{
                                                fontSize: 11,
                                                color: domain.color,
                                                fontWeight: 600,
                                            }}
                                        >
                                            {source.domain}
                                        </span>
                                    </Td>
                                    <Td muted>{source.added || "—"}</Td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function Th({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
    return (
        <th
            className="mono"
            style={{
                textAlign: "left",
                padding: "8px 12px",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--ink-3)",
                ...style,
            }}
        >
            {children}
        </th>
    );
}

function Td({ children, muted }: { children?: React.ReactNode; muted?: boolean }) {
    return (
        <td
            style={{
                padding: "9px 12px",
                fontSize: 12,
                color: muted ? "var(--ink-3)" : "var(--ink-2)",
                verticalAlign: "middle",
            }}
        >
            {children}
        </td>
    );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({
    filtersActive,
    onClear,
    onOpenAdd,
}: {
    filtersActive: boolean;
    onClear: () => void;
    onOpenAdd: (tabId?: string) => void;
}) {
    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 12,
                padding: "48px 24px",
                textAlign: "center",
            }}
        >
            <h3 className="serif" style={{ fontSize: 19, margin: 0, color: "var(--ink)" }}>
                {filtersActive ? "Nothing matches those filters" : "No knowledge yet"}
            </h3>
            <p
                style={{
                    margin: 0,
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: "var(--ink-3)",
                    maxWidth: 420,
                }}
            >
                {filtersActive
                    ? "Widen the search, or clear the filters to see the whole corpus."
                    : "Upload documents, paste notes, or connect a tool. Everything you add here is what the agents can cite in a meeting."}
            </p>
            {filtersActive ? (
                <button
                    onClick={onClear}
                    style={{
                        padding: "8px 14px",
                        borderRadius: 8,
                        border: "1px solid var(--line)",
                        background: "var(--panel-2)",
                        color: "var(--ink-2)",
                        fontSize: 12.5,
                        fontWeight: 600,
                    }}
                >
                    Clear filters
                </button>
            ) : (
                <button
                    onClick={() => onOpenAdd()}
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "9px 16px",
                        borderRadius: 8,
                        background: "var(--accent)",
                        color: "white",
                        fontSize: 13,
                        fontWeight: 600,
                        boxShadow: "0 2px 10px var(--accent-glow)",
                    }}
                >
                    <IconPlus size={13} /> Add your first source
                </button>
            )}
        </div>
    );
}
