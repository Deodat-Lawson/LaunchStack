"use client";

import React from "react";
import { Scale, Calendar, Users as UsersIcon } from "lucide-react";
import { legalTheme as s } from "~/app/employer/documents/components/LegalGeneratorTheme";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { VisibilityBadge } from "./VisibilityBadge";
import { PriorityBadge } from "./PriorityBadge";
import type { LegalEntry } from "@launchstack/features/company-metadata";

interface LegalSectionProps {
  legal: LegalEntry[];
}

export function LegalSection({ legal }: LegalSectionProps) {
  return (
    <div className={s.panel} style={{ padding: 22 }}>
      <div className="flex items-center gap-3" style={{ marginBottom: 4 }}>
        <div className={s.brandMarkSm}>
          <Scale className="h-[14px] w-[14px]" />
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
            Legal documents
          </h2>
          <p
            style={{
              margin: "2px 0 0",
              fontSize: 12,
              color: "var(--ink-3)",
            }}
          >
            {legal.length} {legal.length === 1 ? "document" : "documents"} identified
          </p>
        </div>
      </div>
      <hr className={s.hair} style={{ margin: "14px 0 18px" }} />
      <div className="space-y-3">
        {legal.map((entry, index) => (
          <LegalCard key={index} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function statusTone(status: string): { bg: string; fg: string; border: string } {
  if (status === "active") {
    return {
      bg: "oklch(from var(--success) l c h / 0.12)",
      fg: "var(--success)",
      border: "oklch(from var(--success) l c h / 0.25)",
    };
  }
  if (status === "expired") {
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

function LegalCard({ entry }: { entry: LegalEntry }) {
  const typeValue = entry.type ? String(entry.type.value) : null;
  const statusValue = entry.status
    ? String(entry.status.value).toLowerCase()
    : null;

  const tone = statusValue ? statusTone(statusValue) : null;

  const itemStyle: React.CSSProperties = {
    padding: 14,
    borderRadius: 12,
    background: "var(--panel-2)",
    border: "1px solid var(--line-2)",
  };

  const pillStyle: React.CSSProperties = {
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 600,
    background: "var(--accent-soft)",
    color: "var(--accent-ink)",
    border: "1px solid oklch(from var(--accent) l c h / 0.2)",
  };

  return (
    <div style={itemStyle}>
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
            {String(entry.name.value)}
          </h4>
          {typeValue && <span style={pillStyle}>{typeValue.replace(/_/g, " ")}</span>}
          {statusValue && tone && (
            <span
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
              {statusValue.charAt(0).toUpperCase() + statusValue.slice(1)}
            </span>
          )}
          <VisibilityBadge visibility={entry.name.visibility} />
          <PriorityBadge priority={entry.name.priority} />
        </div>

        {entry.summary && (
          <p
            style={{
              margin: "0 0 8px",
              fontSize: 13,
              color: "var(--ink-2)",
              lineHeight: 1.55,
            }}
          >
            {String(entry.summary.value)}
          </p>
        )}

        <div
          className="flex flex-wrap gap-4"
          style={{ fontSize: 12, color: "var(--ink-3)" }}
        >
          {entry.effective_date && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Effective: {String(entry.effective_date.value)}
            </span>
          )}
          {entry.expiry_date && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Expires: {String(entry.expiry_date.value)}
            </span>
          )}
          {entry.parties && (
            <span className="flex items-center gap-1">
              <UsersIcon className="h-3 w-3" />
              {String(entry.parties.value)}
            </span>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <ConfidenceBadge confidence={entry.name.confidence} />
          {entry.name.sources.length > 0 && (
            <span style={{ fontSize: 10, color: "var(--ink-3)" }}>
              from {entry.name.sources[0]?.doc_name ?? "document"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
