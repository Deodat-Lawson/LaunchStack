"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  const d = new Date(String(raw));
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

export interface UseWorkspaceDataResult {
  sources: WorkspaceSource[];
  folders: WorkspaceFolder[];
  loading: boolean;
  error: string | null;
  companyId: number | null;
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
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [optimistic, setOptimistic] = useState<WorkspaceSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setError(null);
    try {
      const [docsRes, catsRes] = await Promise.all([
        fetch("/api/fetchDocument", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        }),
        fetch("/api/Categories/GetCategories"),
      ]);
      if (!docsRes.ok) throw new Error(`Failed to fetch documents (${docsRes.status})`);
      const docs = (await docsRes.json()) as (DocumentType & { createdAt?: string })[];
      setDocuments(docs);

      if (catsRes.ok) {
        const cats = (await catsRes.json()) as CategoryRow[];
        setCategories(cats);
      }

      // Prune optimistic rows that now exist in the server response (by title).
      setOptimistic((prev) =>
        prev.filter((o) => !docs.some((d) => d.title === o.title)),
      );
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
        body: JSON.stringify({ userId }),
      });
      if (!response.ok) return;
      const data = (await response.json()) as { companyId?: number | string };
      if (data?.companyId != null) setCompanyId(Number(data.companyId));
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
    [documents, optimistic],
  );

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
    setOptimistic((prev) => [source, ...prev]);
  }, []);

  return {
    sources,
    folders,
    loading,
    error,
    companyId,
    refresh,
    addOptimistic,
  };
}
