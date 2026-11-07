/**
 * What a chip in the person's words becomes in the message the model reads.
 *
 * The composer writes a source chip as `[Source: Title](#launchstack-source-d12)`
 * (lib/source-mentions.ts). Here the route resolves each one against what this
 * turn admitted — the document ids `scopedDocumentWhere` let through — and
 * renders it as `"Title" (d12)`, the name the `<document id="d12">` block and
 * the source tools use, so the mention and the block share an id instead of a
 * title. A source the caller cannot open here reads `"Label" (unavailable)`:
 * the label is the person's own text, so nothing new reaches the prompt.
 *
 * History is rendered more loosely: an earlier turn's source may be outside
 * this turn's scope and still have been theirs, so it keeps its id and label.
 */

import {
    folderMentionText,
    mentionedSourceRefs,
    quoteName,
    renderMentions,
    renderUploadLinks,
    sourceMentionText,
    threadMentionText,
    unavailableMentionText,
    type Mention,
} from "~/lib/source-mentions";
import { labelDocumentId, sourceLabel } from "~/lib/source-labels";

import type { ScopeFile } from "./chat-sources";

/** What the client says a chip's ref maps to (`useChatRuntime` does the same lookup for `refs`). */
export interface SourceMention {
    ref: string;
    documentId: number;
}

export interface MentionStats {
    /** Source chips in the words. */
    mentions: number;
    /** …of which name a source in this turn's scope. */
    resolved: number;
    /** …of which name a source the caller cannot open here. */
    unavailable: number;
}

/**
 * The document a source ref names: what the client said it maps to, else the
 * number in a `d<id>` ref (the one form the transcript and the tools share).
 * A mindmap's `m7` without a mapping names nothing.
 */
export function mentionDocumentId(
    ref: string,
    mentions: readonly SourceMention[] | undefined
): number | null {
    const mapped = mentions?.find(mention => mention.ref === ref);
    if (mapped) return mapped.documentId;
    return /^d\d{1,12}$/.test(ref) ? labelDocumentId(ref) : null;
}

/** The sources in scope that the words name, in the order they are named. */
export function mentionedScopeFiles(
    text: string,
    mentions: readonly SourceMention[] | undefined,
    files: readonly ScopeFile[]
): ScopeFile[] {
    const byId = new Map(files.map(file => [file.id, file]));
    const out: ScopeFile[] = [];
    for (const ref of mentionedSourceRefs(text)) {
        const id = mentionDocumentId(ref, mentions);
        const file = id === null ? undefined : byId.get(id);
        if (file && !out.includes(file)) out.push(file);
    }
    return out;
}

function titleOf(id: number, files: readonly ScopeFile[], fallback: string): string {
    return files.find(file => file.id === id)?.title ?? fallback;
}

/**
 * The person's words with every chip rendered for the model, and how the
 * source chips resolved. `admitted` is the set of document ids this turn may
 * read; `files` supplies their titles (the database's, never the chip's).
 */
export function renderMessageMentions(
    text: string,
    options: {
        mentions?: readonly SourceMention[];
        admitted: ReadonlySet<number>;
        files: readonly ScopeFile[];
        uploads?: readonly { name: string; url: string }[];
    }
): { text: string; stats: MentionStats } {
    const stats: MentionStats = { mentions: 0, resolved: 0, unavailable: 0 };
    const rendered = renderMentions(text, (mention: Mention) => {
        switch (mention.kind) {
            case "source": {
                stats.mentions += 1;
                const id = mentionDocumentId(mention.ref, options.mentions);
                if (id !== null && options.admitted.has(id)) {
                    stats.resolved += 1;
                    return sourceMentionText(
                        titleOf(id, options.files, mention.label),
                        sourceLabel(id)
                    );
                }
                stats.unavailable += 1;
                return unavailableMentionText(mention.label);
            }
            case "folder":
                return folderMentionText(mention.label);
            case "thread":
                return threadMentionText(mention.label);
        }
    });
    return { text: renderUploadLinks(rendered, options.uploads ?? []), stats };
}

/**
 * Earlier turns' chips, rendered for the model: a source keeps its id when
 * the ref carries one, and the title this turn knows for it, else its label.
 */
export function renderHistoryMentions(
    text: string,
    options: { mentions?: readonly SourceMention[]; files: readonly ScopeFile[] }
): string {
    return renderMentions(text, (mention: Mention) => {
        switch (mention.kind) {
            case "source": {
                const id = mentionDocumentId(mention.ref, options.mentions);
                return id === null
                    ? quoteName(mention.label)
                    : sourceMentionText(titleOf(id, options.files, mention.label), sourceLabel(id));
            }
            case "folder":
                return folderMentionText(mention.label);
            case "thread":
                return threadMentionText(mention.label);
        }
    });
}
