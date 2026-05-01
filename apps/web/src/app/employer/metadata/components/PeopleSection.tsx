"use client";

import React, { useEffect, useState } from "react";
import {
  Mail,
  Phone,
  Briefcase,
  AlertCircle,
  FileText,
  Pencil,
} from "lucide-react";
import { legalTheme as s } from "~/app/employer/documents/components/LegalGeneratorTheme";
import m from "./metadata.module.css";
import type {
  PersonEntry,
  MetadataFact,
} from "@launchstack/features/company-metadata";

interface PeopleSectionProps {
  people: PersonEntry[];
  onFieldSave?: (path: string, value: string) => Promise<void>;
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
    <span className={`${m.confBar} ${cls}`} aria-label={`${bucket} confidence`}>
      {[0, 1, 2, 3].map((i) => (
        <i key={i} className={i < filled ? "on" : undefined} />
      ))}
    </span>
  );
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
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
  if (hasManualEdit) return { docName: "Edited by you", hasManualEdit: true };
  const firstSource = person.name.sources[0]?.doc_name ?? "document";
  return { docName: firstSource, hasManualEdit: false };
}

export function PeopleSection({ people, onFieldSave }: PeopleSectionProps) {
  if (people.length === 0) return null;
  return (
    <div className={m.peopleGrid}>
      {people.map((person, index) => (
        <PersonCard
          key={index}
          person={person}
          index={index}
          onFieldSave={onFieldSave}
        />
      ))}
    </div>
  );
}

interface PersonCardProps {
  person: PersonEntry;
  index: number;
  onFieldSave?: (path: string, value: string) => Promise<void>;
}

function PersonCard({ person, index, onFieldSave }: PersonCardProps) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = String(person.name.value);
  const initials = getInitials(name);
  const role = person.role ? String(person.role.value) : "";
  const department = person.department ? String(person.department.value) : "";
  const email = person.email ? String(person.email.value) : "";
  const phone = person.phone ? String(person.phone.value) : "";

  const source = getPersonSource(person);
  const roleMissing = !person.role;

  const startEdit = (field: string) => {
    if (!onFieldSave) return;
    setEditingField(field);
    setError(null);
  };
  const cancelEdit = () => {
    setEditingField(null);
    setError(null);
  };

  const save = async (field: string, currentValue: string, next: string) => {
    if (!onFieldSave) return;
    if (next === currentValue) {
      setEditingField(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onFieldSave(`people.${index}.${field}`, next);
      setEditingField(null);
    } catch {
      setError("Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={m.person}>
      <div className={m.avatar} aria-hidden>
        {initials || "·"}
      </div>
      <div className={m.pBody}>
        <div className={m.pName}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {name}
          </span>
          {person.name.priority === "manual_override" && (
            <span className={`${m.badge} ${m.badgeManual}`}>
              <span className="dot" />
              Manual
            </span>
          )}
        </div>

        {editingField === "role" ? (
          <PersonInlineInput
            initialValue={role}
            placeholder="e.g. Head of Engineering"
            saving={saving}
            error={error}
            onCancel={cancelEdit}
            onSave={(next) => void save("role", role, next)}
          />
        ) : roleMissing ? (
          <div className={`${m.pRole} ${m.pRoleMissing}`}>
            <AlertCircle width={12} height={12} />
            Role unknown
            {onFieldSave && (
              <>
                {" — "}
                <button
                  type="button"
                  className={m.pAddRole}
                  onClick={() => startEdit("role")}
                >
                  add
                </button>
              </>
            )}
          </div>
        ) : (
          <div className={m.pRole}>
            <Briefcase width={12} height={12} />
            <span>{role}</span>
          </div>
        )}

        {department && editingField !== "role" && (
          <div className={m.pDept}>{department}</div>
        )}

        {(email || phone) && (
          <div className={m.pContact}>
            {email && (
              <a href={`mailto:${email}`}>
                <Mail width={11} height={11} />
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 180,
                  }}
                >
                  {email}
                </span>
              </a>
            )}
            {phone && (
              <a href={`tel:${phone}`}>
                <Phone width={11} height={11} />
                {phone}
              </a>
            )}
          </div>
        )}

        <div className={m.pMeta}>
          <ConfBar confidence={person.name.confidence} />
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
    </div>
  );
}

interface PersonInlineInputProps {
  initialValue: string;
  placeholder?: string;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (next: string) => void;
}

function PersonInlineInput({
  initialValue,
  placeholder,
  saving,
  error,
  onCancel,
  onSave,
}: PersonInlineInputProps) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  return (
    <div className={m.editor} style={{ marginTop: 6 }}>
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
