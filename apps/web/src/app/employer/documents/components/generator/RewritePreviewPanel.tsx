"use client";

import React, { useState } from "react";
import { diffWords } from "diff";
import { Check, X, RotateCw, Eye, EyeOff, ArrowLeftRight } from "lucide-react";
import MarkdownMessage from "~/app/_components/MarkdownMessage";
import { legalTheme as s } from "../LegalGeneratorTheme";

export interface RewritePreviewProps {
  originalText: string;
  proposedText: string;
  onAccept: () => void;
  onReject: () => void;
  onTryAgain: () => void;
  isRetrying?: boolean;
}

type ViewMode = "diff" | "sidebyside" | "clean";

export function RewritePreviewPanel({
  originalText,
  proposedText,
  onAccept,
  onReject,
  onTryAgain,
  isRetrying = false,
}: RewritePreviewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("sidebyside");
  const safeOriginal = typeof originalText === "string" ? originalText : "";
  const safeProposed = typeof proposedText === "string" ? proposedText : "";
  const changes = diffWords(safeOriginal, safeProposed);

  const stats = {
    wordsOriginal: safeOriginal.trim() ? safeOriginal.split(/\s+/).length : 0,
    wordsRewritten: safeProposed.trim() ? safeProposed.split(/\s+/).length : 0,
    charactersOriginal: safeOriginal.length,
    charactersRewritten: safeProposed.length,
    changes: changes.filter((part) => part.added || part.removed).length,
  };

  const wordDelta = stats.wordsRewritten - stats.wordsOriginal;

  const paneStyle: React.CSSProperties = {
    maxHeight: 360,
    overflowY: "auto",
    padding: 14,
    borderRadius: 12,
    fontSize: 13,
    lineHeight: 1.65,
    color: "var(--ink)",
    background: "var(--panel)",
    border: "1px solid var(--line-2)",
  };

  const renderDiffView = () => (
    <div
      style={{
        ...paneStyle,
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, "Liberation Mono", monospace',
        background: "var(--panel-2)",
      }}
    >
      {changes.map((part, i) => {
        if (part.added) {
          return (
            <span
              key={i}
              style={{
                background: "oklch(from var(--success) l c h / 0.18)",
                color: "var(--success)",
                padding: "0 2px",
                borderRadius: 3,
                fontWeight: 500,
              }}
            >
              {part.value}
            </span>
          );
        }
        if (part.removed) {
          return (
            <span
              key={i}
              style={{
                background: "oklch(from var(--danger) l c h / 0.15)",
                color: "var(--danger)",
                padding: "0 2px",
                borderRadius: 3,
                textDecoration: "line-through",
              }}
            >
              {part.value}
            </span>
          );
        }
        return (
          <span key={i} style={{ color: "var(--ink-2)" }}>
            {part.value}
          </span>
        );
      })}
    </div>
  );

  const renderSideBySideView = () => (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <div
        style={{
          padding: 14,
          borderRadius: 12,
          border: "1px solid oklch(from var(--danger) l c h / 0.28)",
          background: "oklch(from var(--danger) l c h / 0.05)",
        }}
      >
        <div
          className="mb-2 flex items-center gap-2"
          style={{ fontSize: 12 }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: "var(--danger)",
              boxShadow: "0 0 0 3px oklch(from var(--danger) l c h / 0.2)",
            }}
          />
          <span style={{ fontWeight: 600, color: "var(--ink)" }}>
            Original
          </span>
          <span style={{ color: "var(--ink-3)", marginLeft: "auto" }}>
            {stats.wordsOriginal}w · {stats.charactersOriginal}c
          </span>
        </div>
        <div
          style={{
            maxHeight: 340,
            overflowY: "auto",
            fontSize: 13,
            lineHeight: 1.6,
            color: "var(--ink-2)",
          }}
        >
          <MarkdownMessage
            content={safeOriginal}
            className="prose prose-sm dark:prose-invert max-w-none"
          />
        </div>
      </div>

      <div
        style={{
          padding: 14,
          borderRadius: 12,
          border: "1px solid oklch(from var(--success) l c h / 0.3)",
          background: "oklch(from var(--success) l c h / 0.06)",
        }}
      >
        <div
          className="mb-2 flex items-center gap-2"
          style={{ fontSize: 12 }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: "var(--success)",
              boxShadow: "0 0 0 3px oklch(from var(--success) l c h / 0.2)",
            }}
          />
          <span style={{ fontWeight: 600, color: "var(--ink)" }}>
            Rewritten
          </span>
          <span style={{ color: "var(--ink-3)", marginLeft: "auto" }}>
            {stats.wordsRewritten}w · {stats.charactersRewritten}c
          </span>
        </div>
        <div
          style={{
            maxHeight: 340,
            overflowY: "auto",
            fontSize: 13,
            lineHeight: 1.6,
            color: "var(--ink)",
          }}
        >
          <MarkdownMessage
            content={safeProposed}
            className="prose prose-sm dark:prose-invert max-w-none"
          />
        </div>
      </div>
    </div>
  );

  const renderCleanView = () => (
    <div style={paneStyle}>
      <MarkdownMessage
        content={safeProposed}
        className="prose prose-sm dark:prose-invert max-w-none"
      />
    </div>
  );

  return (
    <div
      className={s.panel}
      style={{ padding: 18, display: "flex", flexDirection: "column", gap: 18 }}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              color: "var(--ink)",
              letterSpacing: "-0.01em",
            }}
          >
            Rewrite preview
          </h4>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ink-3)" }}>
            {stats.changes} changes ·{" "}
            {wordDelta > 0 ? "+" : ""}
            {wordDelta} words
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className={`${s.btn} ${s.btnOutline} ${s.btnSm}`}
            onClick={onTryAgain}
            disabled={isRetrying}
          >
            <RotateCw
              className={`h-3.5 w-3.5${isRetrying ? " animate-spin" : ""}`}
            />
            Regenerate
          </button>
          <button
            className={`${s.btn} ${s.btnDanger} ${s.btnSm}`}
            onClick={onReject}
            disabled={isRetrying}
          >
            <X className="h-3.5 w-3.5" />
            Reject
          </button>
          <button
            className={`${s.btn} ${s.btnAccent} ${s.btnSm}`}
            onClick={onAccept}
            disabled={isRetrying}
          >
            <Check className="h-3.5 w-3.5" />
            Push to rewrite
          </button>
        </div>
      </div>

      {/* View switcher */}
      <div className={s.btnGroup} style={{ alignSelf: "flex-start" }}>
        {(
          [
            { id: "sidebyside", label: "Side by side", Icon: ArrowLeftRight },
            { id: "diff", label: "Show changes", Icon: Eye },
            { id: "clean", label: "Clean view", Icon: EyeOff },
          ] as const
        ).map(({ id, label, Icon }) => {
          const active = viewMode === id;
          return (
            <button
              key={id}
              type="button"
              className={`${s.tab} ${active ? s.tabActive : ""}`}
              onClick={() => setViewMode(id)}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div>
        {viewMode === "sidebyside" && renderSideBySideView()}
        {viewMode === "diff" && renderDiffView()}
        {viewMode === "clean" && renderCleanView()}
      </div>

      {/* Stats */}
      <div
        className="grid grid-cols-2 gap-4 md:grid-cols-4"
        style={{
          padding: 14,
          borderRadius: 12,
          background: "var(--panel-2)",
          border: "1px solid var(--line-2)",
        }}
      >
        <Stat label="Original words" value={stats.wordsOriginal} />
        <Stat label="New words" value={stats.wordsRewritten} />
        <Stat
          label="Word difference"
          value={`${wordDelta > 0 ? "+" : ""}${wordDelta}`}
          tone={wordDelta > 0 ? "success" : wordDelta < 0 ? "danger" : "neutral"}
        />
        <Stat label="Changes made" value={stats.changes} tone="accent" />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  tone?: "neutral" | "accent" | "success" | "danger";
}) {
  const color =
    tone === "accent"
      ? "var(--accent)"
      : tone === "success"
      ? "var(--success)"
      : tone === "danger"
      ? "var(--danger)"
      : "var(--ink)";
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          fontSize: 20,
          fontWeight: 600,
          color,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "var(--ink-3)",
          marginTop: 2,
          letterSpacing: "0.02em",
        }}
      >
        {label}
      </div>
    </div>
  );
}
