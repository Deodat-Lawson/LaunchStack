"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import { fitToScreen, focusNode } from "../model/commands";
import { activePage, graphIndex } from "../model/doc";
import { useCommittedDoc, useStore } from "./EditorContext";

/**
 * Present a mindmap branch by branch.
 *
 * The page-stepping bar is right for a multi-page deck and wrong for a
 * mindmap, whose natural unit is the branch. This starts with every branch
 * folded to its first level, and each step unfolds the next one and eases the
 * view onto it; the last step steps back out to the whole map.
 *
 * Folding goes through the store's transient `folded` set, never the
 * document: presenting a map must not dirty it, and two people presenting the
 * same file must not fight over its collapse state.
 */

export function Presenter({
    canvasSize,
    isActive,
    onExit,
}: {
    canvasSize: { w: number; h: number };
    /** False while the editor is mounted off screen; arrows belong elsewhere. */
    isActive?: () => boolean;
    onExit: () => void;
}) {
    const store = useStore();
    const doc = useCommittedDoc();

    // The root is the topic with children and no parent; its children are the
    // branches, in document order.
    const branches = useMemo(() => {
        const page = activePage(doc);
        const idx = graphIndex(page);
        const root = page.nodes.find(
            nd => (idx.in.get(nd.id) ?? []).length === 0 && (idx.out.get(nd.id) ?? []).length > 0
        );
        return root ? (idx.out.get(root.id) ?? []) : [];
    }, [doc]);

    // 0 = overview with everything folded; 1..n = branch n revealed;
    // n + 1 = the whole map, unfolded.
    const [step, setStep] = useState(0);

    // Fold on mount, unfold on unmount. Idempotent rather than guarded by a
    // ref: React runs mount → cleanup → mount in development.
    useEffect(() => {
        if (branches.length === 0) return;
        store.setFolded(branches);
        fitToScreen(store, canvasSize);
        return () => {
            store.setFolded([]);
        };
        // The branch list is fixed for the length of a presentation.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branches.length]);

    const go = useCallback(
        (next: number) => {
            const last = branches.length + 1;
            const target = Math.max(0, Math.min(last, next));
            setStep(target);
            if (target === 0) {
                store.setFolded(branches);
                store.clearSelection();
                fitToScreen(store, canvasSize);
                return;
            }
            if (target === last) {
                store.setFolded([]);
                store.clearSelection();
                fitToScreen(store, canvasSize);
                return;
            }
            store.setFolded(branches.slice(target));
            focusNode(store, branches[target - 1]!, canvasSize);
        },
        [branches, canvasSize, store]
    );

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            // Gated rather than unmounted: unmounting runs the cleanup that
            // unfolds the map, so hiding the tab would lose the presentation.
            if (isActive && !isActive()) return;
            if (e.defaultPrevented) return;
            if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
                e.preventDefault();
                go(step + 1);
            }
            if (e.key === "ArrowLeft" || e.key === "PageUp") {
                e.preventDefault();
                go(step - 1);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [go, step, isActive]);

    const last = branches.length + 1;
    const label =
        step === 0
            ? "Overview"
            : step === last
              ? "Whole map"
              : `Branch ${step} of ${branches.length}`;

    return (
        <>
            <Laser />
            <div
                data-export="omit"
                className="border-line bg-panel text-ink absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border px-1.5 py-1 shadow-lg"
            >
                <button
                    type="button"
                    onClick={() => go(step - 1)}
                    disabled={step === 0}
                    aria-label="Previous"
                    className="text-ink-2 hover:bg-panel-2 flex size-7 items-center justify-center rounded-full disabled:opacity-40"
                >
                    <ChevronLeft className="size-4" />
                </button>
                <span className="text-ink-2 min-w-28 px-2 text-center font-mono text-[11px]">
                    {label}
                </span>
                <button
                    type="button"
                    onClick={() => go(step + 1)}
                    disabled={step === last}
                    aria-label="Next"
                    className="text-ink-2 hover:bg-panel-2 flex size-7 items-center justify-center rounded-full disabled:opacity-40"
                >
                    <ChevronRight className="size-4" />
                </button>
                <span className="bg-line mx-1 h-4 w-px" />
                <button
                    type="button"
                    onClick={onExit}
                    aria-label="Exit presentation"
                    className="text-ink-2 hover:bg-panel-2 flex h-7 items-center gap-1 rounded-full px-2 text-[11px]"
                >
                    <X className="size-3.5" />
                    Esc
                </button>
            </div>
        </>
    );
}

/**
 * A pointer people can see from the back of the room. Follows the mouse over
 * the stage and hides when it leaves, so the ordinary cursor is never lost.
 */
function Laser() {
    const [at, setAt] = useState<{ x: number; y: number } | null>(null);
    useEffect(() => {
        const move = (e: PointerEvent) => setAt({ x: e.clientX, y: e.clientY });
        const leave = () => setAt(null);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerleave", leave);
        document.addEventListener("mouseleave", leave);
        return () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerleave", leave);
            document.removeEventListener("mouseleave", leave);
        };
    }, []);
    if (!at) return null;
    return (
        <div
            data-export="omit"
            aria-hidden
            className="bg-danger pointer-events-none fixed z-50 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-90 shadow-[0_0_0_4px_oklch(0.6_0.2_25/0.25)]"
            style={{ left: at.x, top: at.y }}
        />
    );
}
