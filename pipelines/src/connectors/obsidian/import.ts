/**
 * One batch of an Obsidian vault import: render → fingerprint-compare →
 * store. The browser reads the vault (a folder or a .zip) and posts notes in
 * batches; each batch runs through here. Unchanged notes are skipped on the
 * fingerprint alone, so re-importing a vault only stores what changed.
 *
 * Deletions are the host's job: after the last batch it knows every path
 * the vault still has, and flags notes it imported before that are gone.
 */

import type {
    DiscoveredKnowledgeItem,
    FailedKnowledgeItem,
    KnowledgeSink,
    KnowledgeSyncReport,
    SkippedKnowledgeItem,
    StoredKnowledgeItem,
} from "../types";
import { isVaultNotePath, normalizeVaultPath, noteFolder } from "./paths";
import { noteFingerprint, renderNote } from "./vault";

export const OBSIDIAN_CONNECTOR_ID = "obsidian";

/** A note larger than this is skipped rather than ingested. */
export const DEFAULT_MAX_NOTE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_IMPORT_CONCURRENCY = 4;

export interface ObsidianNoteInput {
    /** Vault-relative path, e.g. `Projects/Launch plan.md`. */
    readonly path: string;
    readonly text: string;
    /** File modification time from the browser, when it has one. */
    readonly modifiedAt?: string | null;
}

export interface ObsidianImportOptions {
    readonly vaultName: string;
    readonly notes: readonly ObsidianNoteInput[];
    readonly sink: KnowledgeSink;
    readonly force?: boolean;
    readonly maxNoteBytes?: number;
    readonly concurrency?: number;
    /** Clock seam for deterministic tests. */
    readonly now?: () => Date;
}

export type ObsidianImportResult = KnowledgeSyncReport;

function describeError(error: unknown): string {
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    return typeof error === "string" ? error : "Unknown error";
}

export function toNoteItem(
    vaultName: string,
    note: ObsidianNoteInput,
    title: string,
    tags: readonly string[],
    now: Date
): DiscoveredKnowledgeItem {
    const path = normalizeVaultPath(note.path);
    return {
        sourceId: path,
        connectorId: OBSIDIAN_CONNECTOR_ID,
        title,
        kind: "obsidian-note",
        mimeType: "text/markdown",
        bytes: Buffer.byteLength(note.text, "utf-8"),
        modifiedAt: note.modifiedAt ?? now.toISOString(),
        location: { origin: `obsidian://${vaultName}/${path}`, relativePath: path },
        metadata: {
            extension: ".md",
            obsidianVault: vaultName,
            obsidianPath: path,
            obsidianFolder: noteFolder(path),
            tags,
        },
    };
}

type NoteOutcome =
    | { readonly stored: StoredKnowledgeItem }
    | { readonly skipped: SkippedKnowledgeItem }
    | { readonly failed: FailedKnowledgeItem };

async function importNote(
    options: ObsidianImportOptions,
    note: ObsidianNoteInput,
    now: Date
): Promise<NoteOutcome> {
    const path = normalizeVaultPath(note.path);
    try {
        if (!isVaultNotePath(path)) {
            return { skipped: { sourceId: path, reason: "excluded" } };
        }
        const maxBytes = options.maxNoteBytes ?? DEFAULT_MAX_NOTE_BYTES;
        const bytes = Buffer.byteLength(note.text, "utf-8");
        if (bytes > maxBytes) {
            return {
                skipped: {
                    sourceId: path,
                    reason: "too-large",
                    detail: `${bytes} bytes; the limit is ${maxBytes}`,
                },
            };
        }
        if (!note.text.trim()) return { skipped: { sourceId: path, reason: "empty" } };

        const rendered = renderNote({ path, text: note.text, vaultName: options.vaultName });
        const item = toNoteItem(options.vaultName, note, rendered.title, rendered.tags, now);
        const fingerprint = noteFingerprint(note.text);

        if (!options.force && options.sink.lastSyncedHash) {
            const previous = await options.sink.lastSyncedHash(item);
            if (previous === fingerprint)
                return { skipped: { sourceId: path, reason: "unchanged" } };
        }

        const stored = await options.sink.store({
            ...item,
            bytes: Buffer.byteLength(rendered.markdown, "utf-8"),
            content: rendered.markdown,
            contentHash: fingerprint,
        });
        return { stored };
    } catch (error) {
        return { failed: { sourceId: path, error: describeError(error) } };
    }
}

export async function importObsidianNotes(
    options: ObsidianImportOptions
): Promise<ObsidianImportResult> {
    const clock = options.now ?? (() => new Date());
    const startedAt = clock();

    // One path, one note: a batch that repeats a path keeps the last copy.
    const byPath = new Map<string, ObsidianNoteInput>();
    for (const note of options.notes) byPath.set(normalizeVaultPath(note.path), note);
    const notes = [...byPath.values()];

    const outcomes = new Array<NoteOutcome>(notes.length);
    let cursor = 0;
    const limit = Math.max(
        1,
        Math.min(options.concurrency ?? DEFAULT_IMPORT_CONCURRENCY, notes.length)
    );
    await Promise.all(
        Array.from({ length: limit }, async () => {
            while (true) {
                const index = cursor++;
                const note = notes[index];
                if (!note) return;
                outcomes[index] = await importNote(options, note, startedAt);
            }
        })
    );

    const stored: StoredKnowledgeItem[] = [];
    const skipped: SkippedKnowledgeItem[] = [];
    const failed: FailedKnowledgeItem[] = [];
    for (const outcome of outcomes) {
        if ("stored" in outcome) stored.push(outcome.stored);
        else if ("skipped" in outcome) skipped.push(outcome.skipped);
        else failed.push(outcome.failed);
    }

    const finishedAt = clock();
    return {
        connectorId: OBSIDIAN_CONNECTOR_ID,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        discovered: notes.length,
        stored,
        skipped,
        failed,
    };
}
