/**
 * The pick menu's state, one per editor, and the commands it runs.
 *
 * Kept beside the store rather than in it: it is a passing UI moment owned by
 * this direction, never part of the document or of `EditorState`. The menu,
 * the ghost drawn on the canvas and the empty-page prompt all read it through
 * `subscribeMenu`; nothing is put on the page until a pick.
 */

import { insertEdge, docMode } from "../../model/commands";
import { activePage, addEdges, addNodes, nodeById } from "../../model/doc";
import { worldToScreen } from "../../model/geometry";
import { shapeDef } from "../../model/shapes";
import type { EditorStore } from "../../model/store";
import type { DiagramNode, Point } from "../../model/types";
import { activeFlowLook } from "../looks";
import type { CanvasPoint, ConnectDrop } from "../types";
import { lookC } from "./look";
import { alignToSource, picksFor, planPick, type Pick } from "./place";

export interface PickMenu {
    /** The page it was opened on; another page closes it. */
    pageId: string;
    /** The box the arrow came out of; null after a double-click. */
    sourceId: string | null;
    /** Board point a picked shape is centred on (already aligned). */
    at: Point;
    /**
     * Where the canvas's <svg> sits inside the stage, in px, so the menu can
     * follow its point when the board is panned or zoomed.
     */
    offset: Point;
    /** The highlighted option, by position. */
    active: number;
}

const menus = new WeakMap<EditorStore, PickMenu>();
const listeners = new WeakMap<EditorStore, Set<() => void>>();

function emit(store: EditorStore): void {
    for (const fn of listeners.get(store) ?? []) fn();
}

export function subscribeMenu(store: EditorStore, fn: () => void): () => void {
    let set = listeners.get(store);
    if (!set) {
        set = new Set();
        listeners.set(store, set);
    }
    set.add(fn);
    return () => {
        set.delete(fn);
    };
}

export function menuOf(store: EditorStore): PickMenu | null {
    return menus.get(store) ?? null;
}

/** The options the open menu offers. */
export function menuPicks(menu: PickMenu): readonly Pick[] {
    return picksFor(menu.sourceId !== null);
}

/** Where a board point sits on the stage, for a menu laid over it. */
export function stagePointOf(store: EditorStore, menu: PickMenu): Point {
    const p = worldToScreen(store.getState().viewport, menu.at);
    return { x: p.x + menu.offset.x, y: p.y + menu.offset.y };
}

function open(store: EditorStore, sourceId: string | null, at: Point, screen: Point, world: Point) {
    const viewport = store.getState().viewport;
    const onSvg = worldToScreen(viewport, world);
    menus.set(store, {
        pageId: store.getState().doc.activePageId,
        sourceId,
        at,
        offset: { x: screen.x - onSvg.x, y: screen.y - onSvg.y },
        active: 0,
    });
    emit(store);
}

/**
 * An arrow let go over empty space: open the menu at the drop, the point
 * aligned with the box's centre line when it is close to it.
 */
export function openFromDrop(store: EditorStore, drop: ConnectDrop): boolean {
    const source = nodeById(activePage(store.getState().doc), drop.sourceId);
    if (!source) return false;
    const at = alignToSource(source, drop.world, store.getState().viewport.zoom);
    open(store, source.id, at, drop.screen, drop.world);
    return true;
}

/** A double-click on empty canvas, or the empty page's button. */
export function openAt(store: EditorStore, point: CanvasPoint): boolean {
    open(store, null, point.world, point.screen, point.world);
    return true;
}

export function closeMenu(store: EditorStore): void {
    if (!menus.has(store)) return;
    menus.delete(store);
    emit(store);
}

export function setActive(store: EditorStore, index: number): void {
    const menu = menus.get(store);
    if (!menu || menu.active === index) return;
    menus.set(store, { ...menu, active: index });
    emit(store);
}

/** The box an open menu's arrow comes from, if it is still on the page. */
export function sourceOf(store: EditorStore, menu: PickMenu): DiagramNode | null {
    if (!menu.sourceId) return null;
    return nodeById(activePage(store.getState().doc), menu.sourceId) ?? null;
}

/**
 * Pick an option: the box (centred on the point, label open) and the arrow
 * to it, as one undo step — or the arrow alone, its end at the point.
 */
export function pick(store: EditorStore, choice: Pick): void {
    const menu = menus.get(store);
    if (!menu) return;
    closeMenu(store);
    const state = store.getState();
    if (state.doc.activePageId !== menu.pageId) return;
    const source = sourceOf(store, menu);
    if (menu.sourceId && !source) return;
    const look = activeFlowLook(state) ?? lookC;
    const mode = docMode(store);
    const plan = planPick(look, mode, source, menu.at, choice);
    if (!plan.node) {
        if (plan.edge) insertEdge(store, plan.edge);
        return;
    }
    const node = plan.node;
    const edges = plan.edge ? [plan.edge] : [];
    store.updatePage(p => addEdges(addNodes(p, [node]), edges), {
        label: `Add ${shapeDef(node.shape).name}`,
    });
    store.selectNodes([node.id]);
    store.setEditing({ kind: "node", id: node.id });
}
