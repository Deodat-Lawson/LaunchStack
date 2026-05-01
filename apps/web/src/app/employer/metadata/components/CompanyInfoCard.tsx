"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Building2,
  Globe,
  MapPin,
  Calendar,
  Users,
  Briefcase,
  FileText,
  Pencil,
  Plus,
} from "lucide-react";
import { legalTheme as s } from "~/app/employer/documents/components/LegalGeneratorTheme";
import m from "./metadata.module.css";
import type {
  CompanyInfo,
  MetadataFact,
} from "@launchstack/features/company-metadata";

type AnyMetadataFact =
  | MetadataFact<string>
  | MetadataFact<number>
  | MetadataFact<unknown>;

interface CompanyInfoCardProps {
  company: CompanyInfo;
  onFieldSave?: (field: string, value: string) => Promise<void>;
}

interface FieldRow {
  key: keyof CompanyInfo;
  label: string;
  icon: React.ComponentType<{ width?: number; height?: number; className?: string }>;
  isLink?: boolean;
  multiline?: boolean;
  placeholder?: string;
  hint?: string;
  fullWidth?: boolean;
}

const FIELDS: FieldRow[] = [
  {
    key: "name",
    label: "Company name",
    icon: Building2,
    placeholder: "e.g. Northwind Labs, Inc.",
  },
  {
    key: "industry",
    label: "Industry",
    icon: Briefcase,
    placeholder: "e.g. Developer tools · AI infrastructure",
  },
  {
    key: "headquarters",
    label: "Headquarters",
    icon: MapPin,
    placeholder: "e.g. Brooklyn, NY · Remote-first",
  },
  {
    key: "founded_year",
    label: "Founded year",
    icon: Calendar,
    placeholder: "e.g. 2023",
    hint: "Couldn't find this in your uploads. Add it manually.",
  },
  {
    key: "size",
    label: "Company size",
    icon: Users,
    placeholder: "e.g. 5–10 employees",
    hint: "Try uploading a team handbook or org chart, then re-extract.",
  },
  {
    key: "website",
    label: "Website",
    icon: Globe,
    isLink: true,
    placeholder: "https://example.com",
  },
  {
    key: "description",
    label: "Description",
    icon: FileText,
    multiline: true,
    fullWidth: true,
    placeholder: "What the company does, in a sentence or two.",
  },
];

function confidenceBucket(confidence: number): "high" | "med" | "low" {
  if (confidence >= 0.75) return "high";
  if (confidence >= 0.45) return "med";
  return "low";
}

function ConfBar({ confidence }: { confidence: number }) {
  const bucket = confidenceBucket(confidence);
  const filled = bucket === "high" ? 4 : bucket === "med" ? 3 : 2;
  const cls =
    bucket === "high" ? m.confBarHigh : bucket === "med" ? m.confBarMed : m.confBarLow;
  const label =
    bucket === "high" ? "High confidence" : bucket === "med" ? "Medium confidence" : "Low confidence";
  return (
    <span className={`${m.confBar} ${cls}`} title={label} aria-label={label}>
      {[0, 1, 2, 3].map((i) => (
        <i key={i} className={i < filled ? "on" : undefined} />
      ))}
    </span>
  );
}

function VisibilityPill({ visibility }: { visibility: AnyMetadataFact["visibility"] }) {
  const label =
    visibility === "private" || visibility === "internal"
      ? "Private"
      : visibility === "partner"
      ? "Partner"
      : "Public";
  const cls = label === "Public" ? m.badgePublic : m.badgePrivate;
  return (
    <span className={`${m.badge} ${cls}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

function SourceChip({ fact }: { fact: AnyMetadataFact }) {
  if (fact.priority === "manual_override") {
    return (
      <span className={`${m.src} ${m.srcManual}`}>
        <Pencil width={10} height={10} />
        Edited by you
      </span>
    );
  }
  const first = fact.sources?.[0];
  if (!first) return null;
  const extra = (fact.sources?.length ?? 0) - 1;
  return (
    <span className={m.src} title={first.doc_name}>
      <FileText width={10} height={10} />
      {first.doc_name}
      {extra > 0 && (
        <span style={{ color: "var(--ink-4)", marginLeft: 2 }}>+{extra}</span>
      )}
    </span>
  );
}

interface InlineEditorProps {
  initialValue: string;
  multiline?: boolean;
  placeholder?: string;
  hint?: string;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (next: string) => void;
}

function InlineEditor({
  initialValue,
  multiline,
  placeholder,
  hint,
  saving,
  error,
  onCancel,
  onSave,
}: InlineEditorProps) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    ref.current?.focus();
    if (ref.current && "select" in ref.current) {
      try {
        ref.current.select();
      } catch {
        /* noop */
      }
    }
  }, []);

  const submit = () => onSave(value.trim());

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Enter" && !multiline && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={m.editor}>
      {multiline ? (
        <textarea
          ref={(el) => {
            ref.current = el;
          }}
          className={s.textarea}
          rows={3}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          disabled={saving}
        />
      ) : (
        <input
          ref={(el) => {
            ref.current = el;
          }}
          className={s.input}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          disabled={saving}
        />
      )}
      {error && <p className={m.editorError}>{error}</p>}
      <div className={m.editorRow}>
        {hint && <span className={m.editorHint}>{hint}</span>}
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
          onClick={submit}
          disabled={saving || value.trim() === initialValue.trim()}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

interface FieldProps {
  row: FieldRow;
  fact: AnyMetadataFact | undefined;
  onFieldSave?: (field: string, value: string) => Promise<void>;
}

function Field({ row, fact, onFieldSave }: FieldProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = row.icon;
  const value = fact ? String(fact.value) : "";
  const isMissing = !fact || value === "";

  const startEdit = () => {
    if (!onFieldSave) return;
    setError(null);
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setError(null);
  };
  const handleSave = async (next: string) => {
    if (!onFieldSave) return;
    if (next === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onFieldSave(`company.${String(row.key)}`, next);
      setEditing(false);
    } catch {
      setError("Failed to save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const fieldClass = [
    m.field,
    row.fullWidth ? m.fieldFull : "",
    editing ? m.fieldEditing : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={fieldClass}>
      <div className={`${m.fieldIcon} ${isMissing ? m.fieldIconWarn : ""}`}>
        <Icon width={14} height={14} />
      </div>
      <div className={m.fieldBody}>
        <div className={m.fieldLabel}>
          {row.label}
          {isMissing && <span className={m.fieldLabelMissing}>· missing</span>}
        </div>
        {editing ? (
          <InlineEditor
            initialValue={value}
            multiline={row.multiline}
            placeholder={row.placeholder}
            hint={isMissing ? row.hint : undefined}
            saving={saving}
            error={error}
            onCancel={cancelEdit}
            onSave={(next) => void handleSave(next)}
          />
        ) : (
          <>
            {isMissing ? (
              <div className={`${m.fieldValue} ${m.fieldEmpty}`}>
                — Not yet extracted
              </div>
            ) : row.multiline ? (
              <div className={`${m.fieldValue} ${m.fieldValueBlock}`}>
                {value}
              </div>
            ) : row.isLink && value.startsWith("http") ? (
              <div className={m.fieldValue}>
                <a href={value} target="_blank" rel="noopener noreferrer">
                  {value}
                </a>
              </div>
            ) : (
              <div className={m.fieldValue}>{value}</div>
            )}
            <div className={m.fieldMeta}>
              {fact && <ConfBar confidence={fact.confidence} />}
              {fact && <VisibilityPill visibility={fact.visibility} />}
              {fact ? (
                <SourceChip fact={fact} />
              ) : row.hint ? (
                <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                  {row.hint}
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>
      <button
        type="button"
        className={m.fieldEdit}
        onClick={() => (editing ? cancelEdit() : startEdit())}
        title={
          editing
            ? "Cancel"
            : isMissing
            ? `Add ${row.label.toLowerCase()}`
            : `Edit ${row.label.toLowerCase()}`
        }
        aria-label={editing ? "Cancel edit" : `Edit ${row.label}`}
      >
        {isMissing && !editing ? (
          <Plus width={12} height={12} />
        ) : (
          <Pencil width={12} height={12} />
        )}
      </button>
    </div>
  );
}

export function CompanyInfoCard({ company, onFieldSave }: CompanyInfoCardProps) {
  return (
    <div className={m.fieldGrid}>
      {FIELDS.map((row) => (
        <Field
          key={String(row.key)}
          row={row}
          fact={company[row.key]}
          onFieldSave={onFieldSave}
        />
      ))}
    </div>
  );
}
