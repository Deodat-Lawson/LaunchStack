"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocumentType } from "../types/document";
import { getDocumentDisplayType } from "../types/document";
import {
    WorkspaceCallNoteFilesSchema,
    type WorkspaceCallNoteFile,
} from "@launchstack/features/call-notes/files";
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
    if (typeof raw !== "string" && typeof raw !== "number" && !(raw instanceof Date)) return "";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return "";
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

function mapCallNoteFile(file: WorkspaceCallNoteFile): WorkspaceSource {
    return {
        id: `call-note:${file.callId}`,
        callId: file.callId,
        noteId: file.noteId,
        visibility: file.visibility,
        revision: file.revision,
        updatedAt: file.updatedAt,
        preview: file.preview,
        title: file.title,
        type: "call-note",
        size: "",
        added: humanDate(file.updatedAt),
        folder: "Calls",
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

interface CategoryRow {
    id: number;
    name: string;
    companyId: number;
}

export function useWorkspaceData(userId: string | null | undefined): UseWorkspaceDataResult {
    const [documents, setDocuments] = useState<(DocumentType & { createdAt?: string })[]>([]);
    const [callNoteFiles, setCallNoteFiles] = useState<WorkspaceCallNoteFile[]>([]);
    const [categories, setCategories] = useState<CategoryRow[]>([]);
    const [optimistic, setOptimistic] = useState<WorkspaceSource[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [companyId, setCompanyId] = useState<number | null>(null);
    const [role, setRole] = useState<string | null>(null);
    const refreshGeneration = useRef(0);
    const companyGeneration = useRef(0);

    const refresh = useCallback(async () => {
        const generation = ++refreshGeneration.current;
        if (!userId) {
            setDocuments([]);
            setCallNoteFiles([]);
            setCategories([]);
            setOptimistic([]);
            setLoading(false);
            setError(null);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const [docsRes, catsRes, callFilesRes] = await Promise.all([
                fetch("/api/fetchDocument", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId }),
                }),
                fetch("/api/Categories/GetCategories"),
                fetch("/api/call-notes/files", { cache: "no-store" }),
            ]);
            if (!docsRes.ok) throw new Error(`Failed to fetch documents (${docsRes.status})`);
            if (!callFilesRes.ok)
                throw new Error(`Failed to fetch Call Notes (${callFilesRes.status})`);

            const docs = (await docsRes.json()) as (DocumentType & { createdAt?: string })[];
            const callFiles = WorkspaceCallNoteFilesSchema.parse(await callFilesRes.json());
            const cats = catsRes.ok ? ((await catsRes.json()) as CategoryRow[]) : [];
            if (generation !== refreshGeneration.current) return;

            setDocuments(docs);
            setCallNoteFiles(callFiles);
            setCategories(cats);
            // Prune optimistic rows that now exist in the server response (by title).
            setOptimistic(prev => prev.filter(o => !docs.some(d => d.title === o.title)));
        } catch (err) {
            if (generation !== refreshGeneration.current) return;
            // A failed refresh must not leave data from a prior active workspace on
            // screen while the auth/workspace context is uncertain.
            setDocuments([]);
            setCallNoteFiles([]);
            setCategories([]);
            setOptimistic([]);
            setCompanyId(null);
            setRole(null);
            setError(err instanceof Error ? err.message : "Failed to fetch workspace files");
        } finally {
            if (generation === refreshGeneration.current) setLoading(false);
        }
    }, [userId]);

    // Fetch company context so AskPanel can scope queries correctly.
    const resolveCompany = useCallback(async () => {
        const generation = ++companyGeneration.current;
        if (!userId) {
            setCompanyId(null);
            setRole(null);
            return;
        }
        try {
            const response = await fetch("/api/fetchUserInfo", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId }),
            });
            if (generation !== companyGeneration.current) return;
            if (!response.ok) {
                setCompanyId(null);
                setRole(null);
                return;
            }
            const data = (await response.json()) as {
                companyId?: number | string;
                role?: string;
            };
            setCompanyId(data.companyId == null ? null : Number(data.companyId));
            setRole(typeof data.role === "string" ? data.role : null);
        } catch {
            if (generation !== companyGeneration.current) return;
            setCompanyId(null);
            setRole(null);
            // non-fatal — AskPanel falls back to document-scoped queries
        }
    }, [userId]);

    useEffect(() => {
        // Invalidate in-flight responses before changing identity/workspace data.
        refreshGeneration.current += 1;
        companyGeneration.current += 1;
        setDocuments([]);
        setCallNoteFiles([]);
        setCategories([]);
        setOptimistic([]);
        setCompanyId(null);
        setRole(null);
        setError(null);
        setLoading(Boolean(userId));
        if (!userId) return;
        void refresh();
        void resolveCompany();
    }, [userId, refresh, resolveCompany]);

    const sources = useMemo<WorkspaceSource[]>(
        () => [...optimistic, ...documents.map(mapDocument), ...callNoteFiles.map(mapCallNoteFile)],
        [documents, callNoteFiles, optimistic]
    );

    const folders = useMemo<WorkspaceFolder[]>(() => {
        const seen = new Map<string, WorkspaceFolder>();
        // Seed with every category so empty folders render in the rail.
        for (const c of categories) {
            seen.set(c.name, {
                id: `cat-${c.id}`,
                name: c.name,
                color: folderColor(c.name),
                ...(c.name === "Calls" ? { system: true } : {}),
            });
        }
        for (const src of sources) {
            const name = src.folder || "Unfiled";
            if (!seen.has(name)) {
                seen.set(name, {
                    id: `f-${name}`,
                    name,
                    color: folderColor(name),
                    ...(src.type === "call-note" && name === "Calls" ? { system: true } : {}),
                });
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
