"use client";

import React from "react";
import { Check, MoonStar, Sun } from "lucide-react";

import { cn } from "~/lib/utils";

import {
    counterpartTheme,
    swatchFor,
    THEME_BY_ID,
    THEMES,
    themeMode,
    type DocTheme,
    type ThemeMode,
} from "../model/palette";
import { useAppThemeMode } from "./useAppThemeMode";

/**
 * Document theme picker.
 *
 * Each tile is a miniature of the board it will produce — the theme's own
 * paper, three of its node colours at the fill and stroke they will actually
 * get, and a connector in its edge colour. Name-plus-three-dots told you a
 * theme existed but not what it would do, which is why five near-identical
 * pale themes read as placeholders.
 *
 * Light and dark are separated because that is the choice being made. The
 * board's paper is document data: picking Midnight makes it dark for everyone
 * who opens the file, not just for the person who is in dark mode right now.
 */

export interface ThemePickerProps {
    /** Currently applied theme id, from `doc.settings.paletteId`. */
    activeId: string | null | undefined;
    onPick: (themeId: string) => void;
}

export function ThemePicker({ activeId, onPick }: ThemePickerProps) {
    const groups: { mode: ThemeMode; label: string; themes: DocTheme[] }[] = [
        { mode: "light", label: "Light", themes: THEMES.filter(t => t.mode === "light") },
        { mode: "dark", label: "Dark", themes: THEMES.filter(t => t.mode === "dark") },
    ];

    return (
        <div className="flex flex-col gap-3">
            <MatchAppThemeHint activeId={activeId} onPick={onPick} />
            {groups.map(group => (
                <div key={group.mode}>
                    <p className="text-ink-3 mb-1.5 font-mono text-[10px] uppercase tracking-[0.08em]">
                        {group.label}
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                        {group.themes.map(theme => (
                            <ThemeTile
                                key={theme.id}
                                theme={theme}
                                active={theme.id === activeId}
                                onPick={() => onPick(theme.id)}
                            />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

function ThemeTile({
    theme,
    active,
    onPick,
}: {
    theme: DocTheme;
    active: boolean;
    onPick: () => void;
}) {
    const swatches = theme.cycle.slice(0, 3).map(id => swatchFor(id, theme.mode));

    return (
        <button
            type="button"
            onClick={onPick}
            aria-pressed={active}
            title={`${theme.name} — ${theme.mode} board`}
            className={cn(
                "group flex flex-col gap-1 rounded-md border p-1 text-left transition-colors",
                active
                    ? "border-brand ring-brand/30 ring-1"
                    : "border-line hover:border-ink-4 hover:bg-panel-2"
            )}
        >
            <span
                className="relative flex h-9 w-full items-center justify-center gap-1 overflow-hidden rounded-[4px]"
                style={{ background: theme.background }}
            >
                {/* A connector behind the nodes, exactly as the canvas paints it. */}
                <span
                    aria-hidden
                    className="absolute left-2 right-2 top-1/2 h-px"
                    style={{ background: theme.edgeStroke }}
                />
                {swatches.map((sw, i) => (
                    <span
                        key={`${theme.id}-${i}`}
                        className="relative h-3.5 w-5 rounded-[3px]"
                        style={{
                            background: i === 0 ? sw.stroke : sw.fill,
                            border: `1px solid ${sw.stroke}`,
                        }}
                    />
                ))}
            </span>
            <span className="flex items-center gap-1 px-0.5">
                <span
                    className={cn(
                        "truncate text-[11px]",
                        active ? "text-brand-ink font-medium" : "text-ink-2"
                    )}
                >
                    {theme.name}
                </span>
                {active && <Check className="text-brand ml-auto size-3 shrink-0" />}
            </span>
        </button>
    );
}

/**
 * Offered only when the board disagrees with the app around it.
 *
 * New documents are already seeded to match, so this is for the ones that
 * existed before — a white board in a dark app is the single most jarring
 * thing about opening an old file, and switching it should not require
 * knowing that Midnight is the dark twin of Launchstack.
 */
function MatchAppThemeHint({ activeId, onPick }: ThemePickerProps) {
    const appMode = useAppThemeMode();
    if (!activeId) return null;
    const boardMode = themeMode(activeId);
    if (boardMode === appMode) return null;

    const target = counterpartTheme(activeId);
    const targetTheme = THEME_BY_ID[target];
    if (!targetTheme || targetTheme.mode !== appMode) return null;

    const Icon = appMode === "dark" ? MoonStar : Sun;
    return (
        <button
            type="button"
            onClick={() => onPick(target)}
            className="border-line hover:border-brand hover:bg-brand-soft text-ink-2 flex items-center gap-2 rounded-md border border-dashed px-2 py-1.5 text-left text-[11px] leading-snug transition-colors"
        >
            <Icon className="text-ink-3 size-3.5 shrink-0" />
            <span>
                This board is {boardMode}. Switch it to{" "}
                <span className="text-ink font-medium">{targetTheme.name}</span> to match the app.
            </span>
        </button>
    );
}
