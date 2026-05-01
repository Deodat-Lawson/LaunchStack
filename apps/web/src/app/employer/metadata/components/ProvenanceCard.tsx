"use client";

import React from "react";
import { FileText, Clock, Pencil } from "lucide-react";
import m from "./metadata.module.css";
import type { ProvenanceInfo } from "@launchstack/features/company-metadata";

interface ProvenanceCardProps {
  provenance: ProvenanceInfo;
  updatedAt?: string;
  manualEditCount?: number;
  totalChunks?: number;
}

function formatRelative(dateStr: string | undefined): {
  short: string;
  detail: string;
} {
  if (!dateStr) return { short: "Never", detail: "No extraction yet" };
  let d: Date;
  try {
    d = new Date(dateStr);
  } catch {
    return { short: dateStr, detail: "" };
  }
  if (Number.isNaN(d.getTime())) return { short: dateStr, detail: "" };

  const now = Date.now();
  const diffMs = now - d.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  let short: string;
  if (diffMs < minute) short = "just now";
  else if (diffMs < hour) short = `${Math.round(diffMs / minute)}m ago`;
  else if (diffMs < day) short = `${Math.round(diffMs / hour)}h ago`;
  else if (diffMs < 30 * day) short = `${Math.round(diffMs / day)}d ago`;
  else short = d.toLocaleDateString();

  const detail = d.toLocaleString();
  return { short, detail };
}

export function ProvenanceCard({
  provenance,
  updatedAt,
  manualEditCount = 0,
  totalChunks,
}: ProvenanceCardProps) {
  const { short, detail } = formatRelative(updatedAt);
  const docCount = provenance.total_documents_processed;
  const chunksLabel =
    totalChunks && totalChunks > 0 ? `· ${totalChunks} chunks` : "";

  return (
    <div className={m.prov}>
      <div>
        <div className={m.provLabel}>
          <FileText width={12} height={12} />
          Documents processed
        </div>
        <div className={`${m.provValue} ${m.provValueMono}`}>
          {docCount} {docCount === 1 ? "source" : "sources"}
          {chunksLabel && (
            <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>
              {" "}
              {chunksLabel}
            </span>
          )}
        </div>
        <div className={m.provDetail}>
          {provenance.last_document_processed?.doc_name
            ? `Most recent: ${provenance.last_document_processed.doc_name}`
            : "PDFs, recordings, repo READMEs and more"}
        </div>
      </div>
      <div>
        <div className={m.provLabel}>
          <Clock width={12} height={12} />
          Last extraction
        </div>
        <div className={m.provValue}>
          <span className={m.liveDot} aria-hidden />
          {short}
        </div>
        <div className={m.provDetail}>
          {detail ? `${detail} · ` : ""}
          {provenance.extraction_version
            ? `v${provenance.extraction_version}`
            : ""}
          {provenance.extraction_model && (
            <>
              {provenance.extraction_version ? " · " : ""}
              <span style={{ fontFamily: "JetBrains Mono, ui-monospace, monospace" }}>
                {provenance.extraction_model}
              </span>
            </>
          )}
        </div>
      </div>
      <div>
        <div className={m.provLabel}>
          <Pencil width={12} height={12} />
          Manual edits
        </div>
        <div className={m.provValue}>
          {manualEditCount} {manualEditCount === 1 ? "field" : "fields"}
        </div>
        <div className={m.provDetail}>
          Manual edits override AI on re-extract.
        </div>
      </div>
    </div>
  );
}
