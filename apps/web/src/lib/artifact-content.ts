/**
 * Shared helpers for imported Claude artifacts.
 *
 * Everything here is pure string work so the same module runs in the import
 * API route and in the browser (the import dialog previews the detected type
 * before anything is sent).
 */

export const ARTIFACT_TYPES = ["html", "svg", "markdown", "mermaid", "react", "code"] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

/** Matches the website-upload cap; an artifact is a single self-contained file. */
export const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;

/** How much tag-stripped text the list search indexes per artifact. */
const SEARCH_TEXT_LIMIT = 20000;

const MERMAID_OPENERS =
    /^\s*(?:%%\{[\s\S]*?\}%%\s*)?(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|sankey|xychart)\b/;

const CODE_OPENERS =
    /^\s*(?:#!\/|#include\b|package\s+\w|using\s+\w|def\s+\w|class\s+\w|function\s+\w|(?:public|private|protected)\s|(?:const|let|var)\s+\w+\s*=|fn\s+\w|func\s+\w)/;

/**
 * Best-effort classification of a pasted or fetched artifact body.
 *
 * Order matters: full documents first (cheap, unambiguous prefixes), then
 * Mermaid (whose sources contain no angle brackets at all), then anything
 * tag-bearing as HTML, then React/code, and Markdown as the prose fallback.
 * The import dialog lets the user override the guess, so a miss here costs a
 * click, not a broken render.
 */
export function detectArtifactType(content: string): ArtifactType {
    const trimmed = content.trimStart();
    const lower = trimmed.slice(0, 512).toLowerCase();

    if (lower.startsWith("<!doctype") || lower.startsWith("<html")) return "html";
    if (lower.startsWith("<svg") || (lower.startsWith("<?xml") && lower.includes("<svg"))) {
        return "svg";
    }
    if (MERMAID_OPENERS.test(trimmed)) return "mermaid";
    if (/<(head|body|div|script|style|main|section|canvas|iframe)\b/i.test(trimmed)) return "html";

    const importsReact = /(?:^|\n)\s*import\s[^;\n]*from\s+["']react["']/.test(trimmed);
    const hasJsx = /<[A-Z][A-Za-z0-9]*[\s/>]/.test(trimmed);
    const hasModuleSyntax = /(?:^|\n)\s*(?:import\s|export\s+default\s)/.test(trimmed);
    if (importsReact || (hasModuleSyntax && hasJsx)) return "react";

    if (CODE_OPENERS.test(trimmed)) return "code";
    return "markdown";
}

/**
 * Pull a human title out of the body: `<title>` for documents, the SVG
 * `<title>` element, or the first Markdown heading. Returns null when nothing
 * usable is found so the caller can fall back to its own default.
 */
export function deriveArtifactTitle(content: string, type: ArtifactType): string | null {
    let raw: string | undefined;
    if (type === "html") {
        raw = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(content)?.[1];
        raw ??= /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(content)?.[1]?.replace(/<[^>]+>/g, "");
    } else if (type === "svg") {
        raw = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(content)?.[1];
    } else if (type === "markdown") {
        raw = /^#{1,3}\s+(.+)$/m.exec(content)?.[1];
    }
    const title = raw?.replace(/\s+/g, " ").trim();
    return title ? title.slice(0, 300) : null;
}

/**
 * A link to an artifact hosted on claude.ai (share links, published pages).
 * These render client-side behind bot protection, so the server cannot pull
 * the artifact body out of them — the UI asks for a paste/upload instead.
 */
export function isClaudeHostedUrl(url: string): boolean {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return host === "claude.ai" || host.endsWith(".claude.ai") || host === "claude.site";
    } catch {
        return false;
    }
}

/** Tag-stripped body text for the list view's ILIKE search. */
export function artifactSearchText(content: string): string {
    return content
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, SEARCH_TEXT_LIMIT);
}

/** File extension the download route and the export button both use. */
export function artifactFileExtension(type: ArtifactType): string {
    switch (type) {
        case "html":
            return "html";
        case "svg":
            return "svg";
        case "markdown":
            return "md";
        case "mermaid":
            return "mmd";
        case "react":
            return "tsx";
        default:
            return "txt";
    }
}
