"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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

export function buildCommands(store: EditorStore, host: PaletteHost): Command[] {
    const layouts: Command[] = [
        {
            id: "layout-mindmap",
            label: "Auto-layout: mindmap",
            run: () => runLayout(store, { kind: "mindmap" }),
        },
        {
            id: "layout-tree",
            label: "Auto-layout: tree (left to right)",
            run: () => runLayout(store, { kind: "tree", direction: "right" }),
        },
        {
            id: "layout-tree-down",
            label: "Auto-layout: tree (top down)",
            run: () => runLayout(store, { kind: "tree", direction: "down" }),
        },
        {
            id: "layout-org",
            label: "Auto-layout: org chart",
            run: () => runLayout(store, { kind: "org" }),
        },
        {
            id: "layout-radial",
            label: "Auto-layout: radial",
            run: () => runLayout(store, { kind: "radial" }),
        },
        {
            id: "layout-grid",
            label: "Auto-layout: grid",
            run: () => runLayout(store, { kind: "grid" }),
        },
    ].map(c => ({ ...c, group: "Layout" }));

    const themes: Command[] = THEMES.map(theme => ({
        id: `theme-${theme.id}`,
        group: "Theme",
        label: `Theme: ${theme.name}`,
        run: () => applyTheme(store, theme.id),
    }));

    return [
        { id: "save", group: "File", label: "Save now", hint: "⌘S", run: host.onSave },
        { id: "export", group: "File", label: "Export…", hint: "⌘E", run: host.onExport },
        { id: "import", group: "File", label: "Import…", run: host.onImport },
        { id: "publish", group: "File", label: "Add to sources", run: host.onPublish },
        { id: "present", group: "File", label: "Present", run: host.onPresent },
        { id: "page-new", group: "File", label: "New page", run: () => addPage(store) },

        { id: "undo", group: "Edit", label: "Undo", hint: "⌘Z", run: () => store.undo() },
        { id: "redo", group: "Edit", label: "Redo", hint: "⇧⌘Z", run: () => store.redo() },
        {
            id: "select-all",
            group: "Edit",
            label: "Select all",
            hint: "⌘A",
            run: () => selectAll(store),
        },
        {
            id: "duplicate",
            group: "Edit",
            label: "Duplicate selection",
            hint: "⌘D",
            run: () => duplicateSelection(store),
        },
        {
            id: "group",
            group: "Edit",
            label: "Group",
            hint: "⌘G",
            run: () => groupSelection(store),
        },
        {
            id: "ungroup",
            group: "Edit",
            label: "Ungroup",
            hint: "⇧⌘G",
            run: () => ungroupSelection(store),
        },
        {
            id: "lock",
            group: "Edit",
            label: "Lock / unlock",
            hint: "⌘L",
            run: () => toggleLock(store),
        },
        {
            id: "expand-all",
            group: "Edit",
            label: "Expand all branches",
            run: () => expandAll(store),
        },

        {
            id: "align-left",
            group: "Arrange",
            label: "Align left",
            run: () => alignSelection(store, "left"),
        },
        {
            id: "align-center",
            group: "Arrange",
            label: "Align centre",
            run: () => alignSelection(store, "hcenter"),
        },
        {
            id: "align-right",
            group: "Arrange",
            label: "Align right",
            run: () => alignSelection(store, "right"),
        },
        {
            id: "align-top",
            group: "Arrange",
            label: "Align top",
            run: () => alignSelection(store, "top"),
        },
        {
            id: "align-middle",
            group: "Arrange",
            label: "Align middle",
            run: () => alignSelection(store, "vcenter"),
        },
        {
            id: "align-bottom",
            group: "Arrange",
            label: "Align bottom",
            run: () => alignSelection(store, "bottom"),
        },
        {
            id: "distribute-h",
            group: "Arrange",
            label: "Distribute horizontally",
            run: () => distributeSelection(store, "h"),
        },
        {
            id: "distribute-v",
            group: "Arrange",
            label: "Distribute vertically",
            run: () => distributeSelection(store, "v"),
        },
        {
            id: "front",
            group: "Arrange",
            label: "Bring to front",
            run: () => reorder(store, "front"),
        },
        { id: "back", group: "Arrange", label: "Send to back", run: () => reorder(store, "back") },

        {
            id: "edge-straight",
            group: "Connectors",
            label: "Connector style: straight",
            run: () => setEdgeKind(store, "straight"),
        },
        {
            id: "edge-elbow",
            group: "Connectors",
            label: "Connector style: elbow",
            run: () => setEdgeKind(store, "elbow"),
        },
        {
            id: "edge-curved",
            group: "Connectors",
            label: "Connector style: curved",
            run: () => setEdgeKind(store, "curved"),
        },

        ...layouts,
        ...themes,

        { id: "fit", group: "View", label: "Fit to screen", hint: "⌘1", run: host.onFit },
        {
            id: "shortcuts",
            group: "View",
            label: "Keyboard shortcuts",
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
                <DialogTitle className="sr-only">Command palette</DialogTitle>
                <DialogDescription className="sr-only">
                    Search for an action by name
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
                        placeholder="Type a command…"
                        className="text-ink placeholder:text-ink-4 flex-1 bg-transparent text-[14px] outline-none"
                    />
                </div>
                <div ref={listRef} className="max-h-[380px] overflow-y-auto p-1.5">
                    {filtered.length === 0 && (
                        <p className="text-ink-3 px-3 py-6 text-center text-[13px]">
                            No commands match “{query}”.
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
