"use client";

import React from "react";
import { FileText, Clock, Cpu, Hash } from "lucide-react";
import { legalTheme as s } from "~/app/employer/documents/components/LegalGeneratorTheme";
import type { ProvenanceInfo } from "@launchstack/features/company-metadata";

interface ProvenanceCardProps {
  provenance: ProvenanceInfo;
  updatedAt?: string;
}

export function ProvenanceCard({ provenance, updatedAt }: ProvenanceCardProps) {
  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return "Unknown";
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  return (
    <div className={s.panel} style={{ padding: 22 }}>
      <div className="flex items-center gap-3" style={{ marginBottom: 4 }}>
        <div className={s.brandMarkSm}>
          <Cpu className="h-[14px] w-[14px]" />
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
            Extraction details
          </h2>
          <p
            style={{
              margin: "2px 0 0",
              fontSize: 12,
              color: "var(--ink-3)",
            }}
          >
            How this metadata was extracted
          </p>
        </div>
      </div>
      <hr className={s.hair} style={{ margin: "14px 0 18px" }} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ProvenanceItem
          icon={FileText}
          label="Documents processed"
          value={provenance.total_documents_processed.toString()}
        />
        <ProvenanceItem
          icon={Hash}
          label="Extraction version"
          value={provenance.extraction_version || "1.0.0"}
        />
        <ProvenanceItem
          icon={Clock}
          label="Last updated"
          value={formatDate(updatedAt)}
        />
        {provenance.last_document_processed && (
          <ProvenanceItem
            icon={FileText}
            label="Last document"
            value={provenance.last_document_processed.doc_name}
          />
        )}
      </div>

      {provenance.extraction_model && (
        <div
          style={{
            marginTop: 14,
            padding: "10px 14px",
            borderRadius: 10,
            background: "var(--panel-2)",
            border: "1px solid var(--line-2)",
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--ink-3)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Extraction model
          </span>
          <p
            style={{
              margin: "3px 0 0",
              fontSize: 13,
              color: "var(--ink)",
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, "Liberation Mono", monospace',
            }}
          >
            {provenance.extraction_model}
          </p>
        </div>
      )}
    </div>
  );
}

function ProvenanceItem({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: "var(--panel-2)",
          border: "1px solid var(--line-2)",
          color: "var(--ink-2)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0">
        <span
          style={{
            display: "block",
            fontSize: 10,
            fontWeight: 700,
            color: "var(--ink-3)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {label}
        </span>
        <p
          style={{
            margin: "3px 0 0",
            fontSize: 13,
            fontWeight: 500,
            color: "var(--ink)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 180,
          }}
          title={value}
        >
          {value}
        </p>
      </div>
    </div>
  );
}
