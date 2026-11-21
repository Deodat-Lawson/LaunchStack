"use client";

import React, { useCallback, useRef } from "react";
import { useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "~/components/ui/popover";

import { activePage, nodeById } from "../../model/doc";
import { nodeCenter, worldToScreen } from "../../model/geometry";
import { shapeGeometry } from "../../model/shapes";
import type { EditorState } from "../../model/store";
import type { ShapeId } from "../../model/types";
import type { ThemeMode } from "../../model/palette";
import { useEditor, useStore } from "../../ui/EditorContext";
import { activeFlowLook, boardMode } from "../looks";
import type { FlowLook } from "../types";
import { addPicked, PICKER_SHAPES } from "./commands";
import { lookB } from "./look";
import { quickAddState, usePendingPick } from "./state";

/**
 * What goes at the end of an arrow let go over empty space: six flowchart
 * shapes, each drawn as it will be made, at the arrow's end. Arrow keys move
 * through them, Enter makes one, Escape or a click anywhere else leaves the
 * page as it was — the arrow was never added, only drawn as a ghost on the
 * canvas (`ArrowsLayer`), so there is nothing to take back.
 */

const COLUMNS = 3;

const selectViewport = (s: EditorState) => s.viewport;
const selectMode = (s: EditorState): ThemeMode => boardMode(s.doc);
const selectLook = (s: EditorState): FlowLook => activeFlowLook(s) ?? lookB;

export function ShapePicker() {
    const store = useStore();
    const qs = quickAddState(store);
    const pick = usePendingPick(qs);
    const viewport = useEditor(selectViewport);
    const mode = useEditor(selectMode);
    const look = useEditor(selectLook);
    const t = useTranslations("mindmap.variants.b");
    const tiles = useRef<(HTMLButtonElement | null)[]>([]);

    const choose = useCallback(
        (shape: ShapeId) => {
            const current = qs.getPick();
            if (!current) return;
            qs.closePick();
            addPicked(store, current, shape);
            qs.forgetNear();
        },
        [qs, store]
    );

    if (!pick) return null;
    // Across the way the arrow was dragged — below a sideways drag, beside a
    // vertical one — so it never sits on the line. Placed along it, the edge
    // of the board flipped it back over the box the arrow came from; across,
    // a flip only moves it to the other side of the line.
    const source = nodeById(activePage(store.getState().doc), pick.sourceId);
    const from = source ? nodeCenter(source) : pick.world;
    const across =
        Math.abs(pick.world.x - from.x) >= Math.abs(pick.world.y - from.y) ? "bottom" : "right";
    const onSvg = worldToScreen(viewport, pick.world);
    const at = { x: onSvg.x + pick.offset.x, y: onSvg.y + pick.offset.y };

    const focusTile = (i: number) => tiles.current[i]?.focus();

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        // The canvas's shortcuts (tools, nudging, Delete) are not for the
        // picker; Escape has already closed it by the time this runs.
        e.stopPropagation();
        const n = PICKER_SHAPES.length;
        const i = tiles.current.findIndex(el => el === document.activeElement);
        const from = i < 0 ? 0 : i;
        let next: number | null = null;
        switch (e.key) {
            case "ArrowRight":
                next = (from + 1) % n;
                break;
            case "ArrowLeft":
                next = (from - 1 + n) % n;
                break;
            case "ArrowDown":
                next = (from + COLUMNS) % n;
                break;
            case "ArrowUp":
                next = (from - COLUMNS + n) % n;
                break;
            case "Tab":
                next = e.shiftKey ? (from - 1 + n) % n : (from + 1) % n;
                break;
            case "Home":
                next = 0;
                break;
            case "End":
                next = n - 1;
                break;
            case "Enter":
            case " ":
                e.preventDefault();
                choose(PICKER_SHAPES[from]!);
                return;
            case "Escape":
                e.preventDefault();
                return;
        }
        if (next !== null) {
            e.preventDefault();
            focusTile(next);
        }
    };

    return (
        <Popover open onOpenChange={open => !open && qs.closePick()}>
            <PopoverAnchor asChild>
                <div
                    aria-hidden
                    className="pointer-events-none absolute size-px"
                    style={{ left: at.x, top: at.y }}
                />
            </PopoverAnchor>
            <PopoverContent
                side={across}
                align="center"
                sideOffset={16}
                collisionPadding={12}
                className="w-auto p-1.5"
                data-quick-add-picker=""
                onOpenAutoFocus={e => {
                    e.preventDefault();
                    focusTile(0);
                }}
                // The label of the box just made takes focus; handing it back
                // to whatever had it before the picker would close that label.
                onCloseAutoFocus={e => e.preventDefault()}
                onKeyDown={onKeyDown}
            >
                <p className="text-ink-3 px-1.5 pb-1.5 pt-0.5 text-[11.5px]">{t("pickerTitle")}</p>
                <div role="menu" aria-label={t("pickerLabel")} className="grid grid-cols-3 gap-0.5">
                    {PICKER_SHAPES.map((shape, i) => (
                        <Button
                            key={shape}
                            ref={el => {
                                tiles.current[i] = el;
                            }}
                            type="button"
                            role="menuitem"
                            variant="ghost"
                            tabIndex={i === 0 ? 0 : -1}
                            data-shape={shape}
                            className="text-ink-2 focus-visible:bg-brand-soft focus-visible:text-brand-ink h-auto w-[84px] flex-col gap-1.5 rounded-md px-1 pb-1.5 pt-2 text-[11.5px] font-normal focus-visible:ring-2"
                            onClick={() => choose(shape)}
                        >
                            <span className="flex h-[30px] w-[52px] items-center justify-center">
                                <Thumb shape={shape} look={look} mode={mode} />
                            </span>
                            <span className="leading-none">{t(`shape.${shape}`)}</span>
                        </Button>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}

/**
 * The shape as it will be made: its real outline (`shapeGeometry`, the same
 * function the canvas draws with) at the direction's size, in the
 * direction's colours for this board. Those colours are document data —
 * literal OKLCH, the editor's documented exception — not chrome.
 */
function Thumb({ shape, look, mode }: { shape: ShapeId; look: FlowLook; mode: ThemeMode }) {
    const box = look.boxLook(shape, mode);
    const size = box.size ?? { w: 160, h: 60 };
    const g = shapeGeometry(shape, size.w, size.h, box.style.radius ?? 4);
    const fill = box.style.fill ?? "none";
    const stroke = box.style.stroke ?? "currentColor";
    const pad = 3;
    return (
        // `size-full`: the kit button sizes any svg without a size class to 16px.
        <svg
            aria-hidden
            className="size-full"
            viewBox={`${-pad} ${-pad} ${size.w + pad * 2} ${size.h + pad * 2}`}
            preserveAspectRatio="xMidYMid meet"
        >
            {g.backing?.map((d, i) => (
                <path
                    key={`b${i}`}
                    d={d}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={1.25}
                    vectorEffect="non-scaling-stroke"
                />
            ))}
            <path
                d={g.path}
                fill={fill}
                stroke={stroke}
                strokeWidth={1.25}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
            />
            {g.decorations?.map((d, i) => (
                <path
                    key={`d${i}`}
                    d={d}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={1.25}
                    vectorEffect="non-scaling-stroke"
                />
            ))}
        </svg>
    );
}
