"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Building2,
  Users,
  Briefcase,
  RefreshCw,
  AlertCircle,
  FileText,
  Sparkles,
  Pencil,
  Download,
} from "lucide-react";
import { Button } from "~/app/employer/documents/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "~/app/employer/documents/components/ui/card";
import { cn } from "~/lib/utils";
import { CompanyInfoCard } from "~/app/employer/metadata/components/CompanyInfoCard";
import { PeopleSection } from "~/app/employer/metadata/components/PeopleSection";
import { ServicesSection } from "~/app/employer/metadata/components/ServicesSection";
import { MarketsSection } from "~/app/employer/metadata/components/MarketsSection";
import { ProvenanceCard } from "~/app/employer/metadata/components/ProvenanceCard";
import { MetadataHistorySection } from "~/app/employer/metadata/components/MetadataHistorySection";
import type { CompanyMetadataJSON } from "~/lib/tools/company-metadata/types";

interface CompanyProfile {
  name: string;
  description: string | null;
  industry: string | null;
  numberOfEmployees: string;
}

interface MetadataResponse {
  metadata: CompanyMetadataJSON | null;
  schemaVersion?: string;
  createdAt?: string;
  updatedAt?: string;
  message?: string;
  error?: string;
}

interface StatsCardProps {
  title: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  color: "purple" | "blue" | "green" | "amber";
}

const colorMap = {
  purple: { border: "border-l-purple-500", text: "text-purple-500" },
  blue: { border: "border-l-blue-500", text: "text-blue-500" },
  green: { border: "border-l-green-500", text: "text-green-500" },
  amber: { border: "border-l-amber-500", text: "text-amber-500" },
};

function MetadataStatsCard({ title, value, icon: Icon, color }: StatsCardProps) {
  const colors = colorMap[color];
  return (
    <Card
      className={cn(
        "p-5 border-none shadow-sm bg-card flex flex-col justify-between group hover:shadow-md transition-all border-l-4",
        colors.border,
      )}
    >
      <div className="flex justify-between items-start mb-2">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
          {title}
        </span>
        <Icon className={cn("w-4 h-4", colors.text)} />
      </div>
      <div className="text-3xl font-black text-foreground">{value}</div>
    </Card>
  );
}

export function CompanyMetadataPanel() {
  const [data, setData] = useState<MetadataResponse | null>(null);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const previousDataRef = useRef<MetadataResponse | null>(null);

  const fetchMetadata = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [metaRes, profileRes] = await Promise.all([
        fetch("/api/company/metadata"),
        fetch("/api/fetchCompany"),
      ]);
      const metaResult = (await metaRes.json()) as MetadataResponse;
      if (metaResult.error) throw new Error(metaResult.error);
      setData(metaResult);

      if (profileRes.ok) {
        const profileData = (await profileRes.json()) as CompanyProfile;
        setProfile(profileData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleFieldSave = useCallback(async (path: string, value: string) => {
    previousDataRef.current = data;
    const now = new Date().toISOString();
    const manualSource = { doc_id: 0, doc_name: "Manual edit", extracted_at: now };

    // Optimistic update
    setData((prev) => {
      if (!prev?.metadata) return prev;
      const m = structuredClone(prev.metadata);
      const segments = path.split(".");

      const buildFact = (val: string | number, existing?: { visibility?: string; usage?: string }) => ({
        value: val,
        visibility: existing?.visibility ?? "public",
        usage: existing?.usage ?? "outreach_ok",
        confidence: 1.0,
        priority: "manual_override" as const,
        status: "active" as const,
        last_updated: now,
        sources: [manualSource],
      });

      if (segments[0] === "company" && segments[1]) {
        const field = segments[1];
        const existing = m.company[field];
        (m.company as Record<string, unknown>)[field] = buildFact(field === "founded_year" ? Number(value) : value, existing);
      } else if (segments[0] === "people" && segments[1] && segments[2]) {
        const idx = Number(segments[1]);
        const field = segments[2];
        const person = m.people[idx];
        if (person) {
          (person as Record<string, unknown>)[field] = buildFact(value, person[field]);
        }
      } else if (segments[0] === "services" && segments[1] && segments[2]) {
        const idx = Number(segments[1]);
        const field = segments[2];
        const service = m.services[idx];
        if (service) {
          (service as Record<string, unknown>)[field] = buildFact(value, service[field]);
        }
      } else if (segments[0] === "markets" && segments[1] && segments[2] != null) {
        const sub = segments[1] as "primary" | "verticals" | "geographies";
        const idx = Number(segments[2]);
        const arr = m.markets[sub];
        if (arr?.[idx]) {
          arr[idx] = buildFact(value, arr[idx]) as typeof arr[number];
        }
      }
      m.updated_at = now;
      return { ...prev, metadata: m };
    });
    try {
      const res = await fetch("/api/company/metadata", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, value }),
      });
      if (!res.ok) throw new Error("Save failed");
      await fetchMetadata();
    } catch (err) {
      if (previousDataRef.current !== null) {
        setData(previousDataRef.current);
      }
      throw err;
    }
  }, [data, fetchMetadata]);

  const handleExportJson = useCallback(() => {
    if (!data?.metadata) return;
    const json = JSON.stringify(data.metadata, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `company-metadata-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data]);

  const runExtraction = useCallback(async (force = false) => {
    setExtracting(true);
    setError(null);
    try {
      const response = await fetch("/api/company/metadata/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const result = (await response.json()) as { error?: string; message?: string };
      if (result.error) throw new Error(result.error);
      await fetchMetadata();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setExtracting(false);
    }
  }, [fetchMetadata]);

  useEffect(() => {
    void fetchMetadata();
  }, [fetchMetadata]);

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20">
        <div className="relative mb-8">
          <div className="w-20 h-20 border-4 border-purple-100 dark:border-purple-900/30 rounded-full border-t-purple-600 dark:border-t-purple-500 animate-spin" />
          <Building2 className="w-8 h-8 text-purple-600 dark:text-purple-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
        </div>
        <h3 className="text-xl font-bold text-foreground mb-2">Loading Company Metadata</h3>
        <p className="text-muted-foreground max-w-sm text-center font-medium">
          Fetching extracted company information...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20">
        <Card className="p-6 border-destructive/20 bg-destructive/10 max-w-md">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-destructive/20 rounded-lg">
              <AlertCircle className="w-6 h-6 text-destructive" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-destructive">Failed to Load</h3>
              <p className="text-destructive text-sm mt-1 font-medium">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void fetchMetadata()}
                className="mt-4 border-destructive/30 text-destructive hover:bg-destructive/10"
              >
                Try Again
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const metadata = data?.metadata;
  const hasMetadata = metadata && Object.keys(metadata.company).length > 0;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-6xl mx-auto px-8 py-8 space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-600 rounded-2xl shadow-lg shadow-purple-500/20">
              <Building2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground leading-tight">Company Metadata</h1>
              <p className="text-sm text-muted-foreground font-medium mt-1">
                Your company profile and AI-extracted intelligence
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button
              onClick={handleExportJson}
              disabled={!data?.metadata}
              variant="outline"
              className="rounded-xl h-9 px-4 gap-2 font-bold"
            >
              <Download className="w-4 h-4" />
              Export JSON
            </Button>
            <Button
              onClick={() => void runExtraction(false)}
              disabled={extracting}
              variant="outline"
              className="rounded-xl h-9 px-4 gap-2 font-bold"
              title="Process only new documents since last extraction"
            >
              <Sparkles className={cn("w-4 h-4", extracting && "animate-pulse")} />
              {extracting ? "Extracting..." : "Extract New"}
            </Button>
            <Button
              onClick={() => void runExtraction(true)}
              disabled={extracting}
              variant="outline"
              className="rounded-xl h-9 px-4 gap-2 font-bold text-amber-600 hover:text-amber-700 border-amber-200 hover:border-amber-300"
              title="Re-process all documents from scratch"
            >
              <RefreshCw className={cn("w-4 h-4", extracting && "animate-spin")} />
              Full Re-extract
            </Button>
            <Button
              onClick={() => setIsEditMode((prev) => !prev)}
              variant={isEditMode ? "default" : "outline"}
              className={cn(
                "rounded-xl h-9 px-4 gap-2 font-bold",
                isEditMode && "bg-purple-600 hover:bg-purple-700 text-white shadow-lg shadow-purple-500/20",
              )}
            >
              <Pencil className="w-4 h-4" />
              {isEditMode ? "Done" : "Edit"}
            </Button>
            <Button
              onClick={() => void fetchMetadata()}
              disabled={loading}
              className="bg-purple-600 hover:bg-purple-700 text-white rounded-xl h-9 px-4 shadow-lg shadow-purple-500/20 gap-2 font-bold"
            >
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
              {loading ? "Refreshing..." : "Refresh"}
            </Button>
          </div>
        </div>

        {/* Company Profile (user-authored) */}
        {profile && (
          <Card className="border-none shadow-sm">
            <CardHeader className="border-b border-border pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-600 rounded-lg">
                    <Users className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-lg font-bold">Company Profile</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Your company details from Settings
                    </p>
                  </div>
                </div>
                <Link href="/employer/documents?view=settings">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl h-8 px-3 gap-1.5 text-xs font-bold"
                  >
                    <Pencil className="w-3 h-3" />
                    Edit
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50">
                  <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg shrink-0">
                    <Building2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Company Name
                    </span>
                    <p className="text-foreground font-medium mt-1">{profile.name || "Not set"}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50">
                  <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg shrink-0">
                    <Briefcase className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Industry / Sector
                    </span>
                    <p className="text-foreground font-medium mt-1">{profile.industry || "Not set"}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50">
                  <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg shrink-0">
                    <Users className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Employees
                    </span>
                    <p className="text-foreground font-medium mt-1">{profile.numberOfEmployees || "Not set"}</p>
                  </div>
                </div>
              </div>
              {profile.description && (
                <div className="mt-4 p-4 rounded-lg bg-muted/50">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Description
                  </span>
                  <p className="text-foreground leading-relaxed mt-1">{profile.description}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {!hasMetadata ? (
          <Card className="p-12 border-dashed border-2">
            <div className="flex flex-col items-center text-center">
              <div className="p-4 bg-purple-100 dark:bg-purple-900/30 rounded-full mb-6">
                <FileText className="w-12 h-12 text-purple-600 dark:text-purple-400" />
              </div>
              <h3 className="text-xl font-bold text-foreground mb-2">No Metadata Extracted Yet</h3>
              <p className="text-muted-foreground max-w-md mb-6">
                Upload documents and run the extraction process to automatically extract company
                information, people, services, and more.
              </p>
              <Button
                onClick={() => void runExtraction()}
                disabled={extracting}
                className="bg-purple-600 hover:bg-purple-700 text-white rounded-xl h-11 px-8 shadow-lg shadow-purple-500/20 gap-2 font-bold"
              >
                <Sparkles className={cn("w-4 h-4", extracting && "animate-spin")} />
                {extracting ? "Extracting..." : "Extract Metadata Now"}
              </Button>
            </div>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetadataStatsCard
                title="Company Fields"
                value={Object.keys(metadata.company).filter((k) => metadata.company[k]).length}
                icon={Building2}
                color="purple"
              />
              <MetadataStatsCard title="People" value={metadata.people.length} icon={Users} color="blue" />
              <MetadataStatsCard
                title="Services"
                value={metadata.services.length}
                icon={Briefcase}
                color="green"
              />
              <MetadataStatsCard
                title="Documents Processed"
                value={metadata.provenance.total_documents_processed}
                icon={FileText}
                color="amber"
              />
            </div>

            <CompanyInfoCard
              company={metadata.company}
              isEditMode={isEditMode}
              onFieldSave={handleFieldSave}
            />

            {metadata.people.length > 0 && (
              <PeopleSection people={metadata.people} isEditMode={isEditMode} onFieldSave={handleFieldSave} />
            )}

            {metadata.services.length > 0 && (
              <ServicesSection services={metadata.services} isEditMode={isEditMode} onFieldSave={handleFieldSave} />
            )}

            {(metadata.markets.primary?.length ?? 0) > 0 ||
            (metadata.markets.geographies?.length ?? 0) > 0 ? (
              <MarketsSection markets={metadata.markets} isEditMode={isEditMode} onFieldSave={handleFieldSave} />
            ) : null}

            <ProvenanceCard provenance={metadata.provenance} updatedAt={data?.updatedAt} />

            <MetadataHistorySection />
          </>
        )}
      </div>
    </div>
  );
}
