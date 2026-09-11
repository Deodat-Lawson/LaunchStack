"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { addChildTopic, addSiblingTopic, setEdgeLabel, setNodeText } from "../model/commands";
import { activePage, nodeById, nodeLookup, removeNodes } from "../model/doc";
import { worldToScreen } from "../model/geometry";
import { labelAnchor, routeEdge } from "../model/routing";
import { shapeTextBox } from "../model/shapes";
import { fontFamilyCss, layoutText } from "../model/text";
import type { EditorState } from "../model/store";
import { useCommittedDoc, useEditor, useStore } from "./EditorContext";

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

export function TextEditorOverlay() {
    const store = useStore();
    const editing = useEditor(selectEditing);
    const viewport = useEditor(selectViewport);
    const doc = useCommittedDoc();
    const ref = useRef<HTMLTextAreaElement | null>(null);
    const [value, setValue] = useState("");
    /** Set when a keystroke already decided what happens after committing. */
    const followUp = useRef<"child" | "sibling" | null>(null);
    /**
     * Whether this editing session has been settled (committed or cancelled).
     * Clicking the canvas clears `editing` at pointerdown, which unmounts the
     * field — and a removed element fires no blur, so `onBlur` alone silently
     * dropped everything typed. The teardown effect below settles any session
     * the DOM never got to.
     */
    const settled = useRef(true);
    const settleRef = useRef<() => void>(() => undefined);

    const page = activePage(doc);
    const node = editing?.kind === "node" ? nodeById(page, editing.id) : undefined;
    const edge =
        editing?.kind === "edge-label" ? page.edges.find(e => e.id === editing.id) : undefined;

    // Focus the field the moment it exists. A callback ref rather than an
    // effect, because the field can be unmounted and remounted within one
    // editing session (a gesture clears `editing` and the dblclick restores
    // it) without the effect's deps ever changing — that gap is exactly the
    // "typed into a mounted-but-unfocused field, everything vanished" bug.
    // `preventScroll` is what keeps the browser from scrolling to a field
    // whose position hasn't painted yet.
    const takeFocus = () => {
        const el = ref.current;
        if (el && document.activeElement !== el) {
            el.focus({ preventScroll: true });
            el.select();
        }
    };
    const attachRef = useCallback((el: HTMLTextAreaElement | null) => {
        ref.current = el;
        if (el && document.activeElement !== el) {
            el.focus({ preventScroll: true });
            el.select();
        }
    }, []);

    useLayoutEffect(() => {
        if (!editing) return;
        if (node) setValue(node.text);
        else if (edge) setValue(edge.labels[editing.index ?? 0]?.text ?? "");
        else setValue("");
        settled.current = false;
        // The element is reused when the edit target changes, so the callback
        // ref won't re-fire — focus here too, and re-assert a frame later in
        // case something in the same gesture pulled focus away.
        takeFocus();
        const id = requestAnimationFrame(takeFocus);
        return () => {
            cancelAnimationFrame(id);
            // The session is ending from outside (canvas click, target
            // switch, editor unmount) — commit what was typed before the
            // field disappears with it.
            if (!settled.current) settleRef.current();
        };
        // Re-running on every node mutation would clobber what is being typed;
        // the identity of the edit target is the only trigger that matters.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editing?.kind, editing?.id, editing?.index]);

    useEffect(() => {
        if (!editing) followUp.current = null;
    }, [editing]);

    // Grow the field with its content. The box has no scrollbar (`overflow:
    // hidden`), so without this, text past the shape's height is being typed
    // blind. Runs after every render; only ever grows — the commit fit is
    // what settles the final size.
    useLayoutEffect(() => {
        const el = ref.current;
        if (el && el.scrollHeight > el.clientHeight) {
            el.style.height = `${el.scrollHeight}px`;
        }
    });

    if (!editing) return null;

    // A bare text mark is invisible on the canvas — no fill, no stroke — so an
    // empty one left behind can never be found or selected again. Editing one
    // down to nothing (or abandoning a fresh one) removes it instead.
    const removeEmptyText = () => {
        if (!node) return;
        store.updatePage(page => removeNodes(page, [node.id]), { label: "Remove empty text" });
    };

    const commit = () => {
        settled.current = true;
        if (editing.kind === "node" && node) {
            const isTextMark = node.shape === "text";
            if (isTextMark && value.trim() === "") {
                removeEmptyText();
            } else if (value !== node.text) {
                // A text mark hugs its content: nobody sizes a caption first
                // and types second, so the box follows the words.
                setNodeText(store, node.id, value, { fit: isTextMark });
            }
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
        settled.current = true;
        followUp.current = null;
        if (editing.kind === "node" && node?.shape === "text" && node.text.trim() === "") {
            removeEmptyText();
        }
        store.setEditing(null);
    };
    // The teardown effect reaches commit through a ref because it must run
    // the *last* render's commit — the one that saw the final keystroke.
    settleRef.current = commit;

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
        width = Math.max(box.w * viewport.zoom, 40);
        rotation = node.rotation;
        // The field *is* the label while it's open — the SVG text hides, so
        // the field must sit exactly where the committed lines sit, valign
        // included, or the words visibly jump when editing starts.
        const laid = layoutText(value.length ? value : " ", node.textStyle, Math.max(box.w, 40));
        const boxH = Math.max(box.h * viewport.zoom, 24);
        const blockH = laid.height * viewport.zoom;
        const offset =
            node.textStyle.valign === "middle"
                ? (boxH - blockH) / 2
                : node.textStyle.valign === "bottom"
                  ? boxH - blockH
                  : 0;
        top = topLeft.y + offset;
        height = Math.max(blockH, node.textStyle.size * viewport.zoom * 1.2);
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
            ref={attachRef}
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
                outline: "none",
                resize: "none",
                overflow: "hidden",
                // In-place editing, not a floating field: the real shape shows
                // through (its own SVG label hides while this is open), so the
                // only thing this element paints is the live text and a caret.
                background: "transparent",
                caretColor: style.color,
                color: style.color,
                fontSize,
                fontFamily: fontFamilyCss(style.family),
                fontWeight: style.bold ? 700 : 400,
                fontStyle: style.italic ? "italic" : "normal",
                lineHeight: style.lineHeight,
                textAlign: style.align,
                zIndex: 20,
            }}
        />
    );
}
