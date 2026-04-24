"use client";

import React, { useState, useEffect } from "react";
import { Users, Mail, Phone, Building } from "lucide-react";
import { legalTheme as s } from "~/app/employer/documents/components/LegalGeneratorTheme";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { VisibilityBadge } from "./VisibilityBadge";
import { PriorityBadge } from "./PriorityBadge";
import type {
  PersonEntry,
  MetadataFact,
} from "@launchstack/features/company-metadata";

interface PeopleSectionProps {
  people: PersonEntry[];
  isEditMode?: boolean;
  onFieldSave?: (path: string, value: string) => Promise<void>;
}

export function PeopleSection({
  people,
  isEditMode,
  onFieldSave,
}: PeopleSectionProps) {
  return (
    <div className={s.panel} style={{ padding: 22 }}>
      <div className="flex items-center gap-3" style={{ marginBottom: 4 }}>
        <div className={s.brandMarkSm}>
          <Users className="h-[14px] w-[14px]" />
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
            People
          </h2>
          <p
            style={{
              margin: "2px 0 0",
              fontSize: 12,
              color: "var(--ink-3)",
            }}
          >
            {people.length} {people.length === 1 ? "person" : "people"} extracted from documents
          </p>
        </div>
      </div>
      <hr className={s.hair} style={{ margin: "14px 0 18px" }} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {people.map((person, index) => (
          <PersonCard
            key={index}
            person={person}
            index={index}
            isEditMode={isEditMode}
            onFieldSave={onFieldSave}
          />
        ))}
      </div>
    </div>
  );
}

function PersonFieldEditor({
  path,
  initialValue,
  onSave,
}: {
  path: string;
  initialValue: string;
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
      <input
        className={s.input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={saving}
      />
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

function getPersonSource(person: PersonEntry): {
  docName: string;
  hasManualEdit: boolean;
} {
  const allFacts: (MetadataFact<unknown> | undefined)[] = [
    person.name,
    person.role,
    person.email,
    person.phone,
    person.department,
  ];
  const hasManualEdit = allFacts.some((f) => f?.priority === "manual_override");
  if (hasManualEdit) {
    return { docName: "Manual edit", hasManualEdit: true };
  }
  const firstSource = person.name.sources[0]?.doc_name ?? "document";
  return { docName: firstSource, hasManualEdit: false };
}

function PersonCard({
  person,
  index,
  isEditMode,
  onFieldSave,
}: {
  person: PersonEntry;
  index: number;
  isEditMode?: boolean;
  onFieldSave?: (path: string, value: string) => Promise<void>;
}) {
  const name = String(person.name.value);
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const avatarStyle: React.CSSProperties = {
    width: 40,
    height: 40,
    borderRadius: 999,
    background:
      "linear-gradient(135deg, var(--accent) 0%, var(--accent-deep) 100%)",
    color: "white",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 700,
    flexShrink: 0,
    boxShadow: "0 4px 12px var(--accent-glow)",
  };

  const itemStyle: React.CSSProperties = {
    padding: 14,
    borderRadius: 12,
    background: "var(--panel-2)",
    border: "1px solid var(--line-2)",
  };

  if (isEditMode && onFieldSave) {
    const editableFields = [
      { label: "Name", key: "name", value: name },
      {
        label: "Role",
        key: "role",
        value: person.role ? String(person.role.value) : "",
      },
      {
        label: "Department",
        key: "department",
        value: person.department ? String(person.department.value) : "",
      },
      {
        label: "Email",
        key: "email",
        value: person.email ? String(person.email.value) : "",
      },
      {
        label: "Phone",
        key: "phone",
        value: person.phone ? String(person.phone.value) : "",
      },
    ];

    return (
      <div style={itemStyle} className="space-y-3">
        <div className="flex items-center gap-3">
          <div style={avatarStyle}>{initials}</div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--ink)",
                letterSpacing: "-0.005em",
              }}
            >
              {name}
            </span>
            <PriorityBadge priority={person.name.priority} />
          </div>
        </div>
        <div className="space-y-2.5">
          {editableFields.map(({ label, key, value: val }) => (
            <div key={key}>
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
              <PersonFieldEditor
                path={`people.${index}.${key}`}
                initialValue={val}
                onSave={onFieldSave}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const { docName, hasManualEdit } = getPersonSource(person);

  return (
    <div style={itemStyle}>
      <div className="flex items-start gap-3">
        <div style={avatarStyle}>{initials}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 600,
                color: "var(--ink)",
                letterSpacing: "-0.005em",
              }}
              className="truncate"
            >
              {name}
            </h4>
            <VisibilityBadge visibility={person.name.visibility} />
            <PriorityBadge priority={person.name.priority} />
          </div>

          {person.role && (
            <div
              className="mt-1 flex items-center gap-1.5"
              style={{ fontSize: 13, color: "var(--ink-2)" }}
            >
              <Building
                className="h-3.5 w-3.5 flex-shrink-0"
                style={{ color: "var(--ink-3)" }}
              />
              <span className="truncate">{String(person.role.value)}</span>
              {person.role.priority === "manual_override" && (
                <PriorityBadge priority={person.role.priority} />
              )}
            </div>
          )}

          {person.department && (
            <p
              style={{
                margin: "4px 0 0 22px",
                fontSize: 12,
                color: "var(--ink-3)",
              }}
            >
              {String(person.department.value)}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {person.email && (
              <a
                href={`mailto:${String(person.email.value)}`}
                className="flex items-center gap-1"
                style={{ fontSize: 12, color: "var(--accent-ink)" }}
              >
                <Mail className="h-3 w-3 flex-shrink-0" />
                <span
                  className="truncate"
                  style={{ maxWidth: 160 }}
                >
                  {String(person.email.value)}
                </span>
              </a>
            )}

            {person.phone && (
              <a
                href={`tel:${String(person.phone.value)}`}
                className="flex items-center gap-1"
                style={{ fontSize: 12, color: "var(--accent-ink)" }}
              >
                <Phone className="h-3 w-3 flex-shrink-0" />
                <span>{String(person.phone.value)}</span>
              </a>
            )}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <ConfidenceBadge confidence={person.name.confidence} />
            <span
              style={{
                fontSize: 10,
                color: hasManualEdit ? "var(--accent-ink)" : "var(--ink-3)",
                fontWeight: hasManualEdit ? 600 : 400,
              }}
            >
              {hasManualEdit ? "Manual edit" : `from ${docName}`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
