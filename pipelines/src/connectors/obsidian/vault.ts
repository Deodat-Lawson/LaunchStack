/**
 * Obsidian vault → Markdown documents.
 *
 * A vault is a folder of Markdown files plus Obsidian's own state. Notes are
 * mostly plain Markdown already; what needs translating is the Obsidian
 * dialect a reader (or a retriever) would otherwise see as noise:
 *
 * - YAML frontmatter becomes a short property list under the title, so tags
 *   and fields like `status` stay searchable.
 * - `[[Note|alias]]` wikilinks read as their text; `![[embeds]]` say what
 *   was embedded; `%% comments %%` and `^block-ids` are dropped.
 * - Fenced code is left exactly as written.
 *
 * Which files count as notes is decided here too, so the browser (which
 * reads the vault) and the server (which stores it) agree.
 */

import { createHash } from "node:crypto";

import { normalizeVaultPath } from "./paths";

const MEDIA_EXTENSIONS = new Set([
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "svg",
    "bmp",
    "avif",
    "mp3",
    "m4a",
    "wav",
    "ogg",
    "mp4",
    "webm",
    "mov",
    "pdf",
]);

/** Frontmatter keys that are Obsidian's own plumbing, not the note's content. */
const PLUMBING_KEYS = new Set([
    "title",
    "tags",
    "tag",
    "aliases",
    "alias",
    "cssclasses",
    "cssclass",
    "position",
    "publish",
]);

const MAX_LISTED_PROPERTIES = 20;

function noteBasename(path: string): string {
    const name = normalizeVaultPath(path).split("/").pop() ?? path;
    return name.replace(/\.md$/i, "");
}

export type FrontmatterValue = string | readonly string[];

export interface ParsedNote {
    readonly frontmatter: Readonly<Record<string, FrontmatterValue>>;
    readonly body: string;
}

function unquote(value: string): string {
    const trimmed = value.trim();
    if (
        trimmed.length >= 2 &&
        ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith("'") && trimmed.endsWith("'")))
    ) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

function inlineList(value: string): string[] | null {
    const trimmed = value.trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
    return trimmed.slice(1, -1).split(",").map(unquote).filter(Boolean);
}

/**
 * The frontmatter subset notes actually use: `key: value`, `key: [a, b]`,
 * and `key:` followed by `- item` lines. Anything fancier (nested maps,
 * multi-line strings) is kept as its first line rather than parsed wrong.
 */
export function parseNote(text: string): ParsedNote {
    const normalized = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(normalized);
    if (!match) return { frontmatter: {}, body: normalized };

    const frontmatter: Record<string, FrontmatterValue> = {};
    let listKey: string | null = null;
    for (const line of (match[1] ?? "").split("\n")) {
        const item = /^\s*-\s+(.*)$/.exec(line);
        if (item && listKey) {
            const current = frontmatter[listKey];
            const value = unquote(item[1] ?? "");
            if (value)
                frontmatter[listKey] = [
                    ...(typeof current === "string" || current === undefined ? [] : current),
                    value,
                ];
            continue;
        }
        const pair = /^([A-Za-z0-9_][\w -]*):\s*(.*)$/.exec(line);
        if (!pair) continue;
        const key = (pair[1] ?? "").trim();
        const raw = pair[2] ?? "";
        listKey = null;
        if (!raw.trim()) {
            listKey = key;
            frontmatter[key] = [];
            continue;
        }
        frontmatter[key] = inlineList(raw) ?? unquote(raw);
    }
    return { frontmatter, body: normalized.slice(match[0].length) };
}

/** A list field as items. Tags may be space-separated; aliases contain spaces, so only commas split them. */
function asList(value: FrontmatterValue | undefined, separator = /,/): string[] {
    if (value === undefined) return [];
    if (typeof value !== "string") return [...value];
    return value
        .split(separator)
        .map(part => part.trim())
        .filter(Boolean);
}

function stripMd(target: string): string {
    return target.replace(/\.md$/i, "");
}

function linkText(inner: string): string {
    const [target = "", alias] = inner.split("|");
    if (alias?.trim()) return alias.trim();
    const [note = "", ...anchor] = target.split("#");
    const heading = anchor.join("#").trim();
    const name = stripMd(note.trim());
    if (!heading || heading.startsWith("^")) return name || heading.replace(/^\^/, "");
    return name ? `${name} › ${heading}` : heading;
}

function embedText(inner: string): string {
    const [target = ""] = inner.split("|");
    const [file = ""] = target.split("#");
    const extension = file.trim().split(".").pop()?.toLowerCase() ?? "";
    if (MEDIA_EXTENSIONS.has(extension))
        return `[${extension === "pdf" ? "PDF" : "media"}: ${file.trim()}]`;
    return `[embedded note: ${linkText(inner)}]`;
}

/** Obsidian syntax → plain Markdown, outside fenced code. */
export function normalizeObsidianMarkdown(body: string): string {
    // Comments may span lines and fences alike; Obsidian hides them everywhere.
    const withoutComments = body.replace(/%%[\s\S]*?%%/g, "");
    const parts = withoutComments.split(/(^```[\s\S]*?^```[ \t]*$)/m);
    return parts
        .map((part, index) => {
            if (index % 2 === 1) return part; // fenced code, as written
            return part
                .replace(/!\[\[([^\]\n]+)\]\]/g, (_, inner: string) => embedText(inner))
                .replace(/\[\[([^\]\n]+)\]\]/g, (_, inner: string) => linkText(inner))
                .replace(/[ \t]+\^[A-Za-z0-9-]+[ \t]*$/gm, "");
        })
        .join("");
}

export interface RenderedNote {
    readonly title: string;
    readonly markdown: string;
    readonly tags: readonly string[];
}

export function renderNote(input: {
    readonly path: string;
    readonly text: string;
    readonly vaultName: string;
}): RenderedNote {
    const { frontmatter, body } = parseNote(input.text);
    const titleValue = frontmatter.title;
    const title =
        (typeof titleValue === "string" && titleValue.trim()) ||
        noteBasename(input.path) ||
        "Untitled";
    const tags = [...asList(frontmatter.tags, /[,\s]+/), ...asList(frontmatter.tag, /[,\s]+/)].map(
        tag => tag.replace(/^#/, "")
    );
    const aliases = [...asList(frontmatter.aliases), ...asList(frontmatter.alias)];

    const lines = [
        `# ${title}`,
        "",
        `> From the Obsidian vault "${input.vaultName}" · ${normalizeVaultPath(input.path)}`,
        "",
    ];
    const properties: string[] = [];
    if (tags.length > 0) properties.push(`- **Tags:** ${tags.join(", ")}`);
    if (aliases.length > 0) properties.push(`- **Aliases:** ${aliases.join(", ")}`);
    for (const [key, value] of Object.entries(frontmatter)) {
        if (properties.length >= MAX_LISTED_PROPERTIES) break;
        if (PLUMBING_KEYS.has(key.toLowerCase())) continue;
        const text = typeof value === "string" ? value : value.join(", ");
        if (text.trim()) properties.push(`- **${key}:** ${text.trim()}`);
    }
    if (properties.length > 0) lines.push(...properties, "");

    const normalized = normalizeObsidianMarkdown(body).trim();
    if (normalized) lines.push(normalized, "");
    return { title, markdown: lines.join("\n"), tags };
}

/** Change identity: the note's own bytes, so an untouched note re-imports as a no-op. */
export function noteFingerprint(text: string): string {
    return `sha256:${createHash("sha256").update(text, "utf-8").digest("hex")}`;
}
