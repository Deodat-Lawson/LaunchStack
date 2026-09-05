"use client";

import type { MindmapDetail } from "./api";
import type { ThemeMode } from "../model/palette";
import { parseDoc } from "../model/serialize";
import { buildTemplate, TEMPLATE_BY_ID } from "../model/templates";
import type { MindmapDoc } from "../model/types";

/**
 * Turn a fetched row into a document the canvas can show.
 *
 * A newly created map is stored with a `templateId` and an empty document —
 * the template registry lives on the client, so building it happens here, on
 * open, for the editor and the preview alike. `seeded` tells the editor to
 * persist the result immediately, so closing the tab without touching
 * anything still leaves a real document behind.
 */
export function openMindmapDocument(mindmap: MindmapDetail): { doc: MindmapDoc; seeded: boolean } {
    const doc = parseDoc(mindmap.doc, mindmap.title);
    const empty = doc.pages.every(page => page.nodes.length === 0);
    const template = mindmap.templateId ? TEMPLATE_BY_ID[mindmap.templateId] : undefined;
    if (!empty || !template || template.id === "blank") return { doc, seeded: false };
    // Seed the board lit the way this person is working. It is stored, not
    // re-derived per viewer, so the document stays stable once shared — and it
    // is far better than handing someone in dark mode a white page.
    const mode: ThemeMode =
        typeof document !== "undefined" &&
        document.documentElement.getAttribute("data-theme") === "dark"
            ? "dark"
            : "light";
    return {
        doc: { ...buildTemplate(template.id, mindmap.title, mode), title: mindmap.title },
        seeded: true,
    };
}
