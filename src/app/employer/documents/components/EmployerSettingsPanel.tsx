"use client";

import React, { useEffect, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import {
  Settings,
  Brain,
  Building2,
  User,
  Mail,
  Users,
  Save,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileText,
  Briefcase,
} from "lucide-react";
import { Button } from "~/app/employer/documents/components/ui/button";
import { Input } from "~/app/employer/documents/components/ui/input";
import { cn } from "~/lib/utils";
import { toast } from "sonner";

interface RedactedKey {
  hasKey: boolean;
  last4: string | null;
}

interface Company {
  id: number;
  name: string;
  description: string | null;
  industry: string | null;
  employerpasskey: string;
  employeepasskey: string;
  embeddingIndexKey: string | null;
  embeddingOpenAIApiKey: RedactedKey;
  embeddingHuggingFaceApiKey: RedactedKey;
  embeddingOllamaBaseUrl: string | null;
  embeddingOllamaModel: string | null;
  numberOfEmployees: string;
  createdAt: string;
  updatedAt: string;
}

interface EmbeddingIndexOption {
  indexKey: string;
  label: string;
  provider: string;
  dimension: number;
}

export function EmployerSettingsPanel() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [companyDescription, setCompanyDescription] = useState("");
  const [companyIndustry, setCompanyIndustry] = useState("");
  const [staffCount, setStaffCount] = useState("");
  const [embeddingIndexKey, setEmbeddingIndexKey] = useState("legacy-openai-1536");
  const [embeddingOpenAIApiKey, setEmbeddingOpenAIApiKey] = useState("");
  const [embeddingHuggingFaceApiKey, setEmbeddingHuggingFaceApiKey] = useState("");
  const [embeddingOllamaBaseUrl, setEmbeddingOllamaBaseUrl] = useState("");
  const [embeddingOllamaModel, setEmbeddingOllamaModel] = useState("");
  const [hasExistingOpenAIKey, setHasExistingOpenAIKey] = useState(false);
  const [openAIKeyLast4, setOpenAIKeyLast4] = useState<string | null>(null);
  const [hasExistingHFKey, setHasExistingHFKey] = useState(false);
  const [hfKeyLast4, setHFKeyLast4] = useState<string | null>(null);
  const [indexOptions, setIndexOptions] = useState<EmbeddingIndexOption[]>([]);
  const [employerPasskey, setEmployerPasskey] = useState("");
  const [employeePasskey, setEmployeePasskey] = useState("");

  const displayName = user?.fullName ?? "";
  const email = user?.emailAddresses[0]?.emailAddress ?? "";

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    const fetchAll = async () => {
      try {
        const [companyRes, indexesRes] = await Promise.all([
          fetch("/api/fetchCompany"),
          fetch("/api/embedding-indexes"),
        ]);
        if (!companyRes.ok) throw new Error("Failed to fetch company info");
        const data = (await companyRes.json()) as Company;
        if (indexesRes.ok) {
          const indexesJson = (await indexesRes.json()) as {
            indexes: EmbeddingIndexOption[];
          };
          setIndexOptions(indexesJson.indexes ?? []);
        }
        setCompanyName(data.name ?? "");
        setCompanyDescription(data.description ?? "");
        setCompanyIndustry(data.industry ?? "");
        setStaffCount(data.numberOfEmployees ?? "");
        setEmbeddingIndexKey(data.embeddingIndexKey ?? "legacy-openai-1536");
        setHasExistingOpenAIKey(data.embeddingOpenAIApiKey?.hasKey ?? false);
        setOpenAIKeyLast4(data.embeddingOpenAIApiKey?.last4 ?? null);
        setHasExistingHFKey(data.embeddingHuggingFaceApiKey?.hasKey ?? false);
        setHFKeyLast4(data.embeddingHuggingFaceApiKey?.last4 ?? null);
        setEmbeddingOpenAIApiKey("");
        setEmbeddingHuggingFaceApiKey("");
        setEmbeddingOllamaBaseUrl(data.embeddingOllamaBaseUrl ?? "");
        setEmbeddingOllamaModel(data.embeddingOllamaModel ?? "");
        setEmployerPasskey(data.employerpasskey ?? "");
        setEmployeePasskey(data.employeepasskey ?? "");
      } catch (err) {
        setError("Failed to load company settings.");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    void fetchAll();
  }, [isLoaded, isSignedIn]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const body: Record<string, unknown> = {
        name: companyName,
        description: companyDescription || null,
        industry: companyIndustry || null,
        embeddingIndexKey: embeddingIndexKey || null,
        embeddingOllamaBaseUrl: embeddingOllamaBaseUrl || null,
        embeddingOllamaModel: embeddingOllamaModel || null,
        numberOfEmployees: staffCount,
        employerPasskey,
        employeePasskey,
      };
      // Only send API keys if the user actually typed something. Blank means
      // "keep whatever is already stored"; we never round-trip the stored key.
      if (embeddingOpenAIApiKey.trim().length > 0) {
        body.embeddingOpenAIApiKey = embeddingOpenAIApiKey.trim();
      }
      if (embeddingHuggingFaceApiKey.trim().length > 0) {
        body.embeddingHuggingFaceApiKey = embeddingHuggingFaceApiKey.trim();
      }

      const response = await fetch("/api/updateCompany", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as {
        success?: boolean;
        message?: string;
        code?: string;
        documentCount?: number;
      };

      if (response.status === 409 && result?.code === "REINDEX_IN_PROGRESS") {
        throw new Error(
          result.message ??
            "A reindex is already running. Wait for it to finish before changing the index again.",
        );
      }

      if (!response.ok || result?.success !== true) {
        throw new Error(result?.message ?? "Error updating settings");
      }

      // 202 with REINDEX_SCHEDULED: the index change is queued as a
      // background job. Surface a clear message so the user knows their
      // change was accepted and is re-embedding.
      if (response.status === 202 && result?.code === "REINDEX_SCHEDULED") {
        toast.success(
          result.message ??
            `Reindex scheduled for ${result.documentCount ?? 0} document(s). Queries continue to use the previous index until the rewrite completes.`,
          { duration: 8000 },
        );
      }
      setSaveSuccess(true);
      if (embeddingOpenAIApiKey.trim().length > 0) {
        setHasExistingOpenAIKey(true);
        setOpenAIKeyLast4(embeddingOpenAIApiKey.trim().slice(-4));
        setEmbeddingOpenAIApiKey("");
      }
      if (embeddingHuggingFaceApiKey.trim().length > 0) {
        setHasExistingHFKey(true);
        setHFKeyLast4(embeddingHuggingFaceApiKey.trim().slice(-4));
        setEmbeddingHuggingFaceApiKey("");
      }
      toast.success(result?.message ?? "Company settings saved!");
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update settings.");
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
          <p className="text-sm text-muted-foreground">Loading settings...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-background p-8">
        <div className="max-w-sm w-full p-5 rounded-xl border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-red-700 dark:text-red-400">Error</p>
              <p className="text-xs text-red-600/80 mt-1">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background custom-scrollbar">
      {/* Page Header */}
      <div className="border-b border-border px-8 py-4 flex items-center justify-between sticky top-0 bg-background/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center shadow-sm shadow-purple-500/20">
            <Settings className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-foreground leading-none">Settings</h1>
            <p className="text-[10px] text-muted-foreground mt-0.5">Manage your account and company profile</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-8 py-8 space-y-8">
        {/* Profile (read-only) */}
        <section>
          <h2 className="text-xs font-black text-muted-foreground uppercase tracking-[0.15em] mb-4">
            Your Profile
          </h2>
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">
                <User className="w-3 h-3" />
                Display Name
              </label>
              <Input
                value={displayName}
                disabled
                className="bg-muted/30 border-border text-muted-foreground h-9 text-sm cursor-not-allowed"
              />
            </div>
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">
                <Mail className="w-3 h-3" />
                Email Address
              </label>
              <Input
                value={email}
                disabled
                className="bg-muted/30 border-border text-muted-foreground h-9 text-sm cursor-not-allowed"
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Profile details are managed through your authentication provider.
            </p>
          </div>
        </section>

        {/* Company Profile (editable) */}
        <section>
          <h2 className="text-xs font-black text-muted-foreground uppercase tracking-[0.15em] mb-4">
            Company Profile
          </h2>
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="companyName"
                className="flex items-center gap-1.5 text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]"
              >
                <Building2 className="w-3 h-3" />
                Company Name
              </label>
              <Input
                id="companyName"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Your company name"
                className="h-9 text-sm border-border focus-visible:ring-1 focus-visible:ring-purple-500"
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="companyDescription"
                className="flex items-center gap-1.5 text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]"
              >
                <FileText className="w-3 h-3" />
                Company Description
              </label>
              <textarea
                id="companyDescription"
                value={companyDescription}
                onChange={(e) => setCompanyDescription(e.target.value)}
                placeholder="Describe what your company does, its mission, and key products or services..."
                rows={4}
                className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-500 disabled:cursor-not-allowed disabled:opacity-50 resize-y min-h-[80px]"
              />
              <p className="text-[10px] text-muted-foreground">
                Your description powers AI features like marketing campaigns and document analysis.
              </p>
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="companyIndustry"
                className="flex items-center gap-1.5 text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]"
              >
                <Briefcase className="w-3 h-3" />
                Industry / Sector
              </label>
              <Input
                id="companyIndustry"
                value={companyIndustry}
                onChange={(e) => setCompanyIndustry(e.target.value)}
                placeholder="e.g. Technology, Healthcare, Finance..."
                className="h-9 text-sm border-border focus-visible:ring-1 focus-visible:ring-purple-500"
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="staffCount"
                className="flex items-center gap-1.5 text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]"
              >
                <Users className="w-3 h-3" />
                Number of Employees
              </label>
              <Input
                id="staffCount"
                type="number"
                value={staffCount}
                onChange={(e) => setStaffCount(e.target.value)}
                placeholder="e.g. 25"
                className="h-9 text-sm border-border focus-visible:ring-1 focus-visible:ring-purple-500"
              />
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-xs font-black text-muted-foreground uppercase tracking-[0.15em] mb-4">
            Embedding Configuration
          </h2>
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="embeddingIndexKey"
                className="flex items-center gap-1.5 text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]"
              >
                <Brain className="w-3 h-3" />
                Default Embedding Index
              </label>
              <select
                id="embeddingIndexKey"
                value={embeddingIndexKey}
                onChange={(e) => setEmbeddingIndexKey(e.target.value)}
                className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-500"
                disabled={indexOptions.length === 0}
              >
                {indexOptions.length === 0 ? (
                  <option value="">Loading available indexes…</option>
                ) : (
                  indexOptions.map((option) => (
                    <option key={option.indexKey} value={option.indexKey}>
                      {option.label}
                    </option>
                  ))
                )}
              </select>
              <p className="text-[10px] text-muted-foreground">
                Changing this on a company with existing documents queues a background reindex; queries keep using the previous index until the rewrite completes.
              </p>
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="embeddingOpenAIApiKey"
                className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em] block"
              >
                OpenAI API Key (optional)
              </label>
              <Input
                id="embeddingOpenAIApiKey"
                type="password"
                value={embeddingOpenAIApiKey}
                onChange={(e) => setEmbeddingOpenAIApiKey(e.target.value)}
                placeholder={
                  hasExistingOpenAIKey
                    ? `Stored key ending in …${openAIKeyLast4 ?? "****"} — leave blank to keep`
                    : "Falls back to server env when blank"
                }
                autoComplete="off"
                className="h-9 text-sm border-border focus-visible:ring-1 focus-visible:ring-purple-500"
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="embeddingHuggingFaceApiKey"
                className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em] block"
              >
                Hugging Face API Key (optional)
              </label>
              <Input
                id="embeddingHuggingFaceApiKey"
                type="password"
                value={embeddingHuggingFaceApiKey}
                onChange={(e) => setEmbeddingHuggingFaceApiKey(e.target.value)}
                placeholder={
                  hasExistingHFKey
                    ? `Stored key ending in …${hfKeyLast4 ?? "****"} — leave blank to keep`
                    : "Falls back to server env when blank"
                }
                autoComplete="off"
                className="h-9 text-sm border-border focus-visible:ring-1 focus-visible:ring-purple-500"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="embeddingOllamaBaseUrl"
                  className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em] block"
                >
                  Ollama Base URL (optional)
                </label>
                <Input
                  id="embeddingOllamaBaseUrl"
                  value={embeddingOllamaBaseUrl}
                  onChange={(e) => setEmbeddingOllamaBaseUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  className="h-9 text-sm border-border focus-visible:ring-1 focus-visible:ring-purple-500"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="embeddingOllamaModel"
                  className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em] block"
                >
                  Ollama Model (optional)
                </label>
                <Input
                  id="embeddingOllamaModel"
                  value={embeddingOllamaModel}
                  onChange={(e) => setEmbeddingOllamaModel(e.target.value)}
                  placeholder="nomic-embed-text"
                  className="h-9 text-sm border-border focus-visible:ring-1 focus-visible:ring-purple-500"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Save button */}
        <div className="flex items-center gap-3">
          <Button
            onClick={() => void handleSave()}
            disabled={isSaving}
            className={cn(
              "h-9 px-5 text-sm font-semibold gap-2 transition-all",
              saveSuccess
                ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-500/20"
                : "bg-purple-600 hover:bg-purple-700 text-white shadow-sm shadow-purple-500/20"
            )}
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : saveSuccess ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {isSaving ? "Saving..." : saveSuccess ? "Saved!" : "Save All Changes"}
          </Button>
          {saveSuccess && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium animate-in fade-in">
              Changes saved successfully
            </span>
          )}
        </div>

        {/* Account */}
        <section>
          <h2 className="text-xs font-black text-muted-foreground uppercase tracking-[0.15em] mb-4">
            Account
          </h2>
          <div className="bg-card border border-border rounded-xl p-5">
            <p className="text-xs text-muted-foreground leading-relaxed">
              To manage advanced account settings, billing, or data exports, please contact your administrator or visit the support portal.
            </p>
          </div>
        </section>
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: hsl(var(--border)); border-radius: 10px; }
      `}</style>
    </div>
  );
}
