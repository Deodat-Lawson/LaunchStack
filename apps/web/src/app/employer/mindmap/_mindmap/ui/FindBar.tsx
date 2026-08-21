"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

import { focusNode, searchDoc, setActivePage } from "../model/commands";
import type { EditorState } from "../model/store";
import { useEditor, useStore } from "./EditorContext";

/**
 * Find on canvas.
 *
 * Matches are highlighted in place and stepped through with Enter, rather than
 * listed in a panel — on a canvas, "where is it" is the question, and a list of
 * titles does not answer it.
 */

const selectDoc = (s: EditorState) => s.doc;

export function FindBar({
    open,
    onClose,
    canvasSize,
}: {
    open: boolean;
    onClose: () => void;
    canvasSize: { w: number; h: number };
}) {
    const store = useStore();
    const doc = useEditor(selectDoc);
    const [query, setQuery] = useState("");
    const [index, setIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const hits = useMemo(() => searchDoc(doc, query), [doc, query]);

    useEffect(() => {
        if (open) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [open]);

    useEffect(() => {
        setIndex(0);
    }, [query]);

    // Highlighting lives in the store so the canvas can paint it; clearing on
    // close is what stops a stale halo hanging around after ⌘F.
    useEffect(() => {
        if (!open) {
            store.setHighlighted([]);
            return;
        }
        store.setHighlighted(hits.filter(h => h.kind === "node").map(h => h.id));
    }, [hits, open, store]);

    if (!open) return null;

    const go = (delta: number) => {
        if (hits.length === 0) return;
        const next = (index + delta + hits.length) % hits.length;
        setIndex(next);
        const hit = hits[next];
        if (!hit) return;
        if (hit.pageId !== doc.activePageId) setActivePage(store, hit.pageId);
        if (hit.kind === "node") focusNode(store, hit.id, canvasSize);
        else store.setSelection([{ kind: "edge", id: hit.id }]);
    };

    return (
        <div className="border-line bg-panel shadow-2 absolute right-4 top-4 z-20 flex items-center gap-1 rounded-lg border p-1.5">
            <Search className="text-ink-3 ml-1 size-3.5" />
            <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                    e.stopPropagation();
                    if (e.key === "Enter") go(e.shiftKey ? -1 : 1);
                    if (e.key === "Escape") onClose();
                }}
                placeholder="Find on canvas…"
                className="text-ink placeholder:text-ink-4 h-6 w-48 bg-transparent text-[13px] outline-none"
                aria-label="Find on canvas"
            />
            <span className="text-ink-3 min-w-[52px] text-center font-mono text-[11px] tabular-nums">
                {hits.length === 0 ? (query ? "0" : "") : `${index + 1}/${hits.length}`}
            </span>
            <button
                type="button"
                onClick={() => go(-1)}
                aria-label="Previous match"
                className="text-ink-3 hover:bg-panel-2 hover:text-ink rounded p-1"
            >
                <ChevronUp className="size-3.5" />
            </button>
            <button
                type="button"
                onClick={() => go(1)}
                aria-label="Next match"
                className="text-ink-3 hover:bg-panel-2 hover:text-ink rounded p-1"
            >
                <ChevronDown className="size-3.5" />
            </button>
            <button
                type="button"
                onClick={onClose}
                aria-label="Close find"
                className="text-ink-3 hover:bg-panel-2 hover:text-ink rounded p-1"
            >
                <X className="size-3.5" />
            </button>
        </div>
    );
}
