"use client";

import React, { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import UploadForm, { type AvailableProviders } from "~/app/employer/upload/UploadForm";

const CategoryManagement = dynamic(
  () => import("~/app/employer/upload/CategoryManagement"),
  { ssr: false }
);

interface Category {
  id: string;
  name: string;
}

type CategoryResponse = {
  id: number;
  success: boolean;
  name: string;
};

interface CompanyData {
  id: number;
  name: string;
  useUploadThing: boolean;
}

interface UploadBootstrapResponse {
  categories: Category[];
  company: CompanyData | null;
  isUploadThingConfigured: boolean;
  availableProviders: AvailableProviders;
  storageProvider: "s3" | "database";
  s3Endpoint: string;
}

interface UploadViewProps {
  /** Called after a successful upload so the parent can refresh its document list */
  onDocumentUploaded?: () => void;
  /**
   * When rendered inside a host chrome (e.g. AddSourceModal), set this to skip
   * the outer heading + scroll shell and let the parent drive layout. Also
   * suppresses the post-upload `router.push("/employer/documents")` since the
   * workspace is already the host.
   */
  embedded?: boolean;
}

export function UploadView({ onDocumentUploaded, embedded = false }: UploadViewProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [useUploadThing, setUseUploadThing] = useState<boolean>(true);
  const [isUploadThingConfigured, setIsUploadThingConfigured] = useState<boolean>(false);
  const [isUpdatingPreference, setIsUpdatingPreference] = useState(false);
  const [availableProviders, setAvailableProviders] = useState<AvailableProviders>({
    azure: false,
    datalab: false,
    landingAI: false,
    docling: false,
  });
  const [storageProvider, setStorageProvider] = useState<"s3" | "database">("s3");
  const [s3Endpoint, setS3Endpoint] = useState("");

  const fetchBootstrap = useCallback(async () => {
    try {
      const res = await fetch("/api/employer/upload/bootstrap", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) throw new Error("Failed to fetch upload bootstrap data");

      const data = (await res.json()) as UploadBootstrapResponse;
      setCategories(data.categories);
      setIsUploadThingConfigured(data.isUploadThingConfigured);
      setAvailableProviders(data.availableProviders);
      setStorageProvider(data.storageProvider);
      setS3Endpoint(data.s3Endpoint);

      if (!data.isUploadThingConfigured) {
        setUseUploadThing(false);
        return;
      }

      setUseUploadThing(data.company?.useUploadThing ?? true);
    } catch (error) {
      console.error("Error fetching upload bootstrap data:", error);
    }
  }, []);

  useEffect(() => {
    void fetchBootstrap();
  }, [fetchBootstrap]);

  const handleToggleUploadMethod = useCallback(async (newValue: boolean) => {
    setIsUpdatingPreference(true);
    try {
      const res = await fetch("/api/updateUploadPreference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useUploadThing: newValue }),
      });

      if (res.ok) {
        const data = (await res.json()) as { success: boolean; useUploadThing: boolean };
        if (data.success) setUseUploadThing(data.useUploadThing);
      } else {
        console.error("Failed to update upload preference");
      }
    } catch (error) {
      console.error("Error updating upload preference:", error);
    } finally {
      setIsUpdatingPreference(false);
    }
  }, []);

  const handleAddCategory = useCallback(async (newCategory: string) => {
    if (!newCategory.trim()) return;
    try {
      const res = await fetch("/api/Categories/AddCategories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ CategoryName: newCategory }),
      });
      if (!res.ok) throw new Error("Failed to create category");

      const rawData = (await res.json()) as CategoryResponse;
      if (rawData.success) {
        setCategories((prev) => [
          ...prev,
          { id: rawData.id.toString(), name: rawData.name },
        ]);
        toast.success(`Category "${rawData.name}" created`);
      } else {
        toast.error("Invalid category data format");
      }
    } catch (error) {
      console.error(error);
      toast.error("Error creating category. Check console for details.");
    }
  }, []);

  const handleRemoveCategory = useCallback(async (id: string, categoryName: string) => {
    try {
      const res = await fetch("/api/Categories/DeleteCategories", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("Failed to remove category");

      setCategories((prev) => prev.filter((cat) => cat.id !== id));
      toast.success(`Category "${categoryName}" removed`);
    } catch (error) {
      console.error(error);
      toast.error("Error removing category. Check console for details.");
    }
  }, []);

  const form = (
    <UploadForm
      categories={categories}
      useUploadThing={useUploadThing}
      isUploadThingConfigured={isUploadThingConfigured}
      onToggleUploadMethod={handleToggleUploadMethod}
      isUpdatingPreference={isUpdatingPreference}
      availableProviders={availableProviders}
      onAddCategory={handleAddCategory}
      storageProvider={storageProvider}
      s3Endpoint={s3Endpoint}
      embedded={embedded}
      onCompleted={onDocumentUploaded}
    />
  );

  if (embedded) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {form}
        <CategoryManagement
          categories={categories}
          onAddCategory={handleAddCategory}
          onRemoveCategory={handleRemoveCategory}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        overflowY: "auto",
        background: "var(--bg)",
        color: "var(--ink)",
      }}
    >
      <div
        style={{
          maxWidth: 860,
          margin: "0 auto",
          padding: "40px 24px 96px",
        }}
      >
        <div style={{ marginBottom: 32 }}>
          <div
            className="mono"
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.12em",
              color: "var(--ink-3)",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Upload
          </div>
          <h1
            className="serif"
            style={{
              fontSize: 38,
              lineHeight: 1.08,
              letterSpacing: "-0.02em",
              color: "var(--ink)",
              margin: 0,
            }}
          >
            Add sources
          </h1>
          <div
            style={{
              fontSize: 14.5,
              color: "var(--ink-3)",
              marginTop: 10,
              lineHeight: 1.55,
              maxWidth: 640,
            }}
          >
            Drop files, connect a repo, paste text, or point us at a URL. Everything you
            bring in is indexed into your knowledge base, chunked for retrieval, and ready
            for the workspace.
          </div>
        </div>

        {form}

        <div style={{ marginTop: 32 }}>
          <CategoryManagement
            categories={categories}
            onAddCategory={handleAddCategory}
            onRemoveCategory={handleRemoveCategory}
          />
        </div>
      </div>
    </div>
  );
}
