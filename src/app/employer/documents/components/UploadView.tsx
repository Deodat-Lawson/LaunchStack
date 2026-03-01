"use client";

import React, { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { Upload, CheckCircle2 } from "lucide-react";
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
}

interface UploadViewProps {
  /** Called after a successful upload so the parent can refresh its document list */
  onDocumentUploaded?: () => void;
}

export function UploadView({ onDocumentUploaded: _onDocumentUploaded }: UploadViewProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [useUploadThing, setUseUploadThing] = useState<boolean>(true);
  const [isUploadThingConfigured, setIsUploadThingConfigured] = useState<boolean>(false);
  const [isUpdatingPreference, setIsUpdatingPreference] = useState(false);
  const [availableProviders, setAvailableProviders] = useState<AvailableProviders>({
    azure: false,
    datalab: false,
    landingAI: false,
  });

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

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Upload className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Upload Documents</h1>
          </div>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Add new documents to your collection. Upload multiple files at once, provide details, and organize them with categories.
          </p>

          <div className="flex flex-wrap gap-4 mt-4">
            {[
              { title: "Multiple Files", desc: "Upload many documents at once" },
              { title: "Batch Settings", desc: "Apply category to all files" },
              { title: "Individual Control", desc: "Customize each document" },
            ].map((f) => (
              <div key={f.title} className="flex items-center gap-2 text-sm">
                <div className="w-5 h-5 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <span className="font-medium">{f.title}</span>
                  <span className="text-muted-foreground ml-1">— {f.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Upload Form */}
        <UploadForm
          categories={categories}
          useUploadThing={useUploadThing}
          isUploadThingConfigured={isUploadThingConfigured}
          onToggleUploadMethod={handleToggleUploadMethod}
          isUpdatingPreference={isUpdatingPreference}
          availableProviders={availableProviders}
          onAddCategory={handleAddCategory}
        />

        {/* Category Management */}
        <CategoryManagement
          categories={categories}
          onAddCategory={handleAddCategory}
          onRemoveCategory={handleRemoveCategory}
        />
      </div>
    </div>
  );
}
