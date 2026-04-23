"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuth } from "@clerk/nextjs";
import { EmployerChrome } from "~/app/employer/_components/EmployerChrome";
import LoadingPage from "~/app/_components/loading";
import type { DocumentType } from "../types";

const DocumentViewer = dynamic(
  () =>
    import("~/app/employer/documents/components/DocumentViewer").then(
      (m) => m.DocumentViewer,
    ),
  { loading: () => <LoadingPage /> },
);

function ViewerInner() {
  const { userId, isLoaded, isSignedIn } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const docIdParam = searchParams.get("docId");
  const docId = docIdParam ? Number(docIdParam) : null;

  const [document, setDocument] = useState<DocumentType | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfPageNumber, setPdfPageNumber] = useState(1);

  const fetchDocument = useCallback(async () => {
    if (!userId || !docId) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/fetchDocument", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) throw new Error("Failed to fetch documents");
      const data = (await res.json()) as DocumentType[];
      setDocument(data.find((d) => d.id === docId) ?? null);
    } catch (err) {
      console.error("Error fetching document", err);
    } finally {
      setLoading(false);
    }
  }, [userId, docId]);

  useEffect(() => {
    if (isLoaded && !isSignedIn) router.push("/");
  }, [isLoaded, isSignedIn, router]);

  useEffect(() => {
    void fetchDocument();
  }, [fetchDocument]);

  if (loading) return <LoadingPage />;

  if (!document) {
    return (
      <div
        style={{
          padding: "64px 24px",
          textAlign: "center",
          color: "var(--ink-3)",
          fontSize: 14,
        }}
      >
        <div style={{ marginBottom: 12 }}>Document not found.</div>
        <button
          onClick={() => router.push("/employer/documents")}
          style={{
            background: "var(--accent)",
            color: "white",
            padding: "8px 16px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            border: "none",
            cursor: "pointer",
          }}
        >
          Back to workspace
        </button>
      </div>
    );
  }

  return (
    <div style={{ height: "calc(100vh - 56px)", overflow: "hidden" }}>
      <DocumentViewer
        document={document}
        pdfPageNumber={pdfPageNumber}
        setPdfPageNumber={setPdfPageNumber}
      />
    </div>
  );
}

export default function DocumentViewerPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--ink)" }}>
      <EmployerChrome pageLabel="Launchstack" pageTitle="Document" />
      <Suspense fallback={<LoadingPage />}>
        <ViewerInner />
      </Suspense>
    </div>
  );
}
