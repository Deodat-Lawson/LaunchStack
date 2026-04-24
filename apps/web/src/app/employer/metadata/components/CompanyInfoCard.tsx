"use client";

import React, { useState, useEffect } from "react";
import {
  Building2,
  Globe,
  MapPin,
  Calendar,
  Users,
  Briefcase,
  ExternalLink,
} from "lucide-react";
import { legalTheme as s } from "~/app/employer/documents/components/LegalGeneratorTheme";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { VisibilityBadge } from "./VisibilityBadge";
import { PriorityBadge } from "./PriorityBadge";
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
  isEditMode?: boolean;
  onFieldSave?: (field: string, value: string) => Promise<void>;
}

interface FieldDisplayProps {
  label: string;
  fact: AnyMetadataFact | undefined;
  icon: React.ComponentType<{ className?: string }>;
  isLink?: boolean;
  fieldKey: string;
  isEditMode?: boolean;
  onFieldSave?: (field: string, value: string) => Promise<void>;
}

/** Inline editor strip: input + Save/Reset buttons. */
function InlineEditor({
  fieldKey,
  initialValue,
  multiline,
  onFieldSave,
  onReset,
}: {
  fieldKey: string;
  initialValue: string;
  multiline?: boolean;
  onFieldSave: (field: string, value: string) => Promise<void>;
  onReset: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setValue(initialValue);
    setLocalError(null);
  }, [initialValue]);

  const handleSave = async () => {
    if (value.trim() === initialValue) return;
    setSaving(true);
    setLocalError(null);
    try {
      await onFieldSave(fieldKey, value.trim());
    } catch {
      setLocalError("Failed to save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      {multiline ? (
        <textarea
          className={s.textarea}
          rows={3}
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
      {localError && (
        <p style={{ margin: 0, fontSize: 11, color: "var(--danger)" }}>
          {localError}
        </p>
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
            setLocalError(null);
            onReset();
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

function FieldDisplay({
  label,
  fact,
  icon: Icon,
  isLink,
  fieldKey,
  isEditMode,
  onFieldSave,
}: FieldDisplayProps) {
  const [editKey, setEditKey] = useState(0);
  const currentValue = fact ? String(fact.value) : "";

  useEffect(() => {
    if (!isEditMode) setEditKey((k) => k + 1);
  }, [isEditMode]);

  if (!fact && !isEditMode) return null;

  return (
    <div
      className="flex items-start gap-3"
      style={{
        padding: 14,
        borderRadius: 12,
        background: "var(--panel-2)",
        border: "1px solid var(--line-2)",
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: "var(--accent-soft)",
          color: "var(--accent-ink)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--ink-3)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            {label}
          </span>
          {fact && <VisibilityBadge visibility={fact.visibility} />}
          {fact && <ConfidenceBadge confidence={fact.confidence} />}
          {fact && <PriorityBadge priority={fact.priority} />}
        </div>
        {isEditMode && onFieldSave ? (
          <InlineEditor
            key={editKey}
            fieldKey={fieldKey}
            initialValue={currentValue}
            onFieldSave={onFieldSave}
            onReset={() => undefined}
          />
        ) : fact ? (
          <>
            {isLink && currentValue.startsWith("http") ? (
              <a
                href={currentValue}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center gap-1"
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: "var(--ink)",
                  textDecoration: "none",
                }}
              >
                <span className="truncate">{currentValue}</span>
                <ExternalLink
                  className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ color: "var(--accent)", flexShrink: 0 }}
                />
              </a>
            ) : (
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  fontWeight: 500,
                  color: "var(--ink)",
                  wordBreak: "break-word",
                }}
              >
                {currentValue}
              </p>
            )}
            {fact.priority === "manual_override" ? (
              <p
                style={{
                  margin: "4px 0 0",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--accent-ink)",
                }}
              >
                Manual edit
              </p>
            ) : (fact.sources?.length ?? 0) > 0 ? (
              <p
                style={{
                  margin: "4px 0 0",
                  fontSize: 11,
                  color: "var(--ink-3)",
                }}
              >
                Source: {fact.sources[0]?.doc_name ?? "Unknown"}
                {fact.sources.length > 1 && ` +${fact.sources.length - 1} more`}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

export function CompanyInfoCard({
  company,
  isEditMode,
  onFieldSave,
}: CompanyInfoCardProps) {
  const [descEditKey, setDescEditKey] = useState(0);

  useEffect(() => {
    if (!isEditMode) setDescEditKey((k) => k + 1);
  }, [isEditMode]);

  const descValue = company.description
    ? String(company.description.value)
    : "";

  return (
    <div className={s.panel} style={{ padding: 22 }}>
      <div
        className="flex items-center gap-3"
        style={{ marginBottom: 4 }}
      >
        <div className={s.brandMarkSm}>
          <Building2 className="h-[14px] w-[14px]" />
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
            Company info
          </h2>
          <p
            style={{
              margin: "2px 0 0",
              fontSize: 12,
              color: "var(--ink-3)",
              lineHeight: 1.5,
            }}
          >
            Facts about your company — extracted from documents or edited manually.
          </p>
        </div>
      </div>
      <hr className={s.hair} style={{ margin: "14px 0 18px" }} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FieldDisplay
          label="Company name"
          fact={company.name}
          icon={Building2}
          fieldKey="company.name"
          isEditMode={isEditMode}
          onFieldSave={onFieldSave}
        />
        <FieldDisplay
          label="Industry"
          fact={company.industry}
          icon={Briefcase}
          fieldKey="company.industry"
          isEditMode={isEditMode}
          onFieldSave={onFieldSave}
        />
        <FieldDisplay
          label="Headquarters"
          fact={company.headquarters}
          icon={MapPin}
          fieldKey="company.headquarters"
          isEditMode={isEditMode}
          onFieldSave={onFieldSave}
        />
        <FieldDisplay
          label="Founded"
          fact={company.founded_year}
          icon={Calendar}
          fieldKey="company.founded_year"
          isEditMode={isEditMode}
          onFieldSave={onFieldSave}
        />
        <FieldDisplay
          label="Company size"
          fact={company.size}
          icon={Users}
          fieldKey="company.size"
          isEditMode={isEditMode}
          onFieldSave={onFieldSave}
        />
        <FieldDisplay
          label="Website"
          fact={company.website}
          icon={Globe}
          isLink
          fieldKey="company.website"
          isEditMode={isEditMode}
          onFieldSave={onFieldSave}
        />
      </div>

      {(company.description ?? isEditMode) && (
        <div
          style={{
            marginTop: 16,
            padding: 14,
            borderRadius: 12,
            background: "var(--panel-2)",
            border: "1px solid var(--line-2)",
          }}
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
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
            {company.description && (
              <>
                <VisibilityBadge visibility={company.description.visibility} />
                <ConfidenceBadge confidence={company.description.confidence} />
                <PriorityBadge priority={company.description.priority} />
              </>
            )}
          </div>
          {isEditMode && onFieldSave ? (
            <InlineEditor
              key={descEditKey}
              fieldKey="company.description"
              initialValue={descValue}
              multiline
              onFieldSave={onFieldSave}
              onReset={() => undefined}
            />
          ) : (
            company.description && (
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  color: "var(--ink)",
                  lineHeight: 1.6,
                }}
              >
                {descValue}
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}
