"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { activePage, nodeById } from "../../model/doc";
import { expandRect, nodeBounds, nodeCenter, portNormal, portPoint } from "../../model/geometry";
import { shapeGeometry } from "../../model/shapes";
import type { EditorState } from "../../model/store";
import type { DiagramNode, Point, Rect } from "../../model/types";
import { focusEditorField, useEditor, useStore } from "../../ui/EditorContext";
import { activeFlowLook, boardMode } from "../looks";
import {
    ARROW_HIT,
    ARROW_OFFSET,
    arrowAnchor,
    copySize,
    offersArrows,
    placeBeside,
    shapeSize,
    sideStep,
    SIDES,
    type Side,
} from "./placement";
import {
    quickAddState,
    useClickGuard,
    useNearEpoch,
    usePendingPick,
    type PendingPick,
} from "./state";

/**
 * Direction B's marks on the board: four + arrows round the box under the
 * pointer (or the one selected box), a ghost of the box an arrow would add
 * while the pointer is on it, and the dashed end of an arrow waiting for the
 * shape picker. World space, sized in screen pixels (`1/zoom`), drawn in the
 * canvas's chrome layer — so never exported.
 *
 * The arrows carry `data-node-id` + `data-port`, which is all the canvas
 * needs to treat a press on one as a press on that side of the box: a drag
 * draws a connector (and, let go over empty space, opens the picker), and a
 * click comes back through `onPortClick`. A click on an ordinary dot comes
 * back the same way, so each arrow marks itself as pressed (`arm`) and only a
 * click that began on an arrow adds a box.
 */

interface LayerState {
    selection: EditorState["selection"];
    dragging: boolean;
    editing: boolean;
    tool: EditorState["tool"];
    zoom: number;
    viewport: EditorState["viewport"];
    doc: EditorState["doc"];
}

const selectLayer = (s: EditorState): LayerState => ({
    selection: s.selection,
    dragging: s.drag.kind !== "none",
    editing: s.editing !== null,
    tool: s.tool,
    zoom: s.viewport.zoom,
    viewport: s.viewport,
    doc: s.doc,
});

const sameLayer = (a: LayerState, b: LayerState) =>
    a.selection === b.selection &&
    a.dragging === b.dragging &&
    a.editing === b.editing &&
    a.tool === b.tool &&
    a.viewport === b.viewport &&
    a.doc === b.doc;

/** How far past the arrows (screen px) the pointer may wander before they go. */
const HALO = ARROW_OFFSET + ARROW_HIT + 6;

function inside(r: Rect, p: Point): boolean {
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function QuickAddLayer() {
    const store = useStore();
    const qs = quickAddState(store);
    const t = useTranslations("mindmap.variants.b");
    const v = useEditor(selectLayer, sameLayer);
    const pick = usePendingPick(qs);
    const guard = useClickGuard(qs);
    const rootRef = useRef<SVGGElement | null>(null);

    // The box whose arrows are up because the pointer is on it — or was, and
    // is still within reach of its arrows. Tracked here rather than read from
    // the editor's hover, which drops to nothing the moment the pointer
    // leaves the box: the arrows would vanish on the way to them.
    // Keyed to the moment it was set: a box just added by an arrow is
    // selected, and its arrows — not the old box's, still under the pointer —
    // are the ones to show until the pointer goes to another box.
    const [nearMark, setNearMark] = useState<{ id: string; epoch: number } | null>(null);
    const nearRef = useRef<{ id: string; epoch: number } | null>(null);
    const epoch = useNearEpoch(qs);
    const near = nearMark && nearMark.epoch === epoch ? nearMark.id : null;
    const [hot, setHot] = useState<{ nodeId: string; side: Side } | null>(null);

    const page = useMemo(() => activePage(v.doc), [v.doc]);

    useEffect(() => {
        const svg = rootRef.current?.ownerSVGElement;
        if (!svg) return;
        const setNearTo = (id: string | null) => {
            const now = qs.getNearEpoch();
            const cur = nearRef.current;
            if (cur?.id === id && cur.epoch === now) return;
            if (!cur && !id) return;
            nearRef.current = id ? { id, epoch: now } : null;
            setNearMark(nearRef.current);
        };
        const onMove = (e: PointerEvent) => {
            if (e.buttons !== 0) return;
            const target = e.target instanceof Element ? e.target : null;
            const over = target?.closest("[data-node-id]")?.getAttribute("data-node-id") ?? null;
            if (over) {
                setNearTo(over);
                return;
            }
            const current = nearRef.current;
            if (!current) return;
            if (current.epoch !== qs.getNearEpoch()) {
                setNearTo(null);
                return;
            }
            const state = store.getState();
            const nd = nodeById(activePage(state.doc), current.id);
            const vp = state.viewport;
            const box = svg.getBoundingClientRect();
            const world = {
                x: vp.x + (e.clientX - box.left) / vp.zoom,
                y: vp.y + (e.clientY - box.top) / vp.zoom,
            };
            if (!nd || !inside(expandRect(nodeBounds(nd), HALO / vp.zoom), world)) {
                setNearTo(null);
            }
        };
        const onLeave = () => setNearTo(null);
        // Every press starts unarmed: only one that lands on an arrow arms
        // (its own handler runs after this one, in the bubble phase). Nothing
        // here may hide the arrows — a re-render between this listener and
        // the arrow's would unmount the arrow being pressed.
        const onDown = () => {
            qs.disarm();
            setHot(null);
        };
        svg.addEventListener("pointermove", onMove);
        svg.addEventListener("pointerleave", onLeave);
        svg.addEventListener("pointerdown", onDown, true);
        return () => {
            svg.removeEventListener("pointermove", onMove);
            svg.removeEventListener("pointerleave", onLeave);
            svg.removeEventListener("pointerdown", onDown, true);
        };
    }, [qs, store]);

    const selectedNodes = v.selection.filter(s => s.kind === "node");
    const hidden =
        v.dragging || v.editing || v.tool !== "select" || selectedNodes.length > 1 || pick !== null;
    const targetId = hidden
        ? null
        : (near ?? (selectedNodes.length === 1 ? selectedNodes[0]!.id : null));
    const target = targetId ? nodeById(page, targetId) : undefined;
    const showArrows = target !== undefined && offersArrows(target);

    const onHot = useCallback(
        (nodeId: string, side: Side | null) => setHot(side ? { nodeId, side } : null),
        []
    );

    return (
        <g ref={rootRef} data-quick-add="">
            {showArrows && hot?.nodeId === target.id && (
                <AddPreview node={target} side={hot.side} zoom={v.zoom} />
            )}
            {showArrows &&
                SIDES.map(side => (
                    <QuickArrow
                        key={side}
                        node={target}
                        side={side}
                        zoom={v.zoom}
                        hot={hot?.nodeId === target.id && hot.side === side}
                        title={t(`arrow.${side}`)}
                        onArm={() => qs.arm(target.id, side)}
                        onHot={onHot}
                    />
                ))}
            {pick && <PickEnd pick={pick} zoom={v.zoom} />}
            {guard && (
                // The second press of a double-click on an arrow: the arrow is
                // gone (its box's label is open) and the line it drew runs
                // underneath, so the press would select that line and the
                // double-click label it. It is the same click; swallow it.
                <circle
                    data-quick-add-guard=""
                    cx={guard.at.x}
                    cy={guard.at.y}
                    r={(ARROW_HIT * 1.6) / v.zoom}
                    fill="transparent"
                    style={{ pointerEvents: "all" }}
                    onPointerDown={e => {
                        e.stopPropagation();
                        e.preventDefault();
                        focusEditorField(store);
                    }}
                    onDoubleClick={e => e.stopPropagation()}
                />
            )}
        </g>
    );
}

function QuickArrow({
    node,
    side,
    zoom,
    hot,
    title,
    onArm,
    onHot,
}: {
    node: DiagramNode;
    side: Side;
    zoom: number;
    hot: boolean;
    title: string;
    onArm: () => void;
    onHot: (nodeId: string, side: Side | null) => void;
}) {
    const c = arrowAnchor(node, side, zoom);
    const out = portNormal(node, side);
    const angle = (Math.atan2(out.y, out.x) * 180) / Math.PI;

    // Drawn pointing right in screen pixels, then turned to face out of its
    // side and scaled to the board: a tag with a point — an arrow, unlike the
    // round connection dots beside it — carrying a +.
    return (
        <g
            data-node-id={node.id}
            data-port={side}
            data-quick-add-arrow={side}
            role="button"
            aria-label={title}
            transform={`translate(${c.x} ${c.y}) rotate(${angle}) scale(${1 / zoom})`}
            style={{ pointerEvents: "all", cursor: "pointer" }}
            onPointerDown={e => {
                if (e.button === 0) onArm();
            }}
            onPointerEnter={() => onHot(node.id, side)}
            onPointerLeave={() => onHot(node.id, null)}
        >
            <title>{title}</title>
            <circle r={ARROW_HIT} fill="transparent" />
            {/* Opaque under its tint, so a line it sits on does not show through. */}
            <path d={TAG} fill="var(--panel)" style={{ pointerEvents: "none" }} />
            <path
                d={TAG}
                fill="var(--accent)"
                fillOpacity={hot ? 1 : 0.12}
                stroke="var(--accent)"
                strokeWidth={1.25}
                strokeLinejoin="round"
                style={{ pointerEvents: "none" }}
            />
            <path
                d={PLUS}
                stroke={hot ? "var(--panel)" : "var(--accent)"}
                strokeWidth={1.75}
                strokeLinecap="round"
                style={{ pointerEvents: "none" }}
            />
        </g>
    );
}

/** The arrow tag, pointing right, centred on 0 (screen px). */
const TAG = "M -7 -8 H 3 L 10 0 L 3 8 H -7 A 3 3 0 0 1 -10 5 V -5 A 3 3 0 0 1 -7 -8 Z";
/** Its +, centred on the tag's body. */
const PLUS = "M -7 0 H 0 M -3.5 -3.5 V 3.5";

/**
 * The box a click would add, where it would go — the clone outline draw.io
 * shows on its blue arrows — so an arrow says what it does before it is
 * pressed, including when the spot is taken and the box fans out instead.
 */
function AddPreview({ node, side, zoom }: { node: DiagramNode; side: Side; zoom: number }) {
    const store = useStore();
    const state = store.getState();
    const page = activePage(state.doc);
    const look = activeFlowLook(state);
    const base = look?.boxLook(node.shape, boardMode(state.doc)).size ?? shapeSize(node.shape);
    const size = copySize(node, base);
    const at = placeBeside(page, node, side, size);
    const px = (n: number) => n / zoom;
    const geometry = shapeGeometry(node.shape, size.w, size.h, node.style.radius);
    const from = portPoint(node, side);
    const step = sideStep(node, side);
    const entry =
        step.x !== 0
            ? { x: at.x - (step.x * size.w) / 2, y: at.y }
            : { x: at.x, y: at.y - (step.y * size.h) / 2 };
    const mid =
        step.x !== 0
            ? [
                  { x: (from.x + entry.x) / 2, y: from.y },
                  { x: (from.x + entry.x) / 2, y: entry.y },
              ]
            : [
                  { x: from.x, y: (from.y + entry.y) / 2 },
                  { x: entry.x, y: (from.y + entry.y) / 2 },
              ];
    const line = [from, ...mid, entry].map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");

    return (
        <g data-quick-add-preview="" style={{ pointerEvents: "none" }}>
            <path
                d={line}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={px(1.25)}
                strokeDasharray={`${px(4)} ${px(3)}`}
                strokeOpacity={0.8}
            />
            <g transform={`translate(${at.x - size.w / 2} ${at.y - size.h / 2})`}>
                <path
                    d={geometry.path}
                    fill="var(--accent)"
                    fillOpacity={0.06}
                    stroke="var(--accent)"
                    strokeWidth={px(1.25)}
                    strokeDasharray={`${px(5)} ${px(3)}`}
                />
            </g>
        </g>
    );
}

/** The arrow's loose end while the picker asks what goes there. */
function PickEnd({ pick, zoom }: { pick: PendingPick; zoom: number }) {
    const store = useStore();
    const source = nodeById(activePage(store.getState().doc), pick.sourceId);
    if (!source) return null;
    const px = (n: number) => n / zoom;
    const c = nodeCenter(source);
    const d = { x: pick.world.x - c.x, y: pick.world.y - c.y };
    const side: Side =
        Math.abs(d.x) >= Math.abs(d.y) ? (d.x >= 0 ? "e" : "w") : d.y >= 0 ? "s" : "n";
    const from = portPoint(source, side);
    return (
        <g data-quick-add-pending="" style={{ pointerEvents: "none" }}>
            <line
                x1={from.x}
                y1={from.y}
                x2={pick.world.x}
                y2={pick.world.y}
                stroke="var(--accent)"
                strokeWidth={px(1.5)}
                strokeDasharray={`${px(6)} ${px(4)}`}
            />
            <circle cx={pick.world.x} cy={pick.world.y} r={px(4)} fill="var(--accent)" />
        </g>
    );
}
