"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Building2,
  Users,
  Briefcase,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  FileText,
  Scale,
  Sparkles,
  Pencil,
} from "lucide-react";
import {
  LegalGeneratorTheme,
  legalTheme as s,
} from "~/app/employer/documents/components/LegalGeneratorTheme";
import { CompanyInfoCard } from "./components/CompanyInfoCard";
import { PeopleSection } from "./components/PeopleSection";
import { ServicesSection } from "./components/ServicesSection";
import { MarketsSection } from "./components/MarketsSection";
import { ProvenanceCard } from "./components/ProvenanceCard";
import { LegalSection } from "./components/LegalSection";
import type {
  CompanyInfo,
  CompanyMetadataJSON,
  PersonEntry,
} from "@launchstack/features/company-metadata";

interface MetadataResponse {
  metadata: CompanyMetadataJSON | null;
  schemaVersion?: string;
  createdAt?: string;
  updatedAt?: string;
  message?: string;
  error?: string;
}

export interface MetadataViewProps {
  /**
   * When rendering inside the Studio drawer, drop the ambient orb background
   * and the outer viewport scroll so the view fits its bounded flex parent.
   */
  embedded?: boolean;
}

export function MetadataView({ embedded = false }: MetadataViewProps) {
  const [data, setData] = useState<MetadataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);

  const fetchMetadata = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/company/metadata");
      const result = (await response.json()) as MetadataResponse;

      if (result.error) {
        throw new Error(result.error);
      }

      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, []);

  const runExtraction = useCallback(async () => {
    setExtracting(true);
    setError(null);

    try {
      const response = await fetch("/api/company/metadata/extract", {
        method: "POST",
      });
      const result = (await response.json()) as { error?: string };

      if (result.error) {
        throw new Error(result.error);
      }

      await fetchMetadata();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setExtracting(false);
    }
  }, [fetchMetadata]);

  const handleFieldSave = useCallback(
    async (field: string, value: string) => {
      const response = await fetch("/api/company/metadata", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, value }),
      });
      if (!response.ok) {
        throw new Error("Failed to save field");
      }
      await fetchMetadata();
    },
    [fetchMetadata],
  );

  useEffect(() => {
    void fetchMetadata();
  }, [fetchMetadata]);

  if (loading && !data) {
    return (
      <LegalGeneratorTheme ambient={!embedded}>
        <div className="flex h-full flex-1 flex-col items-center justify-center py-20">
          <div
            className={s.brandMark}
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              marginBottom: 18,
            }}
          >
            <Building2 className="h-6 w-6" />
          </div>
          <div
            className="flex items-center gap-1.5"
            style={{ marginBottom: 10 }}
          >
            <span className={s.loadingDot} />
            <span className={s.loadingDot} />
            <span className={s.loadingDot} />
          </div>
          <h3
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 600,
              color: "var(--ink)",
              letterSpacing: "-0.01em",
            }}
          >
            Loading company metadata
          </h3>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 13,
              color: "var(--ink-3)",
            }}
          >
            Fetching extracted information…
          </p>
        </div>
      </LegalGeneratorTheme>
    );
  }

  if (error) {
    return (
      <LegalGeneratorTheme ambient={!embedded}>
        <div className="flex h-full flex-1 items-center justify-center py-20">
          <div
            className={`${s.banner} ${s.bannerDanger}`}
            style={{ padding: 20, maxWidth: 440 }}
          >
            <div className="flex items-start gap-3">
              <AlertCircle
                className="mt-0.5 h-5 w-5 flex-shrink-0"
                style={{ color: "var(--danger)" }}
              />
              <div className="flex-1">
                <h3
                  style={{
                    margin: 0,
                    fontSize: 15,
                    fontWeight: 600,
                    color: "var(--danger)",
                  }}
                >
                  Failed to load
                </h3>
                <p
                  style={{
                    margin: "4px 0 12px",
                    fontSize: 13,
                    color: "var(--ink-2)",
                    lineHeight: 1.55,
                  }}
                >
                  {error}
                </p>
                <button
                  className={`${s.btn} ${s.btnOutline} ${s.btnSm}`}
                  onClick={() => void fetchMetadata()}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Try again
                </button>
              </div>
            </div>
          </div>
        </div>
      </LegalGeneratorTheme>
    );
  }

  const metadata = data?.metadata;
  const hasMetadata = metadata && Object.keys(metadata.company).length > 0;

  return (
    <LegalGeneratorTheme ambient={!embedded}>
      <div className="flex h-full flex-col">
        {/* Hero header */}
        <div className="flex-shrink-0 px-6 pt-8 pb-4 md:px-10 md:pt-10">
          <div className="mx-auto w-full max-w-7xl">
            <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div className="flex items-start gap-4">
                <div className={s.brandMark}>
                  <Building2 className="h-[18px] w-[18px]" />
                </div>
                <div className="space-y-2">
                  <span className={s.eyebrow}>Company</span>
                  <h1 className={s.title}>
                    Company{" "}
                    <span className={s.highlight}>
                      <span className={s.serif}>metadata</span>
                    </span>
                  </h1>
                  <p className={s.sub} style={{ maxWidth: 620 }}>
                    Who you are as a company — people, services, markets, legal
                    footprint. Auto-extracted from your uploaded documents, and
                    editable by hand whenever the AI missed something.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {hasMetadata && (
                  <button
                    className={`${s.btn} ${
                      isEditMode ? s.btnSoft : s.btnOutline
                    }`}
                    onClick={() => setIsEditMode((v) => !v)}
                  >
                    <Pencil className="h-4 w-4" />
                    {isEditMode ? "Done editing" : "Edit fields"}
                  </button>
                )}
                <button
                  className={`${s.btn} ${s.btnOutline}`}
                  onClick={() => void fetchMetadata()}
                  disabled={loading}
                >
                  <RefreshCw
                    className={`h-4 w-4${loading ? " animate-spin" : ""}`}
                  />
                  Refresh
                </button>
                <button
                  className={`${s.btn} ${s.btnAccent}`}
                  onClick={() => void runExtraction()}
                  disabled={extracting}
                >
                  <Sparkles
                    className={`h-4 w-4${extracting ? " animate-pulse" : ""}`}
                  />
                  {extracting ? "Extracting…" : "Re-extract"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className={`flex-1 overflow-y-auto ${s.scrollbar}`}>
          <div className="mx-auto w-full max-w-7xl space-y-6 px-6 pb-10 md:px-10">
            {!hasMetadata ? (
              <EmptyState onExtract={runExtraction} extracting={extracting} />
            ) : (
              <>
                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  <StatsCard
                    title="Company fields"
                    value={
                      Object.keys(metadata.company).filter(
                        (k) => metadata.company[k],
                      ).length
                    }
                    icon={Building2}
                  />
                  <StatsCard
                    title="People"
                    value={metadata.people.length}
                    icon={Users}
                  />
                  <StatsCard
                    title="Services"
                    value={metadata.services.length}
                    icon={Briefcase}
                  />
                  <StatsCard
                    title="Legal"
                    value={(metadata.legal ?? []).length}
                    icon={Scale}
                  />
                  <StatsCard
                    title="Docs processed"
                    value={metadata.provenance.total_documents_processed}
                    icon={FileText}
                  />
                </div>

                <MissingInfoAlert
                  company={metadata.company}
                  people={metadata.people}
                />

                <CompanyInfoCard
                  company={metadata.company}
                  isEditMode={isEditMode}
                  onFieldSave={handleFieldSave}
                />

                {metadata.people.length > 0 && (
                  <PeopleSection people={metadata.people} />
                )}

                {metadata.services.length > 0 && (
                  <ServicesSection services={metadata.services} />
                )}

                {(metadata.markets.primary?.length ?? 0) > 0 ||
                (metadata.markets.geographies?.length ?? 0) > 0 ? (
                  <MarketsSection markets={metadata.markets} />
                ) : null}

                {(metadata.legal ?? []).length > 0 && (
                  <LegalSection legal={metadata.legal ?? []} />
                )}

                <ProvenanceCard
                  provenance={metadata.provenance}
                  updatedAt={data?.updatedAt}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </LegalGeneratorTheme>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────

function EmptyState({
  onExtract,
  extracting,
}: {
  onExtract: () => void | Promise<void>;
  extracting: boolean;
}) {
  return (
    <div
      className={`${s.panel} flex flex-col items-center gap-3 py-16 text-center`}
      style={{ borderStyle: "dashed" }}
    >
      <div
        className={s.brandMark}
        style={{ width: 56, height: 56, borderRadius: 14, marginBottom: 6 }}
      >
        <FileText className="h-6 w-6" />
      </div>
      <h3
        style={{
          margin: 0,
          fontSize: 19,
          fontWeight: 600,
          color: "var(--ink)",
          letterSpacing: "-0.01em",
        }}
      >
        No metadata extracted yet
      </h3>
      <p
        style={{
          margin: 0,
          fontSize: 14,
          color: "var(--ink-3)",
          maxWidth: 440,
          lineHeight: 1.55,
        }}
      >
        Upload some documents, then run an extraction. The AI will pull
        company info, people, services, and legal entities. You can edit
        anything it got wrong.
      </p>
      <button
        className={`${s.btn} ${s.btnAccent} ${s.btnLg}`}
        onClick={() => void onExtract()}
        disabled={extracting}
        style={{ marginTop: 6 }}
      >
        <Sparkles
          className={`h-4 w-4${extracting ? " animate-pulse" : ""}`}
        />
        {extracting ? "Extracting…" : "Extract metadata"}
      </button>
    </div>
  );
}

// ─── Missing info alert ───────────────────────────────────────────────────

const EXPECTED_COMPANY_FIELDS: Array<{ key: keyof CompanyInfo; label: string }> = [
  { key: "name", label: "Company name" },
  { key: "industry", label: "Industry" },
  { key: "headquarters", label: "Headquarters" },
  { key: "founded_year", label: "Founded year" },
  { key: "description", label: "Description" },
  { key: "website", label: "Website" },
  { key: "size", label: "Company size" },
];

function MissingInfoAlert({
  company,
  people,
}: {
  company: CompanyInfo;
  people: PersonEntry[];
}) {
  const missingFields = EXPECTED_COMPANY_FIELDS.filter((f) => {
    const field = company[f.key];
    if (!field) return true;
    const val = (field as { value?: unknown }).value;
    return val === undefined || val === null || val === "";
  });
  const peopleWithoutRoles = people.filter((p) => !p.role);

  if (missingFields.length === 0 && peopleWithoutRoles.length === 0) return null;

  return (
    <div className={`${s.banner} ${s.bannerWarn}`} style={{ padding: 16 }}>
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="mt-0.5 h-4 w-4 flex-shrink-0"
          style={{ color: "var(--warn)" }}
        />
        <div className="min-w-0 flex-1">
          <h4
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--ink)",
              letterSpacing: "-0.005em",
            }}
          >
            Incomplete metadata
          </h4>
          {missingFields.length > 0 && (
            <p
              style={{
                margin: "6px 0 0",
                fontSize: 13,
                color: "var(--ink-2)",
                lineHeight: 1.55,
              }}
            >
              Missing fields:{" "}
              <span style={{ fontWeight: 600, color: "var(--ink)" }}>
                {missingFields.map((f) => f.label).join(", ")}
              </span>
            </p>
          )}
          {peopleWithoutRoles.length > 0 && (
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 13,
                color: "var(--ink-2)",
                lineHeight: 1.55,
              }}
            >
              {peopleWithoutRoles.length}{" "}
              {peopleWithoutRoles.length === 1 ? "person" : "people"} without a
              role
            </p>
          )}
          <p
            style={{
              margin: "8px 0 0",
              fontSize: 12,
              color: "var(--ink-3)",
              lineHeight: 1.55,
            }}
          >
            Upload more documents and re-extract, or use{" "}
            <span style={{ fontWeight: 600 }}>Edit fields</span> to fill these
            in by hand.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Stats card ────────────────────────────────────────────────────────────

function StatsCard({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}) {
  return (
    <div
      className={s.panel}
      style={{
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div className="flex items-center justify-between">
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--ink-3)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          {title}
        </span>
        <Icon className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 600,
          color: "var(--ink)",
          letterSpacing: "-0.02em",
          lineHeight: 1.05,
        }}
      >
        {value}
      </div>
    </div>
  );
}
