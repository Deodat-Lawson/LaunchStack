/**
 * Direction B's own transient state, kept beside the editor's store rather
 * than in it: which + arrow was just pressed, the shape picker left open
 * where an arrow was let go, and a short guard over a clicked arrow. None of
 * it is document data or undoable. Keyed by store, since Studio can keep
 * several editors mounted.
 */

import { useSyncExternalStore } from "react";

import type { EditorStore } from "../../model/store";
import type { Point, PortId } from "../../model/types";
import type { Side } from "./placement";

/** An arrow let go over empty space, waiting for a shape. */
export interface PendingPick {
    sourceId: string;
    port: PortId | null;
    /** Where it was let go, on the board. */
    world: Point;
    /**
     * Stage px minus the board point's position in the svg at drop time: the
     * svg's offset in the stage. Re-applied as the board pans or zooms, so the
     * picker stays at the end of its arrow.
     */
    offset: Point;
}

/**
 * Where an arrow was just clicked. For a moment afterwards a second click
 * there is the second half of a double-click, not a click on whatever the
 * new arrow left underneath (the line it drew).
 */
export interface ClickGuard {
    at: Point;
    nodeId: string;
}

export const GUARD_MS = 450;

export class QuickAddState {
    /** The arrow under the last press, until the press settles. */
    private armed: { nodeId: string; side: Side } | null = null;
    private pick: PendingPick | null = null;
    private guard: ClickGuard | null = null;
    private guardTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly listeners = new Set<() => void>();

    subscribe = (fn: () => void): (() => void) => {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    };

    private emit(): void {
        for (const fn of this.listeners) fn();
    }

    arm(nodeId: string, side: Side): void {
        this.armed = { nodeId, side };
    }

    disarm(): void {
        this.armed = null;
    }

    /** Whether the press that just ended was on this box's arrow; forgets it. */
    takeArmed(nodeId: string, port: PortId | null): boolean {
        const a = this.armed;
        this.armed = null;
        return a !== null && a.nodeId === nodeId && a.side === port;
    }

    getPick = (): PendingPick | null => this.pick;

    openPick(pick: PendingPick): void {
        this.pick = pick;
        this.emit();
    }

    closePick(): void {
        if (!this.pick) return;
        this.pick = null;
        this.emit();
    }

    /**
     * Bumped when a box is added: the box the pointer was near stops counting
     * as near, so the new box — selected — shows its arrows instead.
     */
    private nearEpoch = 0;

    getNearEpoch = (): number => this.nearEpoch;

    forgetNear(): void {
        this.nearEpoch += 1;
        this.emit();
    }

    getGuard = (): ClickGuard | null => this.guard;

    setGuard(guard: ClickGuard): void {
        if (this.guardTimer) clearTimeout(this.guardTimer);
        this.guard = guard;
        this.guardTimer = setTimeout(() => this.clearGuard(), GUARD_MS);
        this.emit();
    }

    clearGuard(): void {
        if (this.guardTimer) clearTimeout(this.guardTimer);
        this.guardTimer = null;
        if (!this.guard) return;
        this.guard = null;
        this.emit();
    }
}

const byStore = new WeakMap<EditorStore, QuickAddState>();

export function quickAddState(store: EditorStore): QuickAddState {
    let s = byStore.get(store);
    if (!s) {
        s = new QuickAddState();
        byStore.set(store, s);
    }
    return s;
}

export function usePendingPick(state: QuickAddState): PendingPick | null {
    return useSyncExternalStore(state.subscribe, state.getPick, state.getPick);
}

export function useClickGuard(state: QuickAddState): ClickGuard | null {
    return useSyncExternalStore(state.subscribe, state.getGuard, state.getGuard);
}

export function useNearEpoch(state: QuickAddState): number {
    return useSyncExternalStore(state.subscribe, state.getNearEpoch, state.getNearEpoch);
}
