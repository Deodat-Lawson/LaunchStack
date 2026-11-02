/**
 * Mentions in a chat message.
 *
 * The composer writes a chip into the message as a machine link:
 * `[Source: Title](#launchstack-source-d12)` for a workspace source,
 * `[Folder: Name](#launchstack-folder-key)`, `[Conversation: Title](#launchstack-thread-id)`,
 * and `[name.txt](<upload url>)` for a file uploaded with the message. That is
 * the stored form — the transcript renders it, `recallText` strips it, old
 * chats hold it — and it is not what a model should read. Both ends render it
 * instead: the route turns each link into the name of what it stands for, so
 * a source reads `"Title" (d12)`, the same form the source tools and the
 * citations use, and `#launchstack-source-d12` never reaches an embedding or
 * a model.
 *
 * Everything here is pure. The route supplies the titles (chat-mentions.ts).
 */

export type MentionKind = "source" | "folder" | "thread";

export interface Mention {
    kind: MentionKind;
    /** What the person saw on the chip: their own text, not the database's title. */
    label: string;
    /** The source id (`d12`, `m7`), folder key or thread id the link carried, decoded. */
    ref: string;
    /** Where the link sits in the text. */
    start: number;
    end: number;
}

/** A chip as the composer writes it; the label may escape `]`, `[` and `\`. */
const MENTION =
    /\[(Source|Folder|Conversation): ((?:\\.|[^\]\\\n]){1,300})\]\(#launchstack-(source|folder|thread)-([^)\s]+)\)/g;

/** A file uploaded with the message, as the composer links it: `[name](url)`. */
const UPLOAD_LINK = /\[((?:\\.|[^\]\\\n]){1,300})\]\((https?:\/\/[^)\s]+)\)/g;

/** The longest a name is quoted in the words; a title is a name, not a paragraph. */
export const MENTION_NAME_CHARS = 120;

function unescapeLabel(raw: string): string {
    return raw.replace(/\\(.)/g, "$1");
}

function decodeRef(raw: string): string {
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

/** Every chip in the text, in order. */
export function parseMentions(text: string): Mention[] {
    const out: Mention[] = [];
    for (const match of text.matchAll(MENTION)) {
        const [whole, , label, hashKind, ref] = match;
        out.push({
            // The hash names what the link points at; the word before the
            // colon is only what the chip said.
            kind: hashKind as MentionKind,
            label: unescapeLabel(label ?? "").trim(),
            ref: decodeRef(ref ?? ""),
            start: match.index ?? 0,
            end: (match.index ?? 0) + whole.length,
        });
    }
    return out;
}

/** The refs of every source chip, in order, without repeats. */
export function mentionedSourceRefs(text: string): string[] {
    const seen = new Set<string>();
    for (const mention of parseMentions(text)) {
        if (mention.kind === "source") seen.add(mention.ref);
    }
    return [...seen];
}

/**
 * The text with every chip replaced by what `render` returns for it; `null`
 * keeps the chip's label and drops the link. Text between chips is untouched,
 * including the transcript's own `[Source message](#chat-message-…)` marker.
 */
export function renderMentions(text: string, render: (mention: Mention) => string | null): string {
    const mentions = parseMentions(text);
    if (mentions.length === 0) return text;
    let out = "";
    let at = 0;
    for (const mention of mentions) {
        out += text.slice(at, mention.start);
        out += render(mention) ?? mention.label;
        at = mention.end;
    }
    return out + text.slice(at);
}

/** The text with every chip reduced to its label: for a search query, where the link is noise. */
export function mentionsAsLabels(text: string): string {
    return renderMentions(text, () => null);
}

/**
 * The text with each upload's link replaced by `"name" (attached)`. Only the
 * urls given are replaced: a link the person typed to somewhere else stays.
 */
export function renderUploadLinks(
    text: string,
    uploads: readonly { name: string; url: string }[]
): string {
    if (uploads.length === 0 || !text.includes("](")) return text;
    const names = new Map(uploads.map(upload => [upload.url, upload.name]));
    return text.replace(UPLOAD_LINK, (whole, label: string, url: string) => {
        const name = names.get(url);
        return name === undefined ? whole : `${quoteName(name || unescapeLabel(label))} (attached)`;
    });
}

/**
 * A name as the words quote it: one line, straight quotes around it, inner
 * double quotes turned to single ones so the pair stays a pair, cut at
 * `MENTION_NAME_CHARS`.
 */
export function quoteName(name: string): string {
    const flat = name.replace(/\s+/g, " ").replace(/"/g, "'").trim();
    const cut =
        flat.length > MENTION_NAME_CHARS ? `${flat.slice(0, MENTION_NAME_CHARS - 1)}…` : flat;
    return `"${cut}"`;
}

/** How a workspace source reads in the words: `"Title" (d12)`, the source tools' own form. */
export function sourceMentionText(title: string, label: string): string {
    return `${quoteName(title)} (${label})`;
}

/** A source the person pointed at but cannot open here (deleted, moved, or never theirs). */
export function unavailableMentionText(label: string): string {
    return `${quoteName(label)} (unavailable)`;
}

/** A folder chip: its files are in the message as documents. */
export function folderMentionText(label: string): string {
    return `the folder ${quoteName(label)}`;
}

/** A conversation chip: its transcript is in the history as a referenced conversation. */
export function threadMentionText(label: string): string {
    return `the conversation ${quoteName(label)}`;
}

/**
 * The text with every chip removed outright — source, folder and conversation
 * chips, and the links of the uploads given — so what is left is what the
 * person typed. Empty when they sent chips alone.
 */
export function stripMentions(text: string, uploadUrls: readonly string[] = []): string {
    const withoutChips = renderMentions(text, () => "");
    if (uploadUrls.length === 0 || !withoutChips.includes("](")) return withoutChips;
    const urls = new Set(uploadUrls);
    return withoutChips.replace(UPLOAD_LINK, (whole, _label: string, url: string) =>
        urls.has(url) ? "" : whole
    );
}

/**
 * A renderer for the client, which knows the workspace's sources: a source
 * chip reads `"Title" (d12)` when its source has a document id, else its
 * label alone; folders and conversations read as everywhere else.
 */
export function renderMentionsFor(
    sources: readonly { id: string; title: string; documentId?: number }[]
): (text: string) => string {
    const byId = new Map(sources.map(source => [source.id, source]));
    return text =>
        renderMentions(text, mention => {
            switch (mention.kind) {
                case "source": {
                    const source = byId.get(mention.ref);
                    return source?.documentId
                        ? sourceMentionText(source.title, `d${source.documentId}`)
                        : quoteName(source?.title ?? mention.label);
                }
                case "folder":
                    return folderMentionText(mention.label);
                case "thread":
                    return threadMentionText(mention.label);
            }
        });
}
