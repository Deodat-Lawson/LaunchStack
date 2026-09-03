"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
        folder: doc.category ?? "Unfiled",
        tags: [],
        domain: "General",
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
        folder: map.folder || "Unfiled",
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
    /** DB role of the current user (`employer`, `owner`, `employee`, or null while loading). */
    role: string | null;
    refresh: () => Promise<void>;
    /** Optimistically insert a row before the backend confirms it. */
    addOptimistic: (source: WorkspaceSource) => void;
}

interface CategoryRow {
    id: number;
    name: string;
    companyId: number;
}

export function useWorkspaceData(userId: string | null | undefined): UseWorkspaceDataResult {
    const [documents, setDocuments] = useState<(DocumentType & { createdAt?: string })[]>([]);
    const [mindmaps, setMindmaps] = useState<MindmapSummary[]>([]);
    const [categories, setCategories] = useState<CategoryRow[]>([]);
    const [optimistic, setOptimistic] = useState<WorkspaceSource[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [companyId, setCompanyId] = useState<number | null>(null);
    const [role, setRole] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!userId) return;
        setError(null);
        try {
            const [docsRes, catsRes, mapsRes] = await Promise.all([
                fetch("/api/fetchDocument", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: "{}",
                }),
                fetch("/api/Categories/GetCategories"),
                // Mindmaps are sources too. A failure here must not take the
                // documents down with it — the list degrades to uploads only.
                fetch("/api/mindmaps?scope=active").catch(() => null),
            ]);
            if (!docsRes.ok) throw new Error(`Failed to fetch documents (${docsRes.status})`);
            const docs = (await docsRes.json()) as (DocumentType & { createdAt?: string })[];
            setDocuments(docs);

            if (catsRes.ok) {
                const cats = (await catsRes.json()) as CategoryRow[];
                setCategories(cats);
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

    // Fetch company context so AskPanel can scope queries correctly.
    const resolveCompany = useCallback(async () => {
        if (!userId) return;
        try {
            const response = await fetch("/api/fetchUserInfo", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
            });
            if (!response.ok) return;
            const data = (await response.json()) as {
                companyId?: number | string;
                role?: string;
            };
            if (data?.companyId != null) setCompanyId(Number(data.companyId));
            if (typeof data?.role === "string") setRole(data.role);
        } catch {
            // non-fatal — AskPanel falls back to document-scoped queries
        }
    }, [userId]);

    useEffect(() => {
        if (!userId) return;
        void refresh();
        void resolveCompany();
    }, [userId, refresh, resolveCompany]);

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
        const seen = new Map<string, WorkspaceFolder>();
        // Seed with every category so empty folders render in the rail.
        for (const c of categories) {
            seen.set(c.name, { id: `cat-${c.id}`, name: c.name, color: folderColor(c.name) });
        }
        for (const src of sources) {
            const name = src.folder || "Unfiled";
            if (!seen.has(name)) {
                seen.set(name, { id: `f-${name}`, name, color: folderColor(name) });
            }
        }
        return [...seen.values()];
    }, [sources, categories]);

    const addOptimistic = useCallback((source: WorkspaceSource) => {
        setOptimistic(prev => [source, ...prev]);
    }, []);

    return {
        sources,
        folders,
        loading,
        error,
        companyId,
        role,
        refresh,
        addOptimistic,
    };
}
