/** @jest-environment jsdom */

import React from "react";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";

import { exportSvg } from "../lib/export";
import { createNode } from "../model/factory";
import { EditorStore } from "../model/store";
import { buildTemplate } from "../model/templates";
import type { MindmapDoc } from "../model/types";
import { Canvas } from "../ui/Canvas";
import { EditorProvider } from "../ui/EditorContext";
import { MindmapPreview } from "../ui/MindmapPreview";

/**
 * Two canvases on one page must not share an `id`.
 *
 * Studio keeps hidden panes mounted, so a map's read-only preview and its
 * editor are routinely in the document together, drawing the same nodes. A
 * `url(#…)` reference resolves to the *first* element with that id in the
 * whole document; when every canvas defined `#lswmm-shadow`, the editor's
 * central topic — the one shadowed shape — pointed into the hidden preview and
 * Chrome painted nothing.
 *
 * The sweep is generic on purpose: arrowheads are geometry, not `<marker>`s,
 * and nothing uses a gradient today, but any `url(#…)` or `href="#…"` added
 * later is held to the same rule.
 */

beforeAll(() => {
    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
        return {
            x: 0,
            y: 0,
            left: 0,
            top: 0,
            width: 1000,
            height: 700,
            right: 1000,
            bottom: 700,
            toJSON: () => ({}),
        } as DOMRect;
    };
    global.ResizeObserver = class {
        observe() {
            /* jsdom never resizes */
        }
        unobserve() {
            /* no-op */
        }
        disconnect() {
            /* no-op */
        }
    } as unknown as typeof ResizeObserver;
    // Text measurement falls back to its estimate without a 2D context.
    HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

const PIXEL =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** The Mindmap template, plus an image so a clip path is drawn too. */
function sampleDoc(): MindmapDoc {
    const doc = buildTemplate("mindmap", "Ids");
    const page = doc.pages[0]!;
    const image = createNode({
        shape: "image",
        x: -400,
        y: -300,
        w: 120,
        h: 80,
        data: { src: PIXEL },
    });
    return {
        ...doc,
        settings: { ...doc.settings, showGrid: true },
        pages: [
            {
                ...page,
                background: { ...page.background, pattern: "dots", spacing: 20 },
                nodes: [...page.nodes, image],
            },
            ...doc.pages.slice(1),
        ],
    };
}

/** Every `#id` an element points at, from `url(#…)` paint/filter/clip values and `href`s. */
function references(root: Element): string[] {
    const out: string[] = [];
    for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
        for (const attr of Array.from(el.attributes)) {
            for (const m of attr.value.matchAll(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g)) {
                out.push(m[1]!);
            }
            if (
                (attr.name === "href" || attr.name === "xlink:href") &&
                attr.value.startsWith("#")
            ) {
                out.push(attr.value.slice(1));
            }
        }
    }
    return out;
}

function idsIn(root: Element): string[] {
    return Array.from(root.querySelectorAll("[id]")).map(el => el.id);
}

function mountBoth() {
    const doc = sampleDoc();
    const store = new EditorStore(doc);
    store.setViewport({ x: -500, y: -400, zoom: 1 });
    // The preview first and hidden, as Studio leaves it when the editor's tab
    // is brought forward: it is the one `getElementById` would find.
    const view = render(
        <>
            <div data-testid="preview-pane" style={{ display: "none" }}>
                <MindmapPreview doc={doc} />
            </div>
            <div data-testid="editor-pane">
                <EditorProvider store={store}>
                    <Canvas callbacks={{ onContextMenuAt: jest.fn(), onEditText: jest.fn() }} />
                </EditorProvider>
            </div>
        </>
    );
    const preview = view.getByTestId("preview-pane").querySelector("svg")!;
    const editor = view.getByTestId("editor-pane").querySelector("svg")!;
    return { preview, editor };
}

describe("canvas ids", () => {
    it("draws a shadow filter, a grid pattern and an image clip on both canvases", () => {
        const { preview, editor } = mountBoth();
        for (const svg of [preview, editor]) {
            expect(svg.querySelector("filter[id]")).not.toBeNull();
            expect(svg.querySelector("pattern[id]")).not.toBeNull();
            expect(svg.querySelector("clipPath[id]")).not.toBeNull();
            // The central topic is the shape that wears the shadow.
            expect(svg.querySelector("[filter]")).not.toBeNull();
        }
    });

    it("gives the two canvases disjoint ids", () => {
        const { preview, editor } = mountBoth();
        const previewIds = idsIn(preview);
        const editorIds = new Set(idsIn(editor));
        expect(previewIds.length).toBeGreaterThan(0);
        expect(previewIds.filter(id => editorIds.has(id))).toEqual([]);
        for (const tag of ["filter", "pattern", "clipPath"]) {
            expect(preview.querySelector(tag)!.id).not.toBe(editor.querySelector(tag)!.id);
        }
    });

    it("resolves every reference inside the canvas that makes it", () => {
        const { preview, editor } = mountBoth();
        for (const svg of [preview, editor]) {
            const refs = references(svg);
            expect(refs.length).toBeGreaterThan(0);
            for (const ref of refs) {
                // What the browser does with `url(#…)`: first match in the page.
                const target = document.getElementById(ref);
                expect({ ref, resolved: target !== null && svg.contains(target) }).toEqual({
                    ref,
                    resolved: true,
                });
            }
        }
    });

    it("exports a file whose references resolve inside it", () => {
        const { editor } = mountBoth();
        // Read as text: the file is what a PNG rasteriser or another app gets,
        // with no page around it to resolve anything against.
        const file = exportSvg(editor);
        const ids = new Set(Array.from(file.matchAll(/\sid="([^"]+)"/g), m => m[1]));
        const refs = Array.from(file.matchAll(/url\(#([^)]+)\)/g), m => m[1]);
        expect(refs).toContain(editor.querySelector("filter")!.id);
        expect(refs).toContain(editor.querySelector("clipPath")!.id);
        expect(refs.filter(ref => !ids.has(ref))).toEqual([]);
    });
});
