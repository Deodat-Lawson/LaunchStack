"use client";

import React from "react";
import { FileText, Pencil } from "lucide-react";
import m from "./metadata.module.css";
import type { LegalEntry } from "@launchstack/features/company-metadata";

interface LegalSectionProps {
  legal: LegalEntry[];
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

function inferJurisdiction(name: string): string | null {
  const upper = name.toUpperCase();
  const match = upper.match(/\b(US-[A-Z]{2}|UK|US|EU|CA|SG|DE|FR|JP|IN|AU)\b/);
  return match ? match[0] : null;
}

export function LegalSection({ legal }: LegalSectionProps) {
  if (legal.length === 0) return null;

  return (
    <div style={{ overflowX: "auto" }}>
      <table className={m.legalTable}>
        <thead>
          <tr>
            <th>Entity</th>
            <th>Type</th>
            <th>Effective</th>
            <th>Confidence</th>
            <th>Source</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {legal.map((entry, idx) => (
            <LegalRow key={idx} entry={entry} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LegalRow({ entry }: { entry: LegalEntry }) {
  const name = String(entry.name.value);
  const juris = inferJurisdiction(name);
  const type = entry.type ? String(entry.type.value) : "—";
  const summary = entry.summary ? String(entry.summary.value) : "";
  const effective = entry.effective_date
    ? String(entry.effective_date.value)
    : null;
  const expiry = entry.expiry_date ? String(entry.expiry_date.value) : null;
  const status = entry.status ? String(entry.status.value).toLowerCase() : null;
  const source = entry.name.sources[0]?.doc_name;
  const isManual = entry.name.priority === "manual_override";

  return (
    <tr>
      <td>
        <div className={m.legalName}>
          <span>{name}</span>
          {juris && <span className={m.legalJuris}>{juris}</span>}
        </div>
        {summary && <div className={m.legalSub}>{summary}</div>}
        {!summary && effective && (
          <div className={m.legalSub}>Effective {effective}</div>
        )}
      </td>
      <td>{type !== "—" ? type.replace(/_/g, " ") : <span style={{ color: "var(--ink-4)" }}>—</span>}</td>
      <td>
        {effective ? (
          <span className={m.legalId}>{effective}</span>
        ) : (
          <span style={{ color: "var(--ink-4)" }}>—</span>
        )}
        {expiry && (
          <div className={m.legalSub}>
            Expires {expiry}
            {status && ` · ${status}`}
          </div>
        )}
      </td>
      <td>
        <ConfBar confidence={entry.name.confidence} />
      </td>
      <td>
        {isManual ? (
          <span className={`${m.src} ${m.srcManual}`}>
            <Pencil width={10} height={10} />
            Edited by you
          </span>
        ) : source ? (
          <span className={m.src} title={source}>
            <FileText width={10} height={10} />
            {source}
          </span>
        ) : (
          <span style={{ color: "var(--ink-4)", fontSize: 12 }}>—</span>
        )}
      </td>
      <td style={{ width: 36 }}>
        <button
          type="button"
          className={m.fieldEdit}
          style={{ opacity: 1 }}
          aria-label={`Edit ${name}`}
          title="Edit"
        >
          <Pencil width={12} height={12} />
        </button>
      </td>
    </tr>
  );
}
