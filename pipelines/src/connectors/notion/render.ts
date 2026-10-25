/**
 * Notion page → one Markdown document.
 *
 * The body is Notion's own enhanced Markdown (`GET /pages/{id}/markdown`);
 * this module adds what that endpoint leaves out — the title, a provenance
 * line with a link back to Notion, and a database row's properties, which
 * are the most searchable part of a row and live outside its body.
 */

import type { NotionPage, NotionPropertyValue, NotionRichText } from "./client";

export const UNTITLED_PAGE = "Untitled";

function richText(value: unknown): string {
    if (!Array.isArray(value)) return "";
    return (value as readonly NotionRichText[])
        .map(part => part.plain_text ?? "")
        .join("")
        .trim();
}

function named(value: unknown): string | null {
    if (typeof value !== "object" || value === null) return null;
    const name = (value as { name?: unknown }).name;
    return typeof name === "string" && name.trim() ? name.trim() : null;
}

function dateText(value: unknown): string | null {
    if (typeof value !== "object" || value === null) return null;
    const { start, end } = value as { start?: unknown; end?: unknown };
    if (typeof start !== "string") return null;
    return typeof end === "string" && end ? `${start} → ${end}` : start;
}

/** The page's title property, as plain text. */
export function pageTitle(page: NotionPage): string {
    for (const value of Object.values(page.properties ?? {})) {
        if (value.type === "title") {
            const title = richText(value.title);
            if (title) return title;
        }
    }
    return UNTITLED_PAGE;
}

/**
 * A property value as one line of text, or null when it is empty or a kind
 * that reads as noise out of context (relations, rollups, files, buttons).
 */
export function propertyText(value: NotionPropertyValue): string | null {
    switch (value.type) {
        case "rich_text":
            return richText(value.rich_text) || null;
        case "number":
            return typeof value.number === "number" ? String(value.number) : null;
        case "select":
        case "status":
            return named(value[value.type]);
        case "multi_select": {
            const options = Array.isArray(value.multi_select) ? value.multi_select : [];
            const names = options.map(named).filter((name): name is string => name !== null);
            return names.length > 0 ? names.join(", ") : null;
        }
        case "date":
            return dateText(value.date);
        case "people": {
            const people = Array.isArray(value.people) ? value.people : [];
            const names = people.map(named).filter((name): name is string => name !== null);
            return names.length > 0 ? names.join(", ") : null;
        }
        case "checkbox":
            return typeof value.checkbox === "boolean" ? (value.checkbox ? "Yes" : "No") : null;
        case "url":
        case "email":
        case "phone_number": {
            const text = value[value.type];
            return typeof text === "string" && text ? text : null;
        }
        case "created_time":
        case "last_edited_time": {
            const time = value[value.type];
            return typeof time === "string" ? time : null;
        }
        case "unique_id": {
            const id = value.unique_id as { prefix?: unknown; number?: unknown } | null | undefined;
            if (typeof id?.number !== "number") return null;
            return typeof id.prefix === "string" && id.prefix
                ? `${id.prefix}-${id.number}`
                : String(id.number);
        }
        case "formula": {
            const formula = value.formula as Record<string, unknown> | null | undefined;
            if (!formula || typeof formula.type !== "string") return null;
            const result = formula[formula.type];
            if (formula.type === "date") return dateText(result);
            if (typeof result === "string") return result || null;
            if (typeof result === "number") return String(result);
            if (typeof result === "boolean") return result ? "Yes" : "No";
            return null;
        }
        default:
            return null;
    }
}

/** True for a row in a Notion database (its parent is a data source). */
export function isDatabaseRow(page: NotionPage): boolean {
    const type = page.parent?.type;
    return type === "data_source_id" || type === "database_id";
}

/**
 * Change identity from search metadata alone, so an unchanged page is
 * skipped without fetching its content. Not a hash of the Markdown: Notion
 * re-signs file URLs on every read, so the body changes when the page
 * does not.
 */
export function pageFingerprint(page: NotionPage): string {
    return `notion:edited:${page.last_edited_time}`;
}

function compactId(id: string): string {
    return id.replace(/-/g, "").toLowerCase();
}

/**
 * Splice subtrees fetched for `unknown_block_ids` back where Notion left an
 * `<unknown url="…#<block>"/>` placeholder; a subtree whose placeholder
 * cannot be found is appended so its text is not lost.
 */
export function mergeUnknownSubtrees(
    markdown: string,
    subtrees: ReadonlyMap<string, string>
): string {
    let merged = markdown;
    const appended: string[] = [];
    for (const [blockId, subtree] of subtrees) {
        const target = compactId(blockId);
        let replaced = false;
        merged = merged.replace(/<unknown\b[^>]*\/>/g, tag => {
            if (replaced) return tag;
            const url = /url="([^"]*)"/.exec(tag)?.[1] ?? "";
            const fragment = url.split("#")[1] ?? "";
            if (compactId(fragment) !== target) return tag;
            replaced = true;
            return subtree;
        });
        if (!replaced) appended.push(subtree);
    }
    return appended.length > 0 ? `${merged}\n\n${appended.join("\n\n")}` : merged;
}

export interface RenderPageOptions {
    /** The Notion workspace's name, for the provenance line. */
    readonly workspaceName?: string | null;
}

export function renderPage(
    page: NotionPage,
    body: string,
    options: RenderPageOptions = {}
): string {
    const title = pageTitle(page);
    const lines: string[] = [`# ${title}`, ""];

    const provenance = [
        options.workspaceName ? `From Notion (${options.workspaceName})` : "From Notion",
        page.url ? `[Open in Notion](${page.url})` : null,
        `last edited ${page.last_edited_time}`,
    ].filter((part): part is string => Boolean(part));
    lines.push(`> ${provenance.join(" · ")}`, "");

    if (isDatabaseRow(page)) {
        const properties: string[] = [];
        for (const [name, value] of Object.entries(page.properties ?? {})) {
            if (value.type === "title") continue;
            const text = propertyText(value);
            if (text) properties.push(`- **${name}:** ${text}`);
        }
        if (properties.length > 0) lines.push(...properties, "");
    }

    const trimmed = body.trim();
    if (trimmed) lines.push(trimmed, "");
    return lines.join("\n");
}
