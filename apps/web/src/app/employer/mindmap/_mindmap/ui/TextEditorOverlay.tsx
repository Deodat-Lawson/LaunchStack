"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

import { addChildTopic, addSiblingTopic, setEdgeLabel, setNodeText } from "../model/commands";
import { activePage, nodeById, nodeLookup } from "../model/doc";
import { worldToScreen } from "../model/geometry";
import { labelAnchor, routeEdge } from "../model/routing";
import { shapeTextBox } from "../model/shapes";
import { fontFamilyCss } from "../model/text";
import type { EditorState } from "../model/store";
import { useEditor, useStore } from "./EditorContext";

/**
 * In-place text editing.
 *
 * A real `<textarea>` is positioned over the shape rather than making the SVG
 * text editable: that buys IME support, spellcheck, native selection and
 * undo-in-field for free, all of which a `contenteditable` on SVG text gets
 * wrong. It is styled to match the shape's own typography so the swap is
 * invisible.
 *
 * Enter commits and adds a sibling topic, Tab commits and adds a child —
 * the two keystrokes that make outlining a mindmap fast. Shift+Enter inserts a
 * newline instead.
 */

const selectEditing = (s: EditorState) => s.editing;
const selectViewport = (s: EditorState) => s.viewport;
const selectDoc = (s: EditorState) => s.doc;

export function TextEditorOverlay() {
    const store = useStore();
    const editing = useEditor(selectEditing);
    const viewport = useEditor(selectViewport);
    const doc = useEditor(selectDoc);
    const ref = useRef<HTMLTextAreaElement | null>(null);
    const [value, setValue] = useState("");
    /** Set when a keystroke already decided what happens after committing. */
    const followUp = useRef<"child" | "sibling" | null>(null);

    const page = activePage(doc);
    const node = editing?.kind === "node" ? nodeById(page, editing.id) : undefined;
    const edge =
        editing?.kind === "edge-label" ? page.edges.find(e => e.id === editing.id) : undefined;

    useLayoutEffect(() => {
        if (!editing) return;
        if (node) setValue(node.text);
        else if (edge) setValue(edge.labels[editing.index ?? 0]?.text ?? "");
        else setValue("");
        // Focus after the position lands, otherwise the browser scrolls the
        // page to a textarea that is still at 0,0.
        const id = requestAnimationFrame(() => {
            const el = ref.current;
            if (!el) return;
            el.focus();
            el.select();
        });
        return () => cancelAnimationFrame(id);
        // Re-running on every node mutation would clobber what is being typed;
        // the identity of the edit target is the only trigger that matters.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editing?.kind, editing?.id, editing?.index]);

    useEffect(() => {
        if (!editing) followUp.current = null;
    }, [editing]);

    if (!editing) return null;

    const commit = () => {
        if (editing.kind === "node" && node) {
            if (value !== node.text) setNodeText(store, node.id, value);
        } else if (editing.kind === "edge-label" && edge) {
            setEdgeLabel(store, edge.id, editing.index ?? 0, value);
        }
        const next = followUp.current;
        followUp.current = null;
        store.setEditing(null);
        if (next && node) {
            if (next === "child") addChildTopic(store, node.id);
            else addSiblingTopic(store, node.id);
        }
    };

    const cancel = () => {
        followUp.current = null;
        store.setEditing(null);
    };

    // -- geometry ----------------------------------------------------------

    let left = 0;
    let top = 0;
    let width = 160;
    let height = 40;
    const style = node?.textStyle ?? edge?.textStyle;
    let rotation = 0;

    if (node) {
        const box = shapeTextBox(node.shape, node.w, node.h);
        const topLeft = worldToScreen(viewport, { x: node.x + box.x, y: node.y + box.y });
        left = topLeft.x;
        top = topLeft.y;
        width = Math.max(box.w * viewport.zoom, 40);
        height = Math.max(box.h * viewport.zoom, 24);
        rotation = node.rotation;
    } else if (edge) {
        const routed = routeEdge(edge, nodeLookup(page));
        const label = edge.labels[editing.index ?? 0];
        const at = labelAnchor(routed, label?.t ?? 0.5, label?.offset ?? 0);
        const screen = worldToScreen(viewport, at);
        width = 180;
        height = 30;
        left = screen.x - width / 2;
        top = screen.y - height / 2;
    }

    if (!style) return null;
    const fontSize = style.size * viewport.zoom;

    return (
        <textarea
            ref={ref}
            value={value}
            onChange={e => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
                e.stopPropagation();
                if (e.key === "Escape") {
                    e.preventDefault();
                    cancel();
                    return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    // Only mindmap topics chain; a sticky note's Enter is a
                    // newline, which is what people expect from a sticky.
                    followUp.current = node?.shape.startsWith("mind-") === true ? "sibling" : null;
                    commit();
                    return;
                }
                if (e.key === "Tab") {
                    e.preventDefault();
                    followUp.current = node ? "child" : null;
                    commit();
                }
            }}
            spellCheck
            style={{
                position: "absolute",
                left,
                top,
                width,
                height,
                transform: rotation ? `rotate(${rotation}deg)` : undefined,
                transformOrigin: "center",
                margin: 0,
                padding: 0,
                border: "none",
                outline: `2px solid var(--accent)`,
                outlineOffset: 2,
                borderRadius: 3,
                resize: "none",
                overflow: "hidden",
                background: "var(--panel)",
                color: style.color,
                fontSize,
                fontFamily: fontFamilyCss(style.family),
                fontWeight: style.bold ? 700 : 400,
                fontStyle: style.italic ? "italic" : "normal",
                lineHeight: style.lineHeight,
                textAlign: style.align,
                zIndex: 20,
                boxShadow: "0 6px 24px var(--scrim-shadow)",
            }}
        />
    );
}
