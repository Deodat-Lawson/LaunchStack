"use client";

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
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
  Globe,
  Plus,
  Download,
  ArrowRight,
  X,
} from "lucide-react";
import {
  LegalGeneratorTheme,
  legalTheme as s,
} from "~/app/employer/documents/components/LegalGeneratorTheme";
import m from "./components/metadata.module.css";
import { CompanyInfoCard } from "./components/CompanyInfoCard";
import { PeopleSection } from "./components/PeopleSection";
import { ServicesSection } from "./components/ServicesSection";
import { MarketsSection } from "./components/MarketsSection";
import { ProvenanceCard } from "./components/ProvenanceCard";
import { LegalSection } from "./components/LegalSection";
import type {
  CompanyInfo,
  CompanyMetadataJSON,
  MetadataFact,
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
   * and the sticky table-of-contents so the view fits its bounded flex parent.
   */
  embedded?: boolean;
}

const EXPECTED_COMPANY_FIELDS: Array<{
  key: keyof CompanyInfo;
  label: string;
}> = [
  { key: "name", label: "Company name" },
  { key: "industry", label: "Industry" },
  { key: "headquarters", label: "Headquarters" },
  { key: "founded_year", label: "Founded year" },
  { key: "description", label: "Description" },
  { key: "website", label: "Website" },
  { key: "size", label: "Company size" },
];

type SectionId =
  | "identity"
  | "people"
  | "services"
  | "markets"
  | "legal"
  | "provenance";

export function MetadataView({ embedded = false }: MetadataViewProps) {
  const [data, setData] = useState<MetadataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>("identity");

  const fetchMetadata = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/company/metadata");
      const result = (await response.json()) as MetadataResponse;
      if (result.error) throw new Error(result.error);
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
      if (result.error) throw new Error(result.error);
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
      if (!response.ok) throw new Error("Failed to save field");
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
            style={{ width: 56, height: 56, borderRadius: 14, marginBottom: 18 }}
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
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink-3)" }}>
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

  const metadata = data?.metadata ? normalizeMetadata(data.metadata) : null;
  const hasMetadata = !!(
    metadata &&
    (Object.keys(metadata.company).length > 0 ||
      metadata.people.length > 0 ||
      metadata.services.length > 0)
  );

  return (
    <LegalGeneratorTheme ambient={!embedded}>
      <div className={`flex h-full flex-1 flex-col overflow-y-auto ${s.scrollbar}`}>
        <div className={`${m.page} ${embedded ? m.pageEmbedded : ""}`}>
          {!embedded && hasMetadata && metadata && (
            <TableOfContents
              metadata={metadata}
              activeSection={activeSection}
              onChange={setActiveSection}
            />
          )}

          <Main
            metadata={metadata ?? null}
            updatedAt={data?.updatedAt}
            hasMetadata={hasMetadata}
            embedded={embedded}
            loading={loading}
            extracting={extracting}
            bannerDismissed={bannerDismissed}
            onDismissBanner={() => setBannerDismissed(true)}
            onRefresh={fetchMetadata}
            onExtract={runExtraction}
            onFieldSave={handleFieldSave}
            onSectionChange={setActiveSection}
          />
        </div>
      </div>
    </LegalGeneratorTheme>
  );
}

// ─── TOC ──────────────────────────────────────────────────────────────────

interface TableOfContentsProps {
  metadata: CompanyMetadataJSON;
  activeSection: SectionId;
  onChange: (id: SectionId) => void;
}

function TableOfContents({
  metadata,
  activeSection,
  onChange,
}: TableOfContentsProps) {
  const counts = useMemo(() => {
    const identityFilled = EXPECTED_COMPANY_FIELDS.filter(
      (f) => !!metadata.company[f.key],
    ).length;
    return {
      identity: identityFilled,
      people: metadata.people.length,
      services: metadata.services.length,
      markets:
        (metadata.markets.primary?.length ?? 0) +
        (metadata.markets.verticals?.length ?? 0) +
        (metadata.markets.geographies?.length ?? 0),
      legal: metadata.legal.length,
    };
  }, [metadata]);

  const items: Array<{
    id: SectionId;
    label: string;
    count?: number | string;
  }> = [
    { id: "identity", label: "Identity", count: counts.identity },
    { id: "people", label: "People", count: counts.people },
    { id: "services", label: "Services", count: counts.services },
    { id: "markets", label: "Markets", count: counts.markets },
    { id: "legal", label: "Legal", count: counts.legal },
    { id: "provenance", label: "Provenance", count: "·" },
  ];

  const handleClick = (id: SectionId) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    onChange(id);
  };

  return (
    <aside className={m.toc} aria-label="On this page">
      <div className={m.tocTitle}>On this page</div>
      <ul className={m.tocList}>
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={`${m.tocLink} ${
                activeSection === item.id ? m.tocLinkActive : ""
              }`}
              onClick={() => handleClick(item.id)}
            >
              <span>{item.label}</span>
              <span className={m.tocCount}>{item.count}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className={m.tocFoot}>
        Hover any field and click <kbd>✎</kbd> to edit it inline. Sources are
        linked from each fact.
      </div>
    </aside>
  );
}

// ─── Main column ──────────────────────────────────────────────────────────

interface MainProps {
  metadata: CompanyMetadataJSON | null;
  updatedAt?: string;
  hasMetadata: boolean;
  embedded: boolean;
  loading: boolean;
  extracting: boolean;
  bannerDismissed: boolean;
  onDismissBanner: () => void;
  onRefresh: () => Promise<void> | void;
  onExtract: () => Promise<void> | void;
  onFieldSave: (field: string, value: string) => Promise<void>;
  onSectionChange: (id: SectionId) => void;
}

function Main({
  metadata,
  updatedAt,
  hasMetadata,
  embedded,
  loading,
  extracting,
  bannerDismissed,
  onDismissBanner,
  onRefresh,
  onExtract,
  onFieldSave,
  onSectionChange,
}: MainProps) {
  const sectionRefs = useRef<Map<SectionId, HTMLElement>>(new Map());

  const setRef = useCallback(
    (id: SectionId) => (el: HTMLElement | null) => {
      const map = sectionRefs.current;
      if (el) map.set(id, el);
      else map.delete(id);
    },
    [],
  );

  useEffect(() => {
    if (embedded || !hasMetadata) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.id as SectionId;
            if (id) onSectionChange(id);
          }
        }
      },
      { rootMargin: "-20% 0px -60% 0px" },
    );
    sectionRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [embedded, hasMetadata, onSectionChange]);

  const handleExportJson = () => {
    if (!metadata) return;
    try {
      const blob = new Blob([JSON.stringify(metadata, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `company-metadata-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  };

  return (
    <main style={{ minWidth: 0 }}>
      <PageHeader
        embedded={embedded}
        hasMetadata={hasMetadata}
        loading={loading}
        extracting={extracting}
        onRefresh={onRefresh}
        onExtract={onExtract}
        onExportJson={handleExportJson}
      />

      {!hasMetadata || !metadata ? (
        <EmptyState onExtract={onExtract} extracting={extracting} />
      ) : (
        <>
          <SummaryStrip metadata={metadata} updatedAt={updatedAt} />

          {!bannerDismissed && (
            <MissingInfoBanner
              metadata={metadata}
              onDismiss={onDismissBanner}
              onJump={(id) => {
                const el = document.getElementById(id);
                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                onSectionChange(id);
              }}
            />
          )}

          <SectionPanel
            id="identity"
            sectionRef={setRef("identity")}
            icon={<Building2 width={15} height={15} />}
            title="Identity"
            help="The basic facts about your company. Fields with low confidence or empty values appear inline."
          >
            <CompanyInfoCard
              company={metadata.company}
              onFieldSave={onFieldSave}
            />
          </SectionPanel>

          {metadata.people.length > 0 && (
            <SectionPanel
              id="people"
              sectionRef={setRef("people")}
              icon={<Users width={15} height={15} />}
              title="People"
              count={metadata.people.length}
              countLabel="extracted"
              help="Founders, employees, and key contacts mentioned in your uploads."
              tools={
                <button className={`${s.btn} ${s.btnOutline} ${s.btnSm}`}>
                  <Plus className="h-3 w-3" />
                  Add person
                </button>
              }
            >
              <PeopleSection
                people={metadata.people}
                onFieldSave={onFieldSave}
              />
            </SectionPanel>
          )}

          {metadata.services.length > 0 && (
            <SectionPanel
              id="services"
              sectionRef={setRef("services")}
              icon={<Briefcase width={15} height={15} />}
              title="Services & products"
              count={metadata.services.length}
              countLabel="identified"
              help="What you sell or ship to customers."
              tools={
                <button className={`${s.btn} ${s.btnOutline} ${s.btnSm}`}>
                  <Plus className="h-3 w-3" />
                  Add
                </button>
              }
            >
              <ServicesSection
                services={metadata.services}
                onFieldSave={onFieldSave}
              />
            </SectionPanel>
          )}

          {((metadata.markets.primary?.length ?? 0) > 0 ||
            (metadata.markets.verticals?.length ?? 0) > 0 ||
            (metadata.markets.geographies?.length ?? 0) > 0) && (
            <SectionPanel
              id="markets"
              sectionRef={setRef("markets")}
              icon={<Globe width={15} height={15} />}
              title="Markets"
              help="Who you sell to and where you operate."
            >
              <MarketsSection markets={metadata.markets} />
            </SectionPanel>
          )}

          {metadata.legal.length > 0 && (
            <SectionPanel
              id="legal"
              sectionRef={setRef("legal")}
              icon={<Scale width={15} height={15} />}
              title="Legal"
              count={metadata.legal.length}
              help="Documents, entities, and policies extracted from your filings."
              tools={
                <button className={`${s.btn} ${s.btnOutline} ${s.btnSm}`}>
                  <Plus className="h-3 w-3" />
                  Add entity
                </button>
              }
            >
              <LegalSection legal={metadata.legal} />
            </SectionPanel>
          )}

          <section id="provenance" ref={setRef("provenance")}>
            <ProvenanceCard
              provenance={metadata.provenance}
              updatedAt={updatedAt}
              manualEditCount={countManualEdits(metadata)}
            />
          </section>
        </>
      )}
    </main>
  );
}

// ─── Page header ──────────────────────────────────────────────────────────

interface PageHeaderProps {
  embedded?: boolean;
  hasMetadata: boolean;
  loading: boolean;
  extracting: boolean;
  onRefresh: () => Promise<void> | void;
  onExtract: () => Promise<void> | void;
  onExportJson: () => void;
}

function PageHeader({
  embedded = false,
  hasMetadata,
  loading,
  extracting,
  onRefresh,
  onExtract,
  onExportJson,
}: PageHeaderProps) {
  return (
    <header
      className={`${m.pageHeaderGrid} ${embedded ? m.pageHeaderEmbedded : ""}`}
    >
      <div>
        <span className={`${s.eyebrow} ${s.eyebrowPlain}`}>Company</span>
        <h1 className={s.title} style={{ marginTop: 8 }}>
          Company{" "}
          <span className={s.highlight}>
            <span className={s.serif}>metadata</span>
          </span>
        </h1>
        <p className={s.sub} style={{ marginTop: 8, maxWidth: 600 }}>
          Who you are, in machine-readable form. Auto-extracted from your
          uploads, edited by hand whenever the AI missed something — and ready
          to feed into every workflow.
        </p>
      </div>
      <div className={m.headerToolbar} role="toolbar" aria-label="Metadata actions">
        {hasMetadata && (
          <button
            type="button"
            className={`${s.btn} ${s.btnOutline} ${m.metaHeaderBtn}`}
            onClick={onExportJson}
          >
            <Download width={14} height={14} aria-hidden strokeWidth={2} />
            Export JSON
          </button>
        )}
        <button
          type="button"
          className={`${s.btn} ${s.btnOutline} ${m.metaHeaderBtn}`}
          onClick={() => void onRefresh()}
          disabled={loading}
        >
          <RefreshCw
            width={14}
            height={14}
            aria-hidden
            strokeWidth={2}
            className={loading ? "animate-spin" : undefined}
          />
          Refresh
        </button>
        <button
          type="button"
          className={`${s.btn} ${s.btnAccent} ${m.metaHeaderBtn}`}
          onClick={() => void onExtract()}
          disabled={extracting}
        >
          <Sparkles
            width={14}
            height={14}
            aria-hidden
            strokeWidth={2}
            className={extracting ? "animate-pulse" : undefined}
          />
          {extracting ? "Extracting…" : "Re-extract"}
        </button>
      </div>
    </header>
  );
}

// ─── Summary strip ────────────────────────────────────────────────────────

interface SummaryStripProps {
  metadata: CompanyMetadataJSON;
  updatedAt?: string;
}

function SummaryStrip({ metadata, updatedAt }: SummaryStripProps) {
  const completeness = useMemo(() => {
    const total = EXPECTED_COMPANY_FIELDS.length;
    const filled = EXPECTED_COMPANY_FIELDS.filter(
      (f) => !!metadata.company[f.key],
    ).length;
    const missingCompany = total - filled;
    const peopleWithoutRoles = metadata.people.filter((p) => !p.role).length;
    const baseScore = filled / total;
    const peoplePenalty =
      metadata.people.length > 0
        ? (peopleWithoutRoles / metadata.people.length) * 0.15
        : 0;
    const pct = Math.max(
      0,
      Math.min(100, Math.round((baseScore - peoplePenalty) * 100)),
    );
    let headline = "Solid foundation";
    if (pct < 35) headline = "Just getting started";
    else if (pct < 70) headline = "Coming together";
    else if (pct >= 90) headline = "Looking great";
    return { pct, missingCompany, peopleWithoutRoles, headline };
  }, [metadata]);

  const peopleWithEmail = metadata.people.filter((p) => !!p.email).length;
  const peopleManual = metadata.people.filter(
    (p) => p.name.priority === "manual_override",
  ).length;

  const servicesActive = metadata.services.filter((svc) => {
    const v = svc.status ? String(svc.status.value).toLowerCase() : "active";
    return !v.includes("deprecat") && !v.includes("upcoming");
  }).length;
  const servicesUpcoming = metadata.services.length - servicesActive;

  const lastExtracted = updatedAt ? formatRelativeShort(updatedAt) : "—";

  return (
    <div className={m.summary} role="region" aria-label="Summary">
      <div className={m.smCell}>
        <div className={m.smLabel}>Completeness</div>
        <div className={m.ringWrap}>
          <div
            className={m.ring}
            style={{ ["--pct" as never]: completeness.pct } as React.CSSProperties}
          >
            <span className={m.ringNum}>
              {completeness.pct}
              <span>%</span>
            </span>
          </div>
          <div>
            <div className={m.ringHeadline}>{completeness.headline}</div>
            <div className={m.smDetail}>
              {completeness.missingCompany > 0
                ? `${completeness.missingCompany} missing field${
                    completeness.missingCompany === 1 ? "" : "s"
                  }`
                : "All key fields present"}
              {completeness.peopleWithoutRoles > 0 && (
                <>
                  {" · "}
                  {completeness.peopleWithoutRoles} person
                  {completeness.peopleWithoutRoles === 1 ? "" : "s"} without
                  role
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className={m.smCell}>
        <div className={m.smLabel}>People</div>
        <div className={m.smValue}>
          {metadata.people.length}
          <span className={m.smUnit}>
            {metadata.people.length === 1 ? "person" : "people"}
          </span>
        </div>
        <div className={m.smDetail}>
          {peopleWithEmail} with email
          {peopleManual > 0 && ` · ${peopleManual} manually edited`}
        </div>
      </div>
      <div className={m.smCell}>
        <div className={m.smLabel}>Services</div>
        <div className={m.smValue}>
          {metadata.services.length}
          <span className={m.smUnit}>
            {metadata.services.length === 1 ? "service" : "services"}
          </span>
        </div>
        <div className={m.smDetail}>
          {servicesActive} active
          {servicesUpcoming > 0 && ` · ${servicesUpcoming} other`}
        </div>
      </div>
      <div className={m.smCell}>
        <div className={m.smLabel}>Sources</div>
        <div className={m.smValue}>
          {metadata.provenance.total_documents_processed}
          <span className={m.smUnit}>
            {metadata.provenance.total_documents_processed === 1
              ? "document"
              : "documents"}
          </span>
        </div>
        <div className={m.smDetail}>Last extracted {lastExtracted}</div>
      </div>
    </div>
  );
}

// ─── Missing info banner ──────────────────────────────────────────────────

interface MissingInfoBannerProps {
  metadata: CompanyMetadataJSON;
  onDismiss: () => void;
  onJump: (id: SectionId) => void;
}

function MissingInfoBanner({
  metadata,
  onDismiss,
  onJump,
}: MissingInfoBannerProps) {
  const missingFields = EXPECTED_COMPANY_FIELDS.filter(
    (f) => !metadata.company[f.key],
  );
  const peopleWithoutRoles = metadata.people.filter((p) => !p.role);

  if (missingFields.length === 0 && peopleWithoutRoles.length === 0) return null;

  const totalIssues = missingFields.length + peopleWithoutRoles.length;
  const headline =
    totalIssues === 1
      ? "One field is missing"
      : `${totalIssues} fields are missing — fix them in 30 seconds`;

  return (
    <div className={m.banner} role="status">
      <div className={m.bannerIcon}>
        <AlertTriangle width={14} height={14} strokeWidth={2.2} />
      </div>
      <div className={m.bannerBody}>
        <h4 className={m.bannerTitle}>{headline}</h4>
        <p className={m.bannerText}>
          The extractor couldn&apos;t find a confident answer for these. Click a
          chip to jump and edit, or upload more documents and re-extract.
        </p>
        <div className={m.bannerChips}>
          {missingFields.map((f) => (
            <button
              key={String(f.key)}
              type="button"
              className={m.bannerChip}
              onClick={() => onJump("identity")}
            >
              <ArrowRight width={11} height={11} strokeWidth={2.5} />
              {f.label}
            </button>
          ))}
          {peopleWithoutRoles.slice(0, 3).map((p, idx) => (
            <button
              key={`person-${idx}`}
              type="button"
              className={m.bannerChip}
              onClick={() => onJump("people")}
            >
              <ArrowRight width={11} height={11} strokeWidth={2.5} />
              {String(p.name.value)} · missing role
            </button>
          ))}
          {peopleWithoutRoles.length > 3 && (
            <button
              type="button"
              className={m.bannerChip}
              onClick={() => onJump("people")}
            >
              +{peopleWithoutRoles.length - 3} more
            </button>
          )}
        </div>
      </div>
      <button
        type="button"
        className={`${s.btn} ${s.btnGhost} ${s.btnSm} ${m.bannerDismiss}`}
        onClick={onDismiss}
        aria-label="Dismiss"
        title="Dismiss"
      >
        <X width={14} height={14} />
      </button>
    </div>
  );
}

// ─── Section panel ────────────────────────────────────────────────────────

interface SectionPanelProps {
  id: string;
  sectionRef?: (el: HTMLElement | null) => void;
  icon: React.ReactNode;
  title: string;
  count?: number;
  countLabel?: string;
  help?: string;
  tools?: React.ReactNode;
  children: React.ReactNode;
}

function SectionPanel({
  id,
  sectionRef,
  icon,
  title,
  count,
  countLabel,
  help,
  tools,
  children,
}: SectionPanelProps) {
  return (
    <section id={id} ref={sectionRef} className={m.section}>
      <div className={m.sectionHead}>
        <div className={m.sectionTitleRow}>
          <div className={m.sectionMark}>{icon}</div>
          <div style={{ minWidth: 0 }}>
            <h2 className={m.sectionTitle}>
              {title}
              {typeof count === "number" && (
                <span className={m.sectionCount}>
                  · {count} {countLabel ?? ""}
                </span>
              )}
            </h2>
            {help && <p className={m.sectionHelp}>{help}</p>}
          </div>
        </div>
        {tools && <div className={m.sectionTools}>{tools}</div>}
      </div>
      <hr className={m.sectionDivider} />
      {children}
    </section>
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
    <div className={`${s.panel} ${m.empty}`}>
      <div
        className={s.brandMark}
        style={{ width: 56, height: 56, borderRadius: 14, marginBottom: 6 }}
      >
        <FileText className="h-6 w-6" />
      </div>
      <h3 className={m.emptyTitle}>No metadata extracted yet</h3>
      <p className={m.emptyText}>
        Upload some documents, then run an extraction. The AI will pull
        company info, people, services, and legal entities. You can edit
        anything it got wrong.
      </p>
      <button
        type="button"
        className={`${s.btn} ${s.btnAccent} ${s.btnLg}`}
        onClick={() => void onExtract()}
        disabled={extracting}
        style={{ marginTop: 6 }}
      >
        <Sparkles className={`h-4 w-4${extracting ? " animate-pulse" : ""}`} />
        {extracting ? "Extracting…" : "Extract metadata"}
      </button>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Coerce optional / legacy-shape metadata into a fully-populated record so
 * downstream renderers can treat every collection as defined. The API may
 * return historical documents missing fields like `legal` or `markets`.
 */
function normalizeMetadata(raw: CompanyMetadataJSON): CompanyMetadataJSON {
  return {
    ...raw,
    company: raw.company ?? {},
    people: Array.isArray(raw.people) ? raw.people : [],
    services: Array.isArray(raw.services) ? raw.services : [],
    markets: raw.markets ?? {},
    projects: Array.isArray(raw.projects) ? raw.projects : [],
    policies: raw.policies ?? {},
    legal: Array.isArray(raw.legal) ? raw.legal : [],
    provenance: raw.provenance ?? {
      total_documents_processed: 0,
      extraction_model: "",
      extraction_version: "",
    },
  };
}

function countManualEdits(metadata: CompanyMetadataJSON): number {
  let count = 0;
  const isManual = (fact: MetadataFact<unknown> | undefined) =>
    fact?.priority === "manual_override";

  for (const key of Object.keys(metadata.company)) {
    if (isManual(metadata.company[key as keyof CompanyInfo])) count++;
  }
  for (const person of metadata.people) {
    for (const key of ["name", "role", "email", "phone", "department"] as const) {
      if (isManual(person[key])) count++;
    }
  }
  for (const svc of metadata.services) {
    if (isManual(svc.name)) count++;
    if (isManual(svc.description)) count++;
    if (isManual(svc.status)) count++;
  }
  for (const entry of metadata.legal) {
    for (const key of [
      "name",
      "type",
      "summary",
      "effective_date",
      "expiry_date",
      "parties",
      "status",
    ] as const) {
      if (isManual(entry[key])) count++;
    }
  }
  return count;
}

function formatRelativeShort(dateStr: string): string {
  let d: Date;
  try {
    d = new Date(dateStr);
  } catch {
    return dateStr;
  }
  if (Number.isNaN(d.getTime())) return dateStr;
  const diffMs = Date.now() - d.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "just now";
  if (diffMs < hour) return `${Math.round(diffMs / minute)}m ago`;
  if (diffMs < day) return `${Math.round(diffMs / hour)}h ago`;
  if (diffMs < 30 * day) return `${Math.round(diffMs / day)}d ago`;
  return d.toLocaleDateString();
}

