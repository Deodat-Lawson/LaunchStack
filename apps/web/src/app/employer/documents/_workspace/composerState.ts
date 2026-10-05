import type { ComposerSend, EphemeralAttachment } from "./types";
import type { JSONContent } from "@tiptap/react";

export type ComposerAttachmentAvailability = "checking" | "available" | "unavailable" | "unknown";

/** HEAD never downloads attachment contents; CORS and unsupported HEAD remain unknown. */
export async function checkComposerAttachmentAvailability(
    url: string,
    signal: AbortSignal
): Promise<ComposerAttachmentAvailability> {
    if (signal.aborted) return "unknown";
    const request = new AbortController();
    const abort = () => request.abort();
    signal.addEventListener("abort", abort, { once: true });
    let stopRequest: (() => void) | undefined;
    const stopped = new Promise<null>(resolve => {
        stopRequest = () => resolve(null);
        request.signal.addEventListener("abort", stopRequest, { once: true });
    });
    const timeout = setTimeout(abort, 8_000);
    try {
        const response = await Promise.race([
            fetch(url, {
                method: "HEAD",
                cache: "no-store",
                credentials: "same-origin",
                signal: request.signal,
            }),
            stopped,
        ]);
        if (!response || request.signal.aborted) return "unknown";
        if (response.status === 404 || response.status === 410) return "unavailable";
        return response.ok ? "available" : "unknown";
    } catch {
        return "unknown";
    } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        if (stopRequest) request.signal.removeEventListener("abort", stopRequest);
    }
}

/** Recall excludes source, conversation, attachment and quotation chips without dropping user text. */
export function composerDocumentWithoutContext(document: JSONContent): JSONContent {
    return {
        ...document,
        ...(document.content
            ? {
                  content: document.content
                      .filter(node => node.type !== "composerContext")
                      .map(composerDocumentWithoutContext),
              }
            : {}),
    };
}

export const COMPOSER_MAX_CHARACTERS = 120_000;
export const LARGE_PASTE_BYTES = 32 * 1024;
export const ATTACH_MAX_COUNT = 100;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const FILE_MAX_BYTES = 50 * 1024 * 1024;
export const TOTAL_IMAGE_MAX_BYTES = 80 * 1024 * 1024;

export interface ComposerDraft {
    text: string;
    attachments: EphemeralAttachment[];
    refs: string[];
    modelRoute?: ComposerSend["modelRoute"];
    modelRoutes?: ComposerSend["modelRoutes"];
    threadRefs?: string[];
    reasoningEffort?: string;
    chatMode?: ComposerSend["chatMode"];
    webSearch: boolean;
    thinking: boolean;
    agentKey: string | null;
    richContent?: unknown;
    pendingFiles?: string[];
}

export interface PromptStash extends ComposerDraft {
    id: string;
    savedAt: number;
    failedSend?: boolean;
}

export interface ComposerPreferences {
    sendKey: "enter" | "mod-enter";
    favorites: string[];
    followUp?: "queue" | "interrupt";
    editorMode?: "plain" | "rich";
    modelRoute?: ComposerSend["modelRoute"];
    reasoningEffort?: string;
}

export function modelSearchMatches(label: string, query: string): boolean {
    const haystack = label.toLowerCase();
    return query
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .every(token => {
            let cursor = 0;
            for (const character of haystack) if (character === token[cursor]) cursor++;
            return cursor === token.length;
        });
}

const TEXT_MIMES = new Set([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/json",
    "application/xml",
    "application/x-ndjson",
    "application/yaml",
    "application/x-yaml",
    "application/rtf",
]);
const TEXT_EXTS = new Set([
    "pdf",
    "doc",
    "docx",
    "txt",
    "md",
    "markdown",
    "csv",
    "tsv",
    "json",
    "jsonl",
    "xml",
    "yaml",
    "yml",
    "rtf",
    "log",
    "html",
    "htm",
]);

const IMAGE_EXT_MIMES: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    avif: "image/avif",
    bmp: "image/bmp",
    tif: "image/tiff",
    tiff: "image/tiff",
    heic: "image/heic",
    heif: "image/heif",
};

/** File pickers and clipboard transfers can omit a known image's MIME type. */
export function composerFileMime(file: Pick<File, "name" | "type">): string {
    if (file.type && file.type !== "application/octet-stream") return file.type;
    return IMAGE_EXT_MIMES[file.name.split(".").at(-1)?.toLowerCase() ?? ""] ?? file.type;
}

export function kindForFile(file: Pick<File, "name" | "type">): "image" | "text" | null {
    if (composerFileMime(file).startsWith("image/")) return "image";
    if (file.type.startsWith("text/") || TEXT_MIMES.has(file.type)) return "text";
    return TEXT_EXTS.has(file.name.split(".").at(-1)?.toLowerCase() ?? "") ? "text" : null;
}

export function shouldAttachPaste(paste: string, current: string, selectedLength = 0): boolean {
    // Blob uses UTF-8, so multibyte text is measured in bytes rather than characters.
    return (
        new Blob([paste]).size >= LARGE_PASTE_BYTES ||
        current.length - selectedLength + paste.length > COMPOSER_MAX_CHARACTERS
    );
}

export function listContinuation(
    text: string,
    caret: number
): { start: number; end: number; replacement: string } | null {
    if (caret < text.length && text[caret] !== "\n") return null;
    const start = text.lastIndexOf("\n", caret - 1) + 1;
    const line = text.slice(start, caret);
    const match = /^(\s*)([-*+]|\d+\.)(\s+)(?:\[([ xX])\]\s+)?(.*)$/.exec(line);
    if (!match) return null;
    if (!match[5]?.trim()) return { start, end: caret, replacement: "" };
    const marker = /^\d/.test(match[2]!) ? `${parseInt(match[2]!, 10) + 1}.` : match[2]!;
    return {
        start: caret,
        end: caret,
        replacement: `\n${match[1]}${marker} ${match[4] !== undefined ? "[ ] " : ""}`,
    };
}

export function readComposerStorage<T>(key: string | undefined, fallback: T): T {
    if (!key || typeof window === "undefined") return fallback;
    try {
        const value = window.localStorage.getItem(key);
        return value ? (JSON.parse(value) as T) : fallback;
    } catch {
        return fallback;
    }
}

export function writeComposerStorage(key: string | undefined, value: unknown): boolean {
    if (!key || typeof window === "undefined") return true;
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}

export function isComposerDraft(value: unknown): value is ComposerDraft {
    if (!value || typeof value !== "object") return false;
    const draft = value as Partial<ComposerDraft>;
    return (
        typeof draft.text === "string" &&
        Array.isArray(draft.refs) &&
        draft.refs.every(ref => typeof ref === "string") &&
        Array.isArray(draft.attachments) &&
        draft.attachments.every(
            item =>
                item &&
                typeof item.id === "string" &&
                typeof item.name === "string" &&
                typeof item.mimeType === "string" &&
                typeof item.url === "string" &&
                typeof item.size === "number" &&
                Number.isFinite(item.size) &&
                item.size >= 0 &&
                (item.kind === "text" || item.kind === "image")
        ) &&
        typeof draft.webSearch === "boolean" &&
        typeof draft.thinking === "boolean" &&
        (draft.agentKey === null || typeof draft.agentKey === "string") &&
        (draft.modelRoutes === undefined ||
            (Array.isArray(draft.modelRoutes) &&
                draft.modelRoutes.every(route =>
                    ["default", "fast", "reasoning", "vision"].includes(route)
                ))) &&
        (draft.threadRefs === undefined ||
            (Array.isArray(draft.threadRefs) &&
                draft.threadRefs.every(id => typeof id === "string"))) &&
        (draft.pendingFiles === undefined ||
            (Array.isArray(draft.pendingFiles) &&
                draft.pendingFiles.every(name => typeof name === "string")))
    );
}

/** Conservative in hidden/test layouts; on screen, measure actual wrapped lines. */
export function caretAtVisualBoundary(
    textarea: HTMLTextAreaElement,
    direction: "up" | "down"
): boolean {
    if (textarea.selectionStart !== textarea.selectionEnd) return false;
    const caret = textarea.selectionStart;
    if (direction === "up" && caret === 0) return true;
    if (direction === "down" && caret === textarea.value.length) return true;
    if (!textarea.clientWidth) return false;
    const mirror = document.createElement("div");
    const style = window.getComputedStyle(textarea);
    for (const property of [
        "font",
        "lineHeight",
        "letterSpacing",
        "padding",
        "border",
        "boxSizing",
        "wordSpacing",
    ] as const) {
        mirror.style[property] = style[property];
    }
    Object.assign(mirror.style, {
        position: "fixed",
        visibility: "hidden",
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
        width: `${textarea.clientWidth}px`,
    });
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    const end = document.createElement("span");
    end.textContent = "\u200b";
    mirror.append(
        document.createTextNode(textarea.value.slice(0, caret)),
        marker,
        document.createTextNode(textarea.value.slice(caret)),
        end
    );
    document.body.append(mirror);
    const firstLineTop = parseFloat(style.paddingTop) || 0;
    const result =
        direction === "up" ? marker.offsetTop <= firstLineTop : marker.offsetTop === end.offsetTop;
    mirror.remove();
    return result;
}
