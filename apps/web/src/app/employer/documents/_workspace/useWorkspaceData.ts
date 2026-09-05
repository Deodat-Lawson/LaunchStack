"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Permission } from "~/lib/authz/permissions";
import { usePermissions } from "~/lib/use-permissions";
import {
    compareFolderPaths,
    expandFolderPaths,
    folderLeafName,
    normalizeFolderPath,
} from "~/lib/folders/path";
import type { MindmapSummary } from "../_mindmap/lib/api";
import type { DocumentType } from "../types/document";
import { getDocumentDisplayType } from "../types/document";
import type { SourceCitability, SourceTypeId, WorkspaceFolder, WorkspaceSource } from "./types";

/** Stable color picker — hashes a category name into the existing design palette. */
const FOLDER_PALETTE = [
    "oklch(0.6 0.17 285)",
    "oklch(0.6 0.14 30)",
    "oklch(0.55 0.14 225)",
    "oklch(0.6 0.15 160)",
    "oklch(0.55 0.14 330)",
    "oklch(0.5 0.02 280)",
];

function hashName(name: string): number {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    return Math.abs(h);
}

function folderColor(name: string): string {
    const palette = FOLDER_PALETTE;
    return palette[hashName(name) % palette.length]!;
}

function mapDocType(doc: DocumentType): SourceTypeId {
    const t = getDocumentDisplayType(doc);
    if (t === "audio") return "audio";
    return "doc";
}

function humanDate(raw: unknown): string {
    if (!raw) return "";
    const d =
        raw instanceof Date
            ? raw
            : typeof raw === "string" || typeof raw === "number"
              ? new Date(raw)
              : null;
    if (!d || Number.isNaN(d.getTime())) return "";
    const diffMs = Date.now() - d.getTime();
    const diffHr = Math.floor(diffMs / 3_600_000);
    if (diffHr < 1) return "just now";
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay === 1) return "Yesterday";
    if (diffDay < 7) return `${diffDay} days ago`;
    const diffWk = Math.floor(diffDay / 7);
    if (diffWk === 1) return "Last week";
    if (diffWk < 5) return `${diffWk} weeks ago`;
    return d.toLocaleDateString();
}

function mapDocument(doc: DocumentType & { createdAt?: string }): WorkspaceSource {
    return {
        id: `d${doc.id}`,
        documentId: doc.id,
        title: doc.title,
        type: mapDocType(doc),
        size: doc.aiSummary ? "" : "",
        added: humanDate(doc.createdAt) || "",
        folder: normalizeFolderPath(doc.category),
        tags: [],
        domain: "General",
        restricted: doc.restricted === true,
    };
}

/**
 * A mindmap is citable only through its published copy, and only faithfully
 * when that copy was made from the revision on screen.
 */
export function mindmapCitability(
    map: Pick<MindmapSummary, "publishedDocumentId" | "publishedRevision" | "revision">
): SourceCitability {
    if (map.publishedDocumentId === null) return "none";
    if (map.publishedRevision !== null && map.publishedRevision < map.revision) return "stale";
    return "citable";
}

/**
 * A mindmap row as a source. `documentId` is the published document, when
 * there is one, so the retrieval layer's citations — which name document ids —
 * resolve to the map rather than to a Markdown copy of it.
 */
export function mapMindmap(map: MindmapSummary): WorkspaceSource {
    const shapes = `${map.nodeCount} shape${map.nodeCount === 1 ? "" : "s"}`;
    return {
        id: `m${map.id}`,
        mindmapId: map.id,
        documentId: map.publishedDocumentId ?? undefined,
        title: map.title,
        type: "mindmap",
        size: shapes,
        added: humanDate(map.updatedAt) || "",
        // Folders are paths now, and a map is filed like any other source.
        folder: normalizeFolderPath(map.folder),
        tags: [],
        domain: "General",
        searchText: map.searchText ?? undefined,
        thumbnailUrl: map.hasThumbnail ? `/api/mindmaps/${map.id}/thumbnail` : undefined,
        citability: mindmapCitability(map),
    };
}

export interface UseWorkspaceDataResult {
    sources: WorkspaceSource[];
    folders: WorkspaceFolder[];
    loading: boolean;
    error: string | null;
    companyId: number | null;
    /**
     * What the signed-in person may do here. `can` answers false until the
     * permissions have loaded, so anything gated on it fails closed.
     */
    permissions: ReadonlySet<Permission>;
    can: (permission: Permission | undefined) => boolean;
    /** True once the permission answer has arrived (even if it was "nothing"). */
    permissionsLoaded: boolean;
    refresh: () => Promise<void>;
    /** Optimistically insert a row before the backend confirms it. */
    addOptimistic: (source: WorkspaceSource) => void;
}

interface FolderRow {
    path: string;
    documentCount: number;
    persisted: boolean;
    /** Only people, groups, or roles with a grant can see this folder (or an ancestor is restricted). */
    restricted?: boolean;
    /** The `category` row behind a persisted folder; null while the folder is only implied. */
    categoryId?: number | null;
}

export function useWorkspaceData(userId: string | null | undefined): UseWorkspaceDataResult {
    const [documents, setDocuments] = useState<(DocumentType & { createdAt?: string })[]>([]);
    const [mindmaps, setMindmaps] = useState<MindmapSummary[]>([]);
    const [folderRows, setFolderRows] = useState<FolderRow[]>([]);
    const [optimistic, setOptimistic] = useState<WorkspaceSource[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // One fetch of /api/fetchUserInfo for the whole app: the workspace id the
    // AskPanel scopes to and the permission set come from the same answer.
    const { companyId, permissions, can, loaded: permissionsLoaded } = usePermissions();

    const refresh = useCallback(async () => {
        if (!userId) return;
        setError(null);
        try {
            const [docsRes, foldersRes, mapsRes] = await Promise.all([
                fetch("/api/fetchDocument", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: "{}",
                }),
                fetch("/api/folders"),
                // Mindmaps are sources too. A failure here must not take the
                // documents down with it — the list degrades to uploads only.
                fetch("/api/mindmaps?scope=active").catch(() => null),
            ]);
            if (!docsRes.ok) throw new Error(`Failed to fetch documents (${docsRes.status})`);
            const docs = (await docsRes.json()) as (DocumentType & { createdAt?: string })[];
            setDocuments(docs);

            // Folders that exist while empty only come from here; the rest are
            // implied by the documents themselves, so a failure degrades to that.
            if (foldersRes.ok) {
                const body = (await foldersRes.json()) as { data?: { folders?: FolderRow[] } };
                setFolderRows(body.data?.folders ?? []);
            }

            if (mapsRes?.ok) {
                const body = (await mapsRes.json()) as { mindmaps: MindmapSummary[] };
                setMindmaps(body.mindmaps ?? []);
            } else if (mapsRes) {
                console.warn(`[workspace] mindmaps list failed (${mapsRes.status})`);
            }

            // Prune optimistic rows that now exist in the server response (by title).
            setOptimistic(prev => prev.filter(o => !docs.some(d => d.title === o.title)));
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to fetch documents");
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        if (!userId) return;
        void refresh();
    }, [userId, refresh]);

    const sources = useMemo<WorkspaceSource[]>(() => {
        // A published map's Markdown copy is the map, not a second source: it
        // is hidden here and reached through the map's `documentId`.
        const claimed = new Set<number>();
        for (const map of mindmaps) {
            if (map.publishedDocumentId !== null) claimed.add(map.publishedDocumentId);
        }
        return [
            ...optimistic,
            ...documents.filter(d => !claimed.has(d.id)).map(mapDocument),
            ...mindmaps.map(mapMindmap),
        ];
    }, [documents, mindmaps, optimistic]);

    const folders = useMemo<WorkspaceFolder[]>(() => {
        // Every folder a source sits in, every folder that exists while empty,
        // and every ancestor either implies — a path is a folder tree.
        const byPath = new Map(folderRows.map(row => [row.path, row] as const));
        const paths = expandFolderPaths([
            ...folderRows.map(row => row.path),
            ...sources.map(src => src.folder),
        ]);
        return paths.sort(compareFolderPaths).map(path => {
            const row = byPath.get(path);
            return {
                id: `f-${path}`,
                name: path,
                color: folderColor(folderLeafName(path)),
                restricted: row?.restricted === true,
                categoryId: row?.categoryId ?? null,
            };
        });
    }, [sources, folderRows]);

    const addOptimistic = useCallback((source: WorkspaceSource) => {
        setOptimistic(prev => [source, ...prev]);
    }, []);

    return {
        sources,
        folders,
        loading,
        error,
        companyId,
        permissions,
        can,
        permissionsLoaded,
        refresh,
        addOptimistic,
    };
}
