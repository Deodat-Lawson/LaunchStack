"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import { cn } from "~/lib/utils";

import {
    addPage,
    alignSelection,
    applyTheme,
    distributeSelection,
    duplicateSelection,
    expandAll,
    groupSelection,
    reorder,
    runLayout,
    selectAll,
    setEdgeKind,
    toggleLock,
    ungroupSelection,
} from "../model/commands";
import { THEMES } from "../model/palette";
import type { EditorStore } from "../model/store";
import { themeName, type MindmapT } from "./EditorContext";

/**
 * ⌘K command palette.
 *
 * The same actions as the menus, reachable by name. Fuzzy-ish matching: a
 * query matches when every character appears in order, which is what makes
 * "tdy" find "Tidy up".
 */

export interface Command {
    id: string;
    label: string;
    group: string;
    hint?: string;
    run: () => void;
}

export interface PaletteHost {
    onSave: () => void;
    onExport: () => void;
    onImport: () => void;
    onPublish: () => void;
    onPresent: () => void;
    onShortcuts: () => void;
    onFit: () => void;
}

/**
 * Every command, labelled in the reader's language — `t` is
 * `useTranslations("mindmap")` from the component that opens the palette.
 */
export function buildCommands(store: EditorStore, host: PaletteHost, t: MindmapT): Command[] {
    const group = {
        file: t("commands.groups.file"),
        edit: t("commands.groups.edit"),
        arrange: t("commands.groups.arrange"),
        connectors: t("commands.groups.connectors"),
        layout: t("commands.groups.layout"),
        theme: t("commands.groups.theme"),
        view: t("commands.groups.view"),
    };
    const layouts: Command[] = [
        {
            id: "layout-mindmap",
            label: t("commands.layoutMindmap"),
            run: () => runLayout(store, { kind: "mindmap" }),
        },
        {
            id: "layout-tree",
            label: t("commands.layoutTree"),
            run: () => runLayout(store, { kind: "tree", direction: "right" }),
        },
        {
            id: "layout-tree-down",
            label: t("commands.layoutTreeDown"),
            run: () => runLayout(store, { kind: "tree", direction: "down" }),
        },
        {
            id: "layout-org",
            label: t("commands.layoutOrg"),
            run: () => runLayout(store, { kind: "org" }),
        },
        {
            id: "layout-radial",
            label: t("commands.layoutRadial"),
            run: () => runLayout(store, { kind: "radial" }),
        },
        {
            id: "layout-grid",
            label: t("commands.layoutGrid"),
            run: () => runLayout(store, { kind: "grid" }),
        },
    ].map(c => ({ ...c, group: group.layout }));

    const themes: Command[] = THEMES.map(theme => ({
        id: `theme-${theme.id}`,
        group: group.theme,
        label: t("commands.theme", { name: themeName(t, theme) }),
        run: () => applyTheme(store, theme.id),
    }));

    return [
        { id: "save", group: group.file, label: t("commands.save"), hint: "⌘S", run: host.onSave },
        {
            id: "export",
            group: group.file,
            label: t("commands.export"),
            hint: "⌘E",
            run: host.onExport,
        },
        { id: "import", group: group.file, label: t("commands.import"), run: host.onImport },
        { id: "publish", group: group.file, label: t("commands.publish"), run: host.onPublish },
        { id: "present", group: group.file, label: t("commands.present"), run: host.onPresent },
        {
            id: "page-new",
            group: group.file,
            label: t("commands.newPage"),
            run: () =>
                addPage(
                    store,
                    t("pages.numbered", { number: store.getState().doc.pages.length + 1 })
                ),
        },

        {
            id: "undo",
            group: group.edit,
            label: t("commands.undo"),
            hint: "⌘Z",
            run: () => store.undo(),
        },
        {
            id: "redo",
            group: group.edit,
            label: t("commands.redo"),
            hint: "⇧⌘Z",
            run: () => store.redo(),
        },
        {
            id: "select-all",
            group: group.edit,
            label: t("commands.selectAll"),
            hint: "⌘A",
            run: () => selectAll(store),
        },
        {
            id: "duplicate",
            group: group.edit,
            label: t("commands.duplicate"),
            hint: "⌘D",
            run: () => duplicateSelection(store),
        },
        {
            id: "group",
            group: group.edit,
            label: t("commands.group"),
            hint: "⌘G",
            run: () => groupSelection(store),
        },
        {
            id: "ungroup",
            group: group.edit,
            label: t("commands.ungroup"),
            hint: "⇧⌘G",
            run: () => ungroupSelection(store),
        },
        {
            id: "lock",
            group: group.edit,
            label: t("commands.lock"),
            hint: "⌘L",
            run: () => toggleLock(store),
        },
        {
            id: "expand-all",
            group: group.edit,
            label: t("commands.expandAll"),
            run: () => expandAll(store),
        },

        {
            id: "align-left",
            group: group.arrange,
            label: t("inspector.alignLeft"),
            run: () => alignSelection(store, "left"),
        },
        {
            id: "align-center",
            group: group.arrange,
            label: t("inspector.alignCentre"),
            run: () => alignSelection(store, "hcenter"),
        },
        {
            id: "align-right",
            group: group.arrange,
            label: t("inspector.alignRight"),
            run: () => alignSelection(store, "right"),
        },
        {
            id: "align-top",
            group: group.arrange,
            label: t("inspector.alignTop"),
            run: () => alignSelection(store, "top"),
        },
        {
            id: "align-middle",
            group: group.arrange,
            label: t("inspector.alignMiddle"),
            run: () => alignSelection(store, "vcenter"),
        },
        {
            id: "align-bottom",
            group: group.arrange,
            label: t("inspector.alignBottom"),
            run: () => alignSelection(store, "bottom"),
        },
        {
            id: "distribute-h",
            group: group.arrange,
            label: t("inspector.distributeH"),
            run: () => distributeSelection(store, "h"),
        },
        {
            id: "distribute-v",
            group: group.arrange,
            label: t("inspector.distributeV"),
            run: () => distributeSelection(store, "v"),
        },
        {
            id: "front",
            group: group.arrange,
            label: t("inspector.front"),
            run: () => reorder(store, "front"),
        },
        {
            id: "back",
            group: group.arrange,
            label: t("inspector.back"),
            run: () => reorder(store, "back"),
        },

        {
            id: "edge-straight",
            group: group.connectors,
            label: t("commands.edgeStraight"),
            run: () => setEdgeKind(store, "straight"),
        },
        {
            id: "edge-elbow",
            group: group.connectors,
            label: t("commands.edgeElbow"),
            run: () => setEdgeKind(store, "elbow"),
        },
        {
            id: "edge-curved",
            group: group.connectors,
            label: t("commands.edgeCurved"),
            run: () => setEdgeKind(store, "curved"),
        },

        ...layouts,
        ...themes,

        { id: "fit", group: group.view, label: t("zoom.fit"), hint: "⌘1", run: host.onFit },
        {
            id: "shortcuts",
            group: group.view,
            label: t("topBar.shortcuts"),
            hint: "?",
            run: host.onShortcuts,
        },
    ];
}

/** Subsequence match — every query character appears in order. */
function matches(query: string, label: string): boolean {
    if (!query) return true;
    const q = query.toLowerCase();
    const l = label.toLowerCase();
    if (l.includes(q)) return true;
    let i = 0;
    for (const ch of l) {
        if (ch === q[i]) i += 1;
        if (i === q.length) return true;
    }
    return false;
}

export function CommandPalette({
    open,
    onOpenChange,
    commands,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    commands: Command[];
}) {
    const t = useTranslations("mindmap");
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(0);
    const listRef = useRef<HTMLDivElement | null>(null);

    const filtered = useMemo(
        () => commands.filter(c => matches(query, `${c.group} ${c.label}`)).slice(0, 60),
        [commands, query]
    );

    useEffect(() => {
        setQuery("");
        setActive(0);
    }, [open]);

    useEffect(() => {
        setActive(0);
    }, [query]);

    useEffect(() => {
        const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
        el?.scrollIntoView({ block: "nearest" });
    }, [active]);

    const run = (command: Command | undefined) => {
        if (!command) return;
        onOpenChange(false);
        // Defer so the dialog's close animation does not swallow focus changes
        // the command itself makes (starting a text edit, for instance).
        setTimeout(() => command.run(), 0);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[540px]">
                <DialogTitle className="sr-only">{t("topBar.commandPalette")}</DialogTitle>
                <DialogDescription className="sr-only">
                    {t("commands.description")}
                </DialogDescription>
                <div className="border-line flex items-center gap-2 border-b px-3 py-2.5">
                    <Search className="text-ink-3 size-4" />
                    <input
                        autoFocus
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => {
                            e.stopPropagation();
                            if (e.key === "ArrowDown") {
                                e.preventDefault();
                                setActive(i => Math.min(i + 1, filtered.length - 1));
                            }
                            if (e.key === "ArrowUp") {
                                e.preventDefault();
                                setActive(i => Math.max(i - 1, 0));
                            }
                            if (e.key === "Enter") {
                                e.preventDefault();
                                run(filtered[active]);
                            }
                        }}
                        placeholder={t("commands.placeholder")}
                        className="text-ink placeholder:text-ink-4 flex-1 bg-transparent text-[14px] outline-none"
                    />
                </div>
                <div ref={listRef} className="max-h-[380px] overflow-y-auto p-1.5">
                    {filtered.length === 0 && (
                        <p className="text-ink-3 px-3 py-6 text-center text-[13px]">
                            {t("commands.noMatch", { query })}
                        </p>
                    )}
                    {filtered.map((command, i) => (
                        <button
                            key={command.id}
                            type="button"
                            data-index={i}
                            onMouseEnter={() => setActive(i)}
                            onClick={() => run(command)}
                            className={cn(
                                "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors",
                                i === active ? "bg-brand-soft text-brand-ink" : "text-ink-2"
                            )}
                        >
                            <span className="text-ink-3 w-20 shrink-0 truncate font-mono text-[10px] uppercase tracking-wide">
                                {command.group}
                            </span>
                            <span className="flex-1 truncate">{command.label}</span>
                            {command.hint && (
                                <span className="text-ink-3 shrink-0 font-mono text-[11px]">
                                    {command.hint}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}
