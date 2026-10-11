/**
 * What a reader of someone else's chat may see of its evidence (ADR-014 §4).
 *
 * A shared chat is the owner's transcript, read live. The words stay as they
 * were said, but the *sources* behind them are filtered to the reader's own
 * scope before they leave the server: a citation names a document, carries
 * its snippet and the matched passage, and a reader who cannot open that
 * document must not learn either. What is dropped is counted, so the reader
 * is told that something was there rather than misled into thinking the
 * answer was unsourced.
 *
 * Source ids are the workspace's (`d12` a document, `m3` a mindmap):
 * - `d<id>` is visible when the document is in the reader's `DocumentScope`.
 * - `m<id>` follows the rule every mindmap route applies — any member of the
 *   workspace may open a map (`/api/mindmaps/:id`) — plus one more: a map's
 *   citations quote its *published document*, so when it has one that
 *   document must be in scope too.
 * - Anything else (a staged local `s…`, a malformed id) is dropped: fail closed.
 */

import { and, eq, inArray } from "drizzle-orm";

import { document } from "@launchstack/store/schema";
import { db } from "~/server/db";
import { mindmaps } from "~/server/db/schema";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import type { DocumentScope } from "~/lib/authz/scope-types";

import type { SessionMessage } from "./repository";

export interface VisibilityReader {
    companyId: bigint;
    documentScope(): Promise<DocumentScope>;
}

/** `d12` → { kind: "document", id: 12 }. Null for anything not a workspace source id. */
export function parseSourceId(id: string): { kind: "document" | "mindmap"; id: number } | null {
    const match = /^([dm])(\d{1,15})$/.exec(id);
    if (!match) return null;
    const value = Number(match[2]);
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    return { kind: match[1] === "d" ? "document" : "mindmap", id: value };
}

/** The subset of `ids` this reader may open. One query per kind, whatever the count. */
export async function visibleSourceIds(
    reader: VisibilityReader,
    ids: Iterable<string>
): Promise<Set<string>> {
    const docIds = new Set<number>();
    const mapIds = new Set<number>();
    for (const raw of ids) {
        const parsed = parseSourceId(raw);
        if (!parsed) continue;
        (parsed.kind === "document" ? docIds : mapIds).add(parsed.id);
    }
    const visible = new Set<string>();
    if (docIds.size === 0 && mapIds.size === 0) return visible;

    const maps =
        mapIds.size === 0
            ? []
            : await db
                  .select({ id: mindmaps.id, publishedDocumentId: mindmaps.publishedDocumentId })
                  .from(mindmaps)
                  .where(
                      and(
                          eq(mindmaps.companyId, reader.companyId),
                          inArray(mindmaps.id, [...mapIds])
                      )
                  );
    const published = maps
        .map(m => (m.publishedDocumentId === null ? null : Number(m.publishedDocumentId)))
        .filter((id): id is number => id !== null);
    const wantedDocs = [...new Set([...docIds, ...published])];

    const scope = await reader.documentScope();
    const docs =
        wantedDocs.length === 0
            ? []
            : await db
                  .select({ id: document.id })
                  .from(document)
                  .where(
                      and(
                          scopedDocumentWhere(reader.companyId, scope),
                          inArray(document.id, wantedDocs)
                      )
                  );
    const openDocs = new Set(docs.map(d => Number(d.id)));

    for (const id of docIds) if (openDocs.has(id)) visible.add(`d${id}`);
    for (const map of maps) {
        const doc = map.publishedDocumentId === null ? null : Number(map.publishedDocumentId);
        if (doc === null || openDocs.has(doc)) visible.add(`m${map.id}`);
    }
    return visible;
}

/** Every source id a set of stored turns mentions: refs, citations, and the send's pinned refs. */
export function sourceIdsIn(
    messages: readonly SessionMessage[],
    extra: readonly string[] = []
): Set<string> {
    const out = new Set<string>(extra);
    for (const message of messages) {
        for (const ref of message.refs ?? []) out.add(ref);
        for (const ref of message.metadata?.send?.refs ?? []) out.add(ref);
        for (const citation of message.citations ?? []) {
            const id = citationSourceId(citation);
            if (id) out.add(id);
        }
    }
    return out;
}

function citationSourceId(citation: unknown): string | null {
    if (!citation || typeof citation !== "object") return null;
    const id = (citation as { sourceId?: unknown }).sourceId;
    return typeof id === "string" ? id : null;
}

export interface ReaderMessage extends SessionMessage {
    /** Citations removed because the reader cannot open their source. */
    hiddenCitations?: number;
}

/**
 * Drop every reference to a source outside `visible`. Pure: the caller decides
 * what is visible. A citation without a readable `sourceId` is dropped too.
 */
export function filterMessagesForReader(
    messages: readonly SessionMessage[],
    visible: ReadonlySet<string>
): { messages: ReaderMessage[]; hiddenCitations: number } {
    let hiddenCitations = 0;
    const out = messages.map(message => {
        const next: ReaderMessage = { ...message };
        if (message.refs) next.refs = message.refs.filter(ref => visible.has(ref));
        if (message.citations) {
            const kept = message.citations.filter(citation => {
                const id = citationSourceId(citation);
                return id !== null && visible.has(id);
            });
            const hidden = message.citations.length - kept.length;
            next.citations = kept;
            if (hidden > 0) {
                next.hiddenCitations = hidden;
                hiddenCitations += hidden;
            }
        }
        const send = message.metadata?.send;
        if (send?.refs) {
            next.metadata = {
                ...message.metadata,
                send: { ...send, refs: send.refs.filter(ref => visible.has(ref)) },
            };
        }
        return next;
    });
    return { messages: out, hiddenCitations };
}
