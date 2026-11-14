import type { ExtractionSourceOption } from "~/lib/extraction/types";

/**
 * The document picker as plain functions: finding, grouping by folder and
 * selecting many at once. Pinned by a unit test.
 */

/** Documents whose title or folder contains every word of the query. */
export function findSources<T extends ExtractionSourceOption>(
    sources: readonly T[],
    query: string
): T[] {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [...sources];
    return sources.filter(source => {
        const text = `${source.title} ${source.folder ?? ""}`.toLowerCase();
        return words.every(word => text.includes(word));
    });
}

export interface SourceGroup<T> {
    /** The folder path, or null for documents in no folder. */
    folder: string | null;
    sources: T[];
}

/** Folders in name order, each folder's documents in title order; unfiled documents last. */
export function groupByFolder<T extends ExtractionSourceOption>(
    sources: readonly T[],
    locale: string
): SourceGroup<T>[] {
    const byFolder = new Map<string | null, T[]>();
    for (const source of sources) {
        const folder = source.folder?.trim() ? source.folder : null;
        const group = byFolder.get(folder);
        if (group) group.push(source);
        else byFolder.set(folder, [source]);
    }
    const compare = (a: string, b: string) =>
        a.localeCompare(b, locale, { numeric: true, sensitivity: "base" });
    return [...byFolder.entries()]
        .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : compare(a, b)))
        .map(([folder, list]) => ({
            folder,
            sources: [...list].sort((a, b) => compare(a.title, b.title)),
        }));
}

/**
 * Everything in `folder` and the folders inside it. Folders are paths
 * ("Clients/Acme/Invoices"), so taking "Clients" takes the whole tree, the
 * way ticking a folder in the sidebar does. `null` is the unfiled documents.
 */
export function sourcesUnderFolder<T extends ExtractionSourceOption>(
    sources: readonly T[],
    folder: string | null
): T[] {
    if (folder === null) return sources.filter(source => !source.folder?.trim());
    const prefix = `${folder}/`;
    return sources.filter(
        source => source.folder === folder || (source.folder ?? "").startsWith(prefix)
    );
}

/**
 * `picked` with `add` chosen too, in the order they were added, never past
 * `max`. Documents still being processed cannot be chosen and are skipped.
 */
export function addToSelection(
    picked: readonly number[],
    add: readonly ExtractionSourceOption[],
    max: number
): number[] {
    const next = [...picked];
    const have = new Set(picked);
    for (const source of add) {
        if (next.length >= max) break;
        if (!source.indexed || have.has(source.documentId)) continue;
        have.add(source.documentId);
        next.push(source.documentId);
    }
    return next;
}

export function removeFromSelection(
    picked: readonly number[],
    remove: readonly ExtractionSourceOption[]
): number[] {
    const gone = new Set(remove.map(source => source.documentId));
    return picked.filter(id => !gone.has(id));
}

/**
 * A deep link's documents (`/new?docs=…`) against what the viewer can
 * choose: ids that are not theirs to read, or still being processed, are
 * dropped and counted so the form can say so.
 */
export function reconcileSelection(
    picked: readonly number[],
    sources: readonly ExtractionSourceOption[],
    max: number
): { picked: number[]; dropped: number } {
    const choosable = new Set(sources.filter(s => s.indexed).map(s => s.documentId));
    const kept = picked.filter(id => choosable.has(id)).slice(0, max);
    return { picked: kept, dropped: picked.length - kept.length };
}
