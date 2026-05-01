"use client";

import React, { useEffect, useState } from "react";
import {
  CheckCircle,
  Clock,
  XCircle,
  Pencil,
  FileText,
} from "lucide-react";
import { legalTheme as s } from "~/app/employer/documents/components/LegalGeneratorTheme";
import m from "./metadata.module.css";
import type {
  ServiceEntry,
  MetadataFact,
} from "@launchstack/features/company-metadata";

interface ServicesSectionProps {
  services: ServiceEntry[];
  onFieldSave?: (path: string, value: string) => Promise<void>;
}

type StatusKey = "active" | "upcoming" | "deprecated";

function statusFor(value: string | undefined): StatusKey {
  const v = (value ?? "").toLowerCase();
  if (v.includes("deprecat") || v.includes("retired") || v.includes("sunset")) {
    return "deprecated";
  }
  if (
    v.includes("upcoming") ||
    v.includes("planned") ||
    v.includes("beta") ||
    v.includes("alpha") ||
    v.includes("preview") ||
    v.includes("soon")
  ) {
    return "upcoming";
  }
  return "active";
}

function statusLabel(key: StatusKey, original?: string) {
  if (original && original.trim()) {
    const trimmed = original.trim();
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  }
  if (key === "deprecated") return "Deprecated";
  if (key === "upcoming") return "Upcoming";
  return "Active";
}

function confBucket(confidence: number): "high" | "med" | "low" {
  if (confidence >= 0.75) return "high";
  if (confidence >= 0.45) return "med";
  return "low";
}

function ConfBar({ confidence }: { confidence: number }) {
  const bucket = confBucket(confidence);
  const filled = bucket === "high" ? 4 : bucket === "med" ? 3 : 2;
  const cls =
    bucket === "high" ? m.confBarHigh : bucket === "med" ? m.confBarMed : m.confBarLow;
  return (
    <span className={`${m.confBar} ${cls}`}>
      {[0, 1, 2, 3].map((i) => (
        <i key={i} className={i < filled ? "on" : undefined} />
      ))}
    </span>
  );
}

function getServiceSource(service: ServiceEntry): {
  docName: string;
  hasManualEdit: boolean;
} {
  const all: (MetadataFact<unknown> | undefined)[] = [
    service.name,
    service.description,
    service.status,
  ];
  const hasManualEdit = all.some((f) => f?.priority === "manual_override");
  if (hasManualEdit) return { docName: "Edited by you", hasManualEdit: true };
  const firstSource = service.name.sources[0]?.doc_name ?? "document";
  return { docName: firstSource, hasManualEdit: false };
}

export function ServicesSection({ services, onFieldSave }: ServicesSectionProps) {
  if (services.length === 0) return null;
  return (
    <div className={m.servicesList}>
      {services.map((service, index) => (
        <ServiceRow
          key={index}
          service={service}
          index={index}
          onFieldSave={onFieldSave}
        />
      ))}
    </div>
  );
}

interface ServiceRowProps {
  service: ServiceEntry;
  index: number;
  onFieldSave?: (path: string, value: string) => Promise<void>;
}

function ServiceRow({ service, index, onFieldSave }: ServiceRowProps) {
  const [editingField, setEditingField] = useState<
    "name" | "description" | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = String(service.name.value);
  const description = service.description ? String(service.description.value) : "";
  const rawStatus = service.status ? String(service.status.value) : undefined;
  const statusKey = statusFor(rawStatus);
  const label = statusLabel(statusKey, rawStatus);

  const StatusIcon =
    statusKey === "active"
      ? CheckCircle
      : statusKey === "deprecated"
      ? XCircle
      : Clock;

  const statusBoxClass =
    statusKey === "active"
      ? m.serviceStatusActive
      : statusKey === "deprecated"
      ? m.serviceStatusDeprecated
      : m.serviceStatusUpcoming;

  const pillClass =
    statusKey === "active"
      ? m.sPillActive
      : statusKey === "deprecated"
      ? m.sPillDeprecated
      : m.sPillUpcoming;

  const source = getServiceSource(service);

  const startEdit = (field: "name" | "description") => {
    if (!onFieldSave) return;
    setEditingField(field);
    setError(null);
  };
  const cancelEdit = () => {
    setEditingField(null);
    setError(null);
  };
  const save = async (field: "name" | "description", current: string, next: string) => {
    if (!onFieldSave) return;
    if (next === current) {
      setEditingField(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onFieldSave(`services.${index}.${field}`, next);
      setEditingField(null);
    } catch {
      setError("Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={m.service}>
      <div className={`${m.serviceStatus} ${statusBoxClass}`}>
        <StatusIcon width={15} height={15} />
      </div>
      <div style={{ minWidth: 0 }}>
        {editingField === "name" ? (
          <ServiceInlineInput
            initialValue={name}
            placeholder="Service or product name"
            saving={saving}
            error={error}
            onCancel={cancelEdit}
            onSave={(next) => void save("name", name, next)}
          />
        ) : (
          <div className={m.sName}>
            <span>{name}</span>
            <span className={`${m.sPill} ${pillClass}`}>{label}</span>
            {service.name.priority === "manual_override" && (
              <span className={`${m.badge} ${m.badgeManual}`}>
                <span className="dot" />
                Manual
              </span>
            )}
          </div>
        )}

        {editingField === "description" ? (
          <ServiceInlineInput
            initialValue={description}
            multiline
            placeholder="What this service does"
            saving={saving}
            error={error}
            onCancel={cancelEdit}
            onSave={(next) => void save("description", description, next)}
          />
        ) : description ? (
          <p className={m.sDesc}>{description}</p>
        ) : null}

        <div className={m.sMeta}>
          <ConfBar confidence={service.name.confidence} />
          {source.hasManualEdit ? (
            <span className={`${m.src} ${m.srcManual}`}>
              <Pencil width={10} height={10} />
              Edited by you
            </span>
          ) : (
            <span className={m.src} title={source.docName}>
              <FileText width={10} height={10} />
              {source.docName}
            </span>
          )}
        </div>
      </div>
      {onFieldSave && editingField === null && (
        <button
          type="button"
          className={m.fieldEdit}
          style={{ opacity: 1 }}
          onClick={() => startEdit("description")}
          title="Edit description"
          aria-label="Edit service"
        >
          <Pencil width={12} height={12} />
        </button>
      )}
    </div>
  );
}

interface ServiceInlineInputProps {
  initialValue: string;
  multiline?: boolean;
  placeholder?: string;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (next: string) => void;
}

function ServiceInlineInput({
  initialValue,
  multiline,
  placeholder,
  saving,
  error,
  onCancel,
  onSave,
}: ServiceInlineInputProps) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  return (
    <div className={m.editor} style={{ marginTop: 6 }}>
      {multiline ? (
        <textarea
          autoFocus
          className={s.textarea}
          rows={2}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSave(value.trim());
          }}
          disabled={saving}
        />
      ) : (
        <input
          autoFocus
          className={s.input}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
            if (e.key === "Enter") onSave(value.trim());
          }}
          disabled={saving}
        />
      )}
      {error && <p className={m.editorError}>{error}</p>}
      <div className={m.editorRow}>
        <button
          type="button"
          className={`${s.btn} ${s.btnOutline} ${s.btnSm}`}
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="button"
          className={`${s.btn} ${s.btnAccent} ${s.btnSm}`}
          onClick={() => onSave(value.trim())}
          disabled={saving || value.trim() === initialValue.trim()}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
