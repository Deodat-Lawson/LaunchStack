/**
 * `@`-mentions: pages, people, and dates.
 *
 * All three share one node and one suggestion trigger, because in Notion they
 * share one menu — typing `@` offers pages, teammates, and "Today" in the same
 * list. The `kind` attribute is what the renderer switches on.
 */

import Mention from "@tiptap/extension-mention";
import { mergeAttributes } from "@tiptap/core";

export type MentionKind = "page" | "person" | "date";

export interface MentionAttrs {
    id: string;
    label: string;
    kind: MentionKind;
    /** ISO date for `kind: "date"`; null otherwise. */
    date?: string | null;
    /** Reminder offset in minutes before `date`, when one is set. */
    reminder?: number | null;
    icon?: string | null;
}

/** Human-readable form of a date mention: "Today", "Tomorrow", or the date. */
export function formatMentionDate(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;

    const today = new Date();
    const startOfDay = (value: Date) =>
        new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
    const days = Math.round((startOfDay(date) - startOfDay(today)) / 86_400_000);

    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    if (days === -1) return "Yesterday";

    return date.toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
    });
}

export const NotionMention = Mention.extend({
    name: "mention",

    addAttributes() {
        return {
            id: { default: null },
            label: { default: "" },
            kind: { default: "page" },
            date: { default: null },
            reminder: { default: null },
            icon: { default: null },
        };
    },

    parseHTML() {
        return [{ tag: "span[data-mention]" }];
    },

    renderHTML({ node, HTMLAttributes }) {
        const kind = String(node.attrs.kind ?? "page");
        const label =
            kind === "date" && typeof node.attrs.date === "string"
                ? formatMentionDate(node.attrs.date)
                : String(node.attrs.label ?? "");

        return [
            "span",
            mergeAttributes(HTMLAttributes, {
                "data-mention": "",
                "data-kind": kind,
                "data-id": String(node.attrs.id ?? ""),
                class: `ntn-mention ntn-mention--${kind}`,
            }),
            kind === "person" ? `@${label}` : label,
        ];
    },

    renderText({ node }) {
        const kind = String(node.attrs.kind ?? "page");
        if (kind === "date" && typeof node.attrs.date === "string") {
            return formatMentionDate(node.attrs.date);
        }
        return `${kind === "person" ? "@" : ""}${String(node.attrs.label ?? "")}`;
    },
});
