/**
 * Toggle lists and toggle headings.
 *
 * Both are the same node — Tiptap's `details` — distinguished by a
 * `headingLevel` attribute. Notion lists them as separate blocks, but
 * structurally a toggle heading is a toggle whose summary renders at heading
 * size, so "turn this toggle into a toggle heading" is an attribute change
 * rather than a re-parse.
 */

import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        notionToggle: {
            /** Wrap the current block in a toggle, optionally as a heading. */
            setToggle: (attrs?: { headingLevel?: number | null }) => ReturnType;
            /** Change an existing toggle's heading level (null = plain toggle). */
            setToggleHeadingLevel: (level: number | null) => ReturnType;
        };
    }
}

/** Inline chevron; CSS rotates it when the toggle is open. */
const CHEVRON_SVG = [
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none"',
    ' stroke="currentColor" stroke-width="2.5" stroke-linecap="round"',
    ' stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
].join("");

export const NotionDetails = Details.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            /** 1–3 renders the summary as a heading; null is a plain toggle. */
            headingLevel: {
                default: null,
                parseHTML: (element) => {
                    const raw = element.getAttribute("data-heading-level");
                    return raw ? Number.parseInt(raw, 10) : null;
                },
                renderHTML: (attributes) =>
                    attributes.headingLevel
                        ? { "data-heading-level": String(attributes.headingLevel) }
                        : {},
            },
        };
    },

    addCommands() {
        const parent = this.parent?.();
        return {
            ...parent,
            setToggle:
                (attrs) =>
                ({ chain }) =>
                    chain()
                        .setDetails()
                        .updateAttributes(this.name, {
                            headingLevel: attrs?.headingLevel ?? null,
                        })
                        .run(),

            setToggleHeadingLevel:
                (level) =>
                ({ commands }) =>
                    commands.updateAttributes(this.name, { headingLevel: level }),
        };
    },

    addKeyboardShortcuts() {
        return {
            ...this.parent?.(),
            // Notion's shortcut for a plain toggle list.
            "Mod-Shift-7": ({ editor }) => editor.commands.setToggle(),
        };
    },
}).configure({
    persist: true,
    openClassName: "is-open",
    HTMLAttributes: { class: "ntn-toggle" },
    renderToggleButton: ({ element }) => {
        element.className = "ntn-toggle__chevron";
        element.innerHTML = CHEVRON_SVG;
    },
});

export const NotionDetailsSummary = DetailsSummary.configure({
    HTMLAttributes: { class: "ntn-toggle__summary" },
});

export const NotionDetailsContent = DetailsContent.configure({
    HTMLAttributes: { class: "ntn-toggle__content" },
});
