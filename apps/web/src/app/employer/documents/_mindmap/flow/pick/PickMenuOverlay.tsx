"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "~/components/ui/popover";

import { activePage, nodeById } from "../../model/doc";
import { nodeCenter } from "../../model/geometry";
import type { EditorState } from "../../model/store";
import { useCommittedDoc, useEditor, useStore } from "../../ui/EditorContext";
import { boardMode, KINDS } from "../../model/flowchart/look";
import { closeMenu, menuPicks, pick, setActive, stagePointOf } from "./menu";
import { menuSide, type PickId, type Side } from "./place";
import { Thumb } from "./Thumb";
import { usePickMenu } from "./usePickMenu";

/** Tiles per row. Arrow keys move on this grid. */
const COLS = 3;
/** A tile (the h-[72px] w-[92px] below), and the menu around two rows of them. */
const TILE = { w: 92, h: 72 };
const MENU = { w: COLS * TILE.w + 2 * 4 + 12 + 2, h: 28 + 2 * TILE.h + 4 + 12 + 2 };

/** Clear of the ghost box at the point: half the largest kind, either way. */
const HALF_W = Math.max(...Object.values(KINDS).map(k => k.size.w)) / 2;
const HALF_H = Math.max(...Object.values(KINDS).map(k => k.size.h)) / 2;
const GAP = 14;

const selectViewport = (s: EditorState) => s.viewport;

/**
 * The "What goes here?" menu: what goes at the end of an arrow let go in
 * space, or at a double-click on empty canvas. Six tiles, each the real shape in its real colour
 * and its name; 1–6 pick straight away, arrows and Enter pick the
 * highlighted one, Esc or a click elsewhere closes it and leaves nothing.
 *
 * Chrome, so it is painted in the app's theme like the selection toolbar;
 * the thumbnails are in the board's colours, because that is what a pick
 * makes.
 */
export function PickMenuOverlay({ canvasSize }: { canvasSize: { w: number; h: number } }) {
    const t = useTranslations("mindmap.flow.pick");
    const store = useStore();
    const menu = usePickMenu(store);
    const viewport = useEditor(selectViewport);
    const doc = useCommittedDoc();
    const tiles = useRef<(HTMLButtonElement | null)[]>([]);
    // The menu is kept on the stage: shifted to fit, it never rides up over
    // the top bar or the tool rail.
    const [stage, setStage] = useState<Element | null>(null);
    const anchorRef = useCallback((el: HTMLDivElement | null) => {
        if (el) setStage(el.closest("[data-mindmap-stage]"));
    }, []);

    const page = activePage(doc);
    const source = menu?.sourceId ? (nodeById(page, menu.sourceId) ?? null) : null;
    // The page changed under it, or its box went (an undo): nothing to add to.
    const stale = !!menu && (menu.pageId !== page.id || (menu.sourceId !== null && !source));
    useEffect(() => {
        if (stale) closeMenu(store);
    }, [stale, store]);

    if (!menu || stale) return null;

    const picks = menuPicks(menu);
    const mode = boardMode(doc);
    const point = stagePointOf(store, menu);
    // Clear of the preview box at the point, whichever kind it shows.
    const reachFor = (s: Side) =>
        (s === "left" || s === "right" ? HALF_W : HALF_H) * viewport.zoom + GAP;
    const side = menuSide({
        from: source ? nodeCenter(source) : null,
        at: menu.at,
        point,
        stage: canvasSize,
        size: MENU,
        reach: reachFor,
    });

    const move = (to: number) => {
        const next = Math.max(0, Math.min(picks.length - 1, to));
        setActive(store, next);
        tiles.current[next]?.focus({ preventScroll: true });
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const n = Number.parseInt(e.key, 10);
        let handled = true;
        if (Number.isInteger(n) && n >= 1 && n <= picks.length) pick(store, picks[n - 1]!);
        else if (e.key === "Enter" || e.key === " ") pick(store, picks[menu.active] ?? picks[0]!);
        else if (e.key === "ArrowRight") move(menu.active + 1);
        else if (e.key === "ArrowLeft") move(menu.active - 1);
        else if (e.key === "ArrowDown") move(menu.active + COLS);
        else if (e.key === "ArrowUp") move(menu.active - COLS);
        else if (e.key === "Home") move(0);
        else if (e.key === "End") move(picks.length - 1);
        else handled = false;
        // Claimed, so the canvas's own keys (nudge, zoom, Enter to edit the
        // selected box) never also act on it.
        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    };

    const label = (id: PickId) => t(`picks.${id}`);

    return (
        <Popover
            open
            onOpenChange={open => {
                if (!open) closeMenu(store);
            }}
        >
            <PopoverAnchor asChild>
                <div
                    ref={anchorRef}
                    data-pick-anchor=""
                    className="pointer-events-none absolute size-px"
                    style={{ left: point.x, top: point.y }}
                />
            </PopoverAnchor>
            <PopoverContent
                data-pick-menu=""
                role="menu"
                aria-label={source ? t("menu.fromArrow") : t("menu.here")}
                side={side}
                align="center"
                sideOffset={reachFor(side)}
                collisionPadding={12}
                collisionBoundary={stage}
                // The point moves with the board while it is panned or zoomed.
                updatePositionStrategy="always"
                // Focus goes back to the label just opened, not to the anchor.
                onCloseAutoFocus={e => e.preventDefault()}
                onKeyDown={onKeyDown}
                className="w-auto rounded-xl p-1.5"
            >
                <div className="flex items-center justify-between gap-6 px-1.5 pb-1.5 pt-0.5">
                    <span className="text-ink-2 text-[12px] font-medium">{t("menu.title")}</span>
                    <span className="text-ink-3 text-[11px]">
                        {t.rich("menu.cancel", {
                            key: chunks => (
                                <kbd className="border-line bg-panel-2 text-ink-2 rounded border px-1 font-mono text-[10px]">
                                    {chunks}
                                </kbd>
                            ),
                        })}
                    </span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                    {picks.map((p, i) => (
                        <Button
                            key={p.id}
                            ref={el => {
                                tiles.current[i] = el;
                            }}
                            type="button"
                            variant="ghost"
                            role="menuitem"
                            data-pick={p.id}
                            data-active={i === menu.active}
                            aria-keyshortcuts={String(i + 1)}
                            tabIndex={i === menu.active ? 0 : -1}
                            onMouseEnter={() => setActive(store, i)}
                            onFocus={() => setActive(store, i)}
                            onClick={() => pick(store, p)}
                            // The highlight is the focus mark: it follows the arrow keys
                            // and the pointer alike, so no second ring on top.
                            className="text-ink-2 data-[active=true]:bg-brand-soft data-[active=true]:text-brand-ink relative h-[72px] w-[92px] flex-col gap-1 rounded-lg px-1 py-1.5 text-[12px] font-normal focus-visible:border-transparent focus-visible:ring-0 has-[>svg]:px-1"
                        >
                            <span className="text-ink-4 absolute left-1.5 top-1 font-mono text-[10px] leading-none">
                                {i + 1}
                            </span>
                            <Thumb shape={p.shape} mode={mode} />
                            <span className="max-w-full truncate leading-tight">{label(p.id)}</span>
                        </Button>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}
