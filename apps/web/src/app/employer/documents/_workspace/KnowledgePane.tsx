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

import React, { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
    Lock,
    Check as IconCheck,
    Funnel as IconFilter,
    LayoutGrid as IconGrid,
    List as IconList,
    Plus as IconPlus,
    Search as IconSearch,
    X as IconX,
} from "lucide-react";
import { UNFILED_FOLDER, compareFolderPaths, displayFolderPath } from "~/lib/folders/path";

import type { ActionMenuItem } from "~/components/ui/action-menu";
import { useContextTarget } from "~/components/context-menu";
import { buildSelectionMenuItems, buildSourceMenuItems } from "./sourceContextMenu";
import { DOC_DOMAINS, SOURCE_META } from "./types";
import type { DocDomain, SourceTypeId, WorkspaceFolder, WorkspaceSource } from "./types";

type KnowledgeTranslator = ReturnType<typeof useTranslations<"sources.knowledgePane">>;

/** A blank category reads as "Unfiled" everywhere in this surface. */
function collectionOf(source: WorkspaceSource): string {
    return source.folder.trim().length > 0 ? source.folder : UNFILED_FOLDER;
}

/** A collection as this surface names it: its path, or Unfiled in the reader's words. */
function collectionLabel(t: KnowledgeTranslator, path: string): string {
    return path === UNFILED_FOLDER ? t("unfiled") : displayFolderPath(path);
}

/** Each domain's key in `sources.domains`. */
const DOMAIN_KEY = {
    Contract: "contract",
    Financial: "financial",
    Technical: "technical",
    Compliance: "compliance",
    Educational: "educational",
    HR: "hr",
    Research: "research",
    General: "general",
} as const satisfies Record<DocDomain, string>;

function domainKey(domain: DocDomain): (typeof DOMAIN_KEY)[DocDomain] {
    return DOMAIN_KEY[domain] ?? "general";
}

export interface KnowledgePaneProps {
    sources: WorkspaceSource[];
    folders: WorkspaceFolder[];
    loading?: boolean;
    selected: string[];
    setSelected: React.Dispatch<React.SetStateAction<string[]>>;
    onOpenSource: (source: WorkspaceSource) => void;
    /** Open it in a column beside the chat instead of over the workspace. */
    onOpenSourceBeside?: (source: WorkspaceSource) => void;
    onOpenAdd: (tabId?: string) => void;
    onAskAbout: (sourceIds: string[]) => void;
    onRenameSource?: (source: WorkspaceSource) => void;
    onDeleteSource?: (source: WorkspaceSource) => void;
    /** Delete several at once — the multi-selection menu's Delete. */
    onDeleteSources?: (sources: WorkspaceSource[]) => void;
    /** "Restrict access…" — opens the document's access dialog. */
    onRestrictAccess?: (source: WorkspaceSource) => void;
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
    onOpenSourceBeside,
    onOpenAdd,
    onAskAbout,
    onRenameSource,
    onDeleteSource,
    onDeleteSources,
    onRestrictAccess,
    onMoveToFolder,
}: KnowledgePaneProps) {
    const t = useTranslations("sources.knowledgePane");
    const tm = useTranslations("sources.contextMenu");
    const tr = useTranslations("sources.railCommands");
    const tTypes = useTranslations("sources.sourceTypes");
    const tc = useTranslations("common");
    const [query, setQuery] = useState("");
    const [folder, setFolder] = useState<string | null>(null);
    const [type, setType] = useState<SourceTypeId | null>(null);
    const [layout, setLayout] = useState<Layout>("grid");
    /**
     * A source's menu. Inside a multi-selection every verb acts on the whole
     * selection; otherwise on the one card or row.
     */
    const menuItemsFor = useCallback(
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
                onToggleContext: s => {
                    if (selected.includes(s.id)) {
                        setSelected(prev => prev.filter(id => id !== s.id));
                        return;
                    }
                    onAskAbout([s.id]);
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
                onRename: onRenameSource,
                onMoveToFolder,
                onCopyTitle: s => {
                    void navigator.clipboard?.writeText(s.title).catch(() => undefined);
                },
                onCopyLink: s => {
                    void navigator.clipboard
                        ?.writeText(
                            `${window.location.origin}/employer/documents?source=${encodeURIComponent(s.id)}`
                        )
                        .catch(() => undefined);
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
            onAskAbout,
            onRenameSource,
            onMoveToFolder,
            onRestrictAccess,
            onDeleteSource,
            onDeleteSources,
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
                (source.folder ?? "").toLowerCase().includes(needle) ||
                (source.searchText ?? "").toLowerCase().includes(needle)
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
                {/* Wraps in a narrow pane: the controls go under the
                    heading rather than crushing it. */}
                <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                    <div className="min-w-[min(100%,240px)] flex-1">
                        <h2
                            className="display"
                            style={{
                                fontSize: 24,
                                margin: "3px 0 0",
                                color: "var(--ink)",
                                letterSpacing: "-0.02em",
                            }}
                        >
                            {t("heading")}
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
                            <Stat>
                                {t.rich("statSources", { count: sources.length, b: statValue })}
                            </Stat>
                            <Divider />
                            <Stat>
                                {t.rich("statCollections", {
                                    count: folders.length,
                                    b: statValue,
                                })}
                            </Stat>
                            {indexing > 0 && (
                                <>
                                    <Divider />
                                    <span style={{ fontSize: 11.5, color: "oklch(0.5 0.13 55)" }}>
                                        {t("indexingCount", { count: indexing })}
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
                            <IconPlus size={13} /> {tr("addKnowledge")}
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
                            placeholder={t("searchPlaceholder")}
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
                                aria-label={t("clearSearch")}
                                style={{ color: "var(--ink-3)", display: "flex" }}
                            >
                                <IconX size={11} />
                            </button>
                        )}
                    </div>

                    <FilterMenu
                        label={t("filterCollection")}
                        allLabel={t("allCollections")}
                        value={folder}
                        options={[...counts.byFolder.entries()]
                            .sort(([a], [b]) => compareFolderPaths(a, b))
                            .map(([name, count]) => ({
                                value: name,
                                label: collectionLabel(t, name),
                                count,
                            }))}
                        onChange={setFolder}
                    />
                    <FilterMenu
                        label={t("filterType")}
                        allLabel={t("allTypes")}
                        value={type}
                        options={[...counts.byType.entries()].map(([id, count]) => ({
                            value: id,
                            label: tTypes(id),
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
                            {t("clearFilters")}
                        </button>
                    )}

                    <div style={{ flex: 1 }} />

                    {selected.length > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                                {t("selectedCount", { count: selected.length })}
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
                                {t("askAboutThese")}
                            </button>
                            <button
                                onClick={() => setSelected([])}
                                style={{ fontSize: 11.5, color: "var(--ink-3)" }}
                            >
                                {tc("actions.clear")}
                            </button>
                        </div>
                    )}
                </div>
            </header>

            <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "18px 24px 40px" }}>
                {loading && sources.length === 0 ? (
                    <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("loading")}</div>
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
                                menuItems={menuItemsFor}
                            />
                        ))}
                    </div>
                ) : (
                    <SourceTable
                        sources={filtered}
                        selected={selected}
                        onToggle={toggle}
                        onOpen={onOpenSource}
                        menuItems={menuItemsFor}
                    />
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Header bits
// ---------------------------------------------------------------------------

function Stat({ children }: { children: React.ReactNode }) {
    return <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{children}</span>;
}

/** The number in a header stat. */
function statValue(chunks: React.ReactNode) {
    return <strong style={{ color: "var(--ink-2)", fontWeight: 600 }}>{chunks}</strong>;
}

function Divider() {
    return <span style={{ color: "var(--ink-3)", opacity: 0.4, fontSize: 11 }}>·</span>;
}

function LayoutToggle({ layout, onChange }: { layout: Layout; onChange: (next: Layout) => void }) {
    const t = useTranslations("sources.knowledgePane");
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
                        aria-label={option === "grid" ? t("gridView") : t("listView")}
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
    allLabel,
    value,
    options,
    onChange,
}: {
    label: string;
    /** The option that clears this filter: "All collections". */
    allLabel: string;
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
                            label={allLabel}
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
    menuItems,
}: {
    source: WorkspaceSource;
    selected: boolean;
    onToggle: () => void;
    onOpen: () => void;
    menuItems?: (source: WorkspaceSource) => ActionMenuItem[];
}) {
    const t = useTranslations("sources.knowledgePane");
    const tTypes = useTranslations("sources.sourceTypes");
    const tDomains = useTranslations("sources.domains");
    const meta = SOURCE_META[source.type];
    const domain = DOC_DOMAINS[source.domain] ?? DOC_DOMAINS.General;
    const domainId = domainKey(source.domain);
    const ctxTarget = useContextTarget(
        menuItems
            ? {
                  kind: "source",
                  id: source.id,
                  label: t("actionsFor", { title: source.title }),
                  data: source,
                  items: () => menuItems(source),
              }
            : null
    );

    return (
        <div
            onClick={onOpen}
            role="button"
            tabIndex={0}
            data-testid={`knowledge-card-${source.id}`}
            {...ctxTarget}
            onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen();
                }
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
            {source.thumbnailUrl && (
                <div
                    style={{
                        margin: "-13px -14px 0",
                        height: 112,
                        background: "var(--panel-2)",
                        borderBottom: "1px solid var(--line)",
                        overflow: "hidden",
                    }}
                >
                    {/* Rendered by the editor on save; served by the thumbnail route. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={source.thumbnailUrl}
                        alt=""
                        loading="lazy"
                        style={{ width: "100%", height: "100%", objectFit: "contain" }}
                    />
                </div>
            )}
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
                        {tTypes(source.type)}
                        {source.added ? ` · ${source.added}` : ""}
                    </div>
                </div>
                <button
                    onClick={e => {
                        e.stopPropagation();
                        onToggle();
                    }}
                    aria-label={selected ? t("deselectSource") : t("selectSource")}
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
                    title={tDomains(`${domainId}.desc`)}
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
                    {tDomains(`${domainId}.label`)}
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
                    {collectionLabel(t, collectionOf(source))}
                </span>
                {source.restricted && (
                    <span
                        title={t("restrictedTitle")}
                        style={{
                            fontSize: 10,
                            padding: "1px 7px",
                            borderRadius: 5,
                            background: "var(--line-2)",
                            color: "var(--ink-2)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 3,
                        }}
                    >
                        <Lock size={9} />
                        {t("restricted")}
                    </span>
                )}
                {(source.pending ?? source.syncing ?? false) && (
                    <span style={{ fontSize: 10, color: "oklch(0.5 0.13 55)" }}>
                        {t("indexingTag")}
                    </span>
                )}
                {source.citability === "stale" && (
                    <span style={{ fontSize: 10, color: "var(--warn)" }}>{t("staleCitable")}</span>
                )}
                {source.citability === "none" && (
                    <span style={{ fontSize: 10, color: "var(--ink-3)" }}>{t("notCitable")}</span>
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

function SourceTableRow({
    source,
    isSelected,
    onOpen,
    menuItems,
    children,
}: {
    source: WorkspaceSource;
    isSelected: boolean;
    onOpen: (source: WorkspaceSource) => void;
    menuItems?: (source: WorkspaceSource) => ActionMenuItem[];
    children: React.ReactNode;
}) {
    const t = useTranslations("sources.knowledgePane");
    const ctxTarget = useContextTarget(
        menuItems
            ? {
                  kind: "source",
                  id: source.id,
                  label: t("actionsFor", { title: source.title }),
                  data: source,
                  items: () => menuItems(source),
              }
            : null
    );
    return (
        <tr
            data-testid={`knowledge-row-${source.id}`}
            onClick={() => onOpen(source)}
            {...ctxTarget}
            style={{
                borderTop: "1px solid var(--line)",
                cursor: "pointer",
                background: isSelected ? "var(--accent-soft)" : "transparent",
            }}
        >
            {children}
        </tr>
    );
}

function SourceTable({
    sources,
    selected,
    onToggle,
    onOpen,
    menuItems,
}: {
    sources: WorkspaceSource[];
    selected: string[];
    onToggle: (id: string) => void;
    onOpen: (source: WorkspaceSource) => void;
    menuItems?: (source: WorkspaceSource) => ActionMenuItem[];
}) {
    const t = useTranslations("sources.knowledgePane");
    const tTypes = useTranslations("sources.sourceTypes");
    const tDomains = useTranslations("sources.domains");
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
                            <Th>{t("colSource")}</Th>
                            <Th style={{ width: 120 }}>{t("colType")}</Th>
                            <Th style={{ width: 150 }}>{t("colCollection")}</Th>
                            <Th style={{ width: 120 }}>{t("colDomain")}</Th>
                            <Th style={{ width: 110 }}>{t("colAdded")}</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {sources.map(source => {
                            const meta = SOURCE_META[source.type];
                            const domain = DOC_DOMAINS[source.domain] ?? DOC_DOMAINS.General;
                            const isSelected = selected.includes(source.id);
                            return (
                                <SourceTableRow
                                    key={source.id}
                                    source={source}
                                    isSelected={isSelected}
                                    onOpen={onOpen}
                                    menuItems={menuItems}
                                >
                                    <Td>
                                        <button
                                            onClick={e => {
                                                e.stopPropagation();
                                                onToggle(source.id);
                                            }}
                                            aria-label={
                                                isSelected ? t("deselectSource") : t("selectSource")
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
                                            {source.restricted && (
                                                <Lock
                                                    size={11}
                                                    aria-label={t("restricted")}
                                                    style={{
                                                        color: "var(--ink-3)",
                                                        flexShrink: 0,
                                                    }}
                                                />
                                            )}
                                        </span>
                                    </Td>
                                    <Td muted>{tTypes(source.type)}</Td>
                                    <Td muted>{collectionLabel(t, collectionOf(source))}</Td>
                                    <Td>
                                        <span
                                            style={{
                                                fontSize: 11,
                                                color: domain.color,
                                                fontWeight: 600,
                                            }}
                                        >
                                            {tDomains(`${domainKey(source.domain)}.label`)}
                                        </span>
                                    </Td>
                                    <Td muted>{source.added || "—"}</Td>
                                </SourceTableRow>
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
    const t = useTranslations("sources.knowledgePane");
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
            <h3 className="display" style={{ fontSize: 19, margin: 0, color: "var(--ink)" }}>
                {filtersActive ? t("emptyFilteredTitle") : t("emptyTitle")}
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
                {filtersActive ? t("emptyFilteredBody") : t("emptyBody")}
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
                    {t("clearFilters")}
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
                    <IconPlus size={13} /> {t("addFirst")}
                </button>
            )}
        </div>
    );
}
