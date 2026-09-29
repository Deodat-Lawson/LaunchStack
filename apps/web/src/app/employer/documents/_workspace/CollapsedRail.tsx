"use client";

import type { ReactNode } from "react";
import { PanelLeftOpen, Plus, Search } from "lucide-react";

import { LaunchstackMark } from "~/app/_components/LaunchstackLogo";
import { Button } from "~/components/ui/button";

import { type ShortcutHints, withShortcut } from "./ShortcutHint";

interface CollapsedRailProps {
    onExpand: () => void;
    onOpenPalette: () => void;
    onOpenAdd: () => void;
    /** The account, as its avatar alone. */
    accountSlot: ReactNode;
    /** The member's keys, shown in each control's tooltip. */
    shortcuts?: ShortcutHints;
}

/**
 * What the sidebar leaves behind when it is hidden: a strip of its app-wide
 * controls, the way VS Code's activity bar and Obsidian's ribbon stay put
 * when their panels close.
 *
 * Hiding the sidebar used to take these with it. Now that search and the
 * account live in the sidebar rather than in a tab strip, a sidebar that
 * vanished entirely would take the only way to them too — so on a wide
 * window it narrows to this instead. On a phone the sidebar is a drawer and
 * carries them itself. Opening an app is each column's "+", not this.
 */
export function CollapsedRail({
    onExpand,
    onOpenPalette,
    onOpenAdd,
    accountSlot,
    shortcuts,
}: CollapsedRailProps) {
    const iconButton =
        "text-ink-3 hover:bg-line-2 hover:text-ink dark:hover:bg-line-2 size-8 rounded-md";
    return (
        <nav
            aria-label="Workspace"
            data-testid="collapsed-rail"
            className="border-line bg-panel flex h-full w-12 shrink-0 flex-col items-center gap-1 border-r py-3"
        >
            <LaunchstackMark size={22} title="Launchstack" />
            <Button
                variant="ghost"
                size="icon"
                onClick={onExpand}
                title={withShortcut("Show sidebar", shortcuts?.rail)}
                aria-label="Show sidebar"
                className={`${iconButton} mt-2`}
            >
                <PanelLeftOpen className="size-4" />
            </Button>
            <Button
                variant="ghost"
                size="icon"
                onClick={onOpenPalette}
                title={withShortcut("Jump to anything", shortcuts?.palette)}
                aria-label="Jump to anything"
                className={iconButton}
            >
                <Search className="size-4" />
            </Button>
            <Button
                variant="ghost"
                size="icon"
                onClick={onOpenAdd}
                title={withShortcut("Add knowledge", shortcuts?.add)}
                aria-label="Add knowledge"
                className="bg-brand text-brand-fg hover:bg-brand/90 hover:text-brand-fg mt-1 size-[26px] rounded-md"
            >
                <Plus className="size-[13px]" />
            </Button>
            <div className="flex-1" />
            {accountSlot}
        </nav>
    );
}
