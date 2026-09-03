"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    compareFolderPaths,
    expandFolderPaths,
    folderLeafName,
    normalizeFolderPath,
} from "~/lib/folders/path";
import type { DocumentType } from "../types/document";
import { getDocumentDisplayType } from "../types/document";
import type { SourceTypeId, WorkspaceFolder, WorkspaceSource } from "./types";

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

interface FolderRow {
    path: string;
    documentCount: number;
    persisted: boolean;
}

export function useWorkspaceData(userId: string | null | undefined): UseWorkspaceDataResult {
    const [documents, setDocuments] = useState<(DocumentType & { createdAt?: string })[]>([]);
    const [folderRows, setFolderRows] = useState<FolderRow[]>([]);
    const [optimistic, setOptimistic] = useState<WorkspaceSource[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [companyId, setCompanyId] = useState<number | null>(null);
    const [role, setRole] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!userId) return;
        setError(null);
        try {
            const [docsRes, foldersRes] = await Promise.all([
                fetch("/api/fetchDocument", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: "{}",
                }),
                fetch("/api/folders"),
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

    const sources = useMemo<WorkspaceSource[]>(
        () => [...optimistic, ...documents.map(mapDocument)],
        [documents, optimistic]
    );

    const folders = useMemo<WorkspaceFolder[]>(() => {
        // Every folder a source sits in, every folder that exists while empty,
        // and every ancestor either implies — a path is a folder tree.
        const paths = expandFolderPaths([
            ...folderRows.map(row => row.path),
            ...sources.map(src => src.folder),
        ]);
        return paths.sort(compareFolderPaths).map(path => ({
            id: `f-${path}`,
            name: path,
            color: folderColor(folderLeafName(path)),
        }));
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
        role,
        refresh,
        addOptimistic,
    };
}
