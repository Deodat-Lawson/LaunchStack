"use client";

import React, { useState, useEffect } from "react";
import { Briefcase, CheckCircle, Clock, XCircle } from "lucide-react";
import { legalTheme as s } from "~/app/employer/documents/components/LegalGeneratorTheme";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { VisibilityBadge } from "./VisibilityBadge";
import { PriorityBadge } from "./PriorityBadge";
import type {
  ServiceEntry,
  MetadataFact,
} from "@launchstack/features/company-metadata";

interface ServicesSectionProps {
  services: ServiceEntry[];
  isEditMode?: boolean;
  onFieldSave?: (path: string, value: string) => Promise<void>;
}

export function ServicesSection({
  services,
  isEditMode,
  onFieldSave,
}: ServicesSectionProps) {
  return (
    <div className={s.panel} style={{ padding: 22 }}>
      <div className="flex items-center gap-3" style={{ marginBottom: 4 }}>
        <div className={s.brandMarkSm}>
          <Briefcase className="h-[14px] w-[14px]" />
        </div>
        <div className="min-w-0">
          <h2
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              color: "var(--ink)",
              letterSpacing: "-0.01em",
            }}
          >
            Services &amp; products
          </h2>
          <p
            style={{
              margin: "2px 0 0",
              fontSize: 12,
              color: "var(--ink-3)",
            }}
          >
            {services.length} {services.length === 1 ? "service" : "services"} identified
          </p>
        </div>
      </div>
      <hr className={s.hair} style={{ margin: "14px 0 18px" }} />
      <div className="space-y-3">
        {services.map((service, index) => (
          <ServiceCard
            key={index}
            service={service}
            index={index}
            isEditMode={isEditMode}
            onFieldSave={onFieldSave}
          />
        ))}
      </div>
    </div>
  );
}

function ServiceFieldEditor({
  path,
  initialValue,
  multiline,
  onSave,
}: {
  path: string;
  initialValue: string;
  multiline?: boolean;
  onSave: (path: string, value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(initialValue);
    setError(null);
  }, [initialValue]);

  const handleSave = async () => {
    if (value.trim() === initialValue) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(path, value.trim());
    } catch {
      setError("Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-1 space-y-1.5">
      {multiline ? (
        <textarea
          className={s.textarea}
          rows={2}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={saving}
        />
      ) : (
        <input
          className={s.input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={saving}
        />
      )}
      {error && (
        <p style={{ margin: 0, fontSize: 11, color: "var(--danger)" }}>{error}</p>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => void handleSave()}
          disabled={saving || value.trim() === initialValue}
          className={`${s.btn} ${s.btnAccent} ${s.btnSm}`}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => {
            setValue(initialValue);
            setError(null);
          }}
          disabled={saving}
          className={`${s.btn} ${s.btnOutline} ${s.btnSm}`}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

function getServiceSource(service: ServiceEntry): {
  docName: string;
  hasManualEdit: boolean;
} {
  const allFacts: (MetadataFact<unknown> | undefined)[] = [
    service.name,
    service.description,
    service.status,
  ];
  const hasManualEdit = allFacts.some((f) => f?.priority === "manual_override");
  if (hasManualEdit) {
    return { docName: "Manual edit", hasManualEdit: true };
  }
  const firstSource = service.name.sources[0]?.doc_name ?? "document";
  return { docName: firstSource, hasManualEdit: false };
}

function statusTone(status: string): { bg: string; fg: string; border: string } {
  if (status === "active") {
    return {
      bg: "oklch(from var(--success) l c h / 0.12)",
      fg: "var(--success)",
      border: "oklch(from var(--success) l c h / 0.25)",
    };
  }
  if (status === "deprecated") {
    return {
      bg: "oklch(from var(--danger) l c h / 0.1)",
      fg: "var(--danger)",
      border: "oklch(from var(--danger) l c h / 0.25)",
    };
  }
  return {
    bg: "oklch(from var(--warn) l c h / 0.14)",
    fg: "var(--warn)",
    border: "oklch(from var(--warn) l c h / 0.3)",
  };
}

function ServiceCard({
  service,
  index,
  isEditMode,
  onFieldSave,
}: {
  service: ServiceEntry;
  index: number;
  isEditMode?: boolean;
  onFieldSave?: (path: string, value: string) => Promise<void>;
}) {
  const status = service.status
    ? String(service.status.value).toLowerCase()
    : "active";

  const StatusIcon =
    status === "active"
      ? CheckCircle
      : status === "deprecated"
      ? XCircle
      : Clock;

  const tone = statusTone(status);

  const statusPill = (
    <span
      className="inline-flex items-center gap-1"
      style={{
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 600,
        background: tone.bg,
        color: tone.fg,
        border: `1px solid ${tone.border}`,
      }}
    >
      <StatusIcon className="h-3 w-3" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );

  const itemStyle: React.CSSProperties = {
    padding: 14,
    borderRadius: 12,
    background: "var(--panel-2)",
    border: "1px solid var(--line-2)",
  };

  if (isEditMode && onFieldSave) {
    return (
      <div style={itemStyle} className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {statusPill}
          <PriorityBadge priority={service.name.priority} />
        </div>
        <div>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--ink-3)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Name
          </span>
          <ServiceFieldEditor
            path={`services.${index}.name`}
            initialValue={String(service.name.value)}
            onSave={onFieldSave}
          />
        </div>
        <div>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--ink-3)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Description
          </span>
          <ServiceFieldEditor
            path={`services.${index}.description`}
            initialValue={
              service.description ? String(service.description.value) : ""
            }
            multiline
            onSave={onFieldSave}
          />
        </div>
        <div>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--ink-3)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Status
          </span>
          <ServiceFieldEditor
            path={`services.${index}.status`}
            initialValue={
              service.status ? String(service.status.value) : "active"
            }
            onSave={onFieldSave}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={itemStyle}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h4
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 600,
                color: "var(--ink)",
                letterSpacing: "-0.005em",
              }}
            >
              {String(service.name.value)}
            </h4>
            {statusPill}
            <VisibilityBadge visibility={service.name.visibility} />
            <PriorityBadge priority={service.name.priority} />
          </div>

          {service.description && (
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "var(--ink-2)",
                lineHeight: 1.55,
              }}
            >
              {String(service.description.value)}
            </p>
          )}

          <div className="mt-3 flex items-center gap-2">
            <ConfidenceBadge confidence={service.name.confidence} />
            {(() => {
              const { docName, hasManualEdit } = getServiceSource(service);
              return (
                <span
                  style={{
                    fontSize: 10,
                    color: hasManualEdit
                      ? "var(--accent-ink)"
                      : "var(--ink-3)",
                    fontWeight: hasManualEdit ? 600 : 400,
                  }}
                >
                  {hasManualEdit ? "Manual edit" : `from ${docName}`}
                </span>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
