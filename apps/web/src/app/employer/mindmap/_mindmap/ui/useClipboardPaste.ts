"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { fitImageBox, isImageFile, loadImageFile } from "../lib/images";
import { instantiate, parsePayload } from "../model/clipboard";
import { createNodeAt } from "../model/factory";
import { parseDoc } from "../model/serialize";
import type { EditorStore } from "../model/store";
import type { Point } from "../model/types";

/**
 * Paste, from the native `paste` event rather than the async Clipboard API.
 *
 * The event carries the payload synchronously and needs no permission prompt,
 * and — critically — it is the only way to receive a *screenshot* pasted from
 * the OS clipboard, which never appears in `navigator.clipboard.readText()`.
 *
 * Priority: our own copied shapes, then images, then a whole document, then
 * plain text.
 */
export function useClipboardPaste(store: EditorStore, getPastePoint: () => Point): void {
    const at = useRef(getPastePoint);
    at.current = getPastePoint;

    useEffect(() => {
        const onPaste = (event: ClipboardEvent) => {
            const target = event.target as HTMLElement | null;
            // A paste into a real field belongs to that field.
            if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
            if (target?.isContentEditable) return;
            if (store.getState().editing) return;

            const data = event.clipboardData;
            if (!data) return;

            const text = data.getData("text/plain");
            const payload = text ? parsePayload(text) : null;
            if (payload) {
                event.preventDefault();
                const point = at.current();
                const { nodes, edges } = instantiate(payload, {
                    x: point.x - payload.origin.x,
                    y: point.y - payload.origin.y,
                });
                store.updatePage(
                    page => ({
                        ...page,
                        nodes: [...page.nodes, ...nodes],
                        edges: [...page.edges, ...edges],
                    }),
                    { label: "Paste" }
                );
                store.selectNodes(nodes.map(n => n.id));
                return;
            }

            const files = Array.from(data.files ?? []).filter(isImageFile);
            if (files.length > 0) {
                event.preventDefault();
                void insertImages(store, files, at.current());
                return;
            }

            if (!text.trim()) return;
            event.preventDefault();
            insertText(store, text, at.current());
        };

        window.addEventListener("paste", onPaste);
        return () => window.removeEventListener("paste", onPaste);
    }, [store]);
}

/** Drop images onto the canvas at a point; shared with the drop handler. */
export async function insertImages(
    store: EditorStore,
    files: readonly File[],
    at: Point
): Promise<void> {
    let cursor = { ...at };
    for (const file of files) {
        try {
            const image = await loadImageFile(file);
            const box = fitImageBox(image);
            const node = createNodeAt("image", cursor, {
                w: box.w,
                h: box.h,
                data: { src: image.src, alt: file.name },
            });
            store.updatePage(page => ({ ...page, nodes: [...page.nodes, node] }), {
                label: "Add image",
            });
            store.selectNodes([node.id]);
            // Stagger multiple images so they do not land on top of each other.
            cursor = { x: cursor.x + 24, y: cursor.y + 24 };
        } catch (error) {
            toast.error(error instanceof Error ? error.message : `Couldn't read ${file.name}`);
        }
    }
}

/** Import a dropped `.json` mindmap file, replacing the document. */
export async function importDocumentFile(store: EditorStore, file: File): Promise<void> {
    try {
        const parsed: unknown = JSON.parse(await file.text());
        const title = store.getState().doc.title;
        store.replaceDoc({ ...parseDoc(parsed, title), title }, { label: "Import" });
        toast.success(`Imported ${file.name}`);
    } catch {
        toast.error(`${file.name} is not a readable mindmap file`);
    }
}

/**
 * Plain text becomes a sticky note when it has several lines (that is what
 * people paste notes into) and a text label when it is a single line.
 */
function insertText(store: EditorStore, text: string, at: Point): void {
    const trimmed = text.trim();
    const multiline = trimmed.includes("\n");
    const node = createNodeAt(multiline ? "sticky" : "text", at, {
        text: trimmed.slice(0, 5000),
        ...(multiline ? {} : { w: Math.min(Math.max(trimmed.length * 8, 80), 520), h: 40 }),
    });
    store.updatePage(page => ({ ...page, nodes: [...page.nodes, node] }), {
        label: "Paste text",
    });
    store.selectNodes([node.id]);
}
