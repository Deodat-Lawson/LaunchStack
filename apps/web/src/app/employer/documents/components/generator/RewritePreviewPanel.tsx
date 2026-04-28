"use client";

import React from "react";
import { diffWords } from "diff";
import { Check, X, RotateCw, Sparkles } from "lucide-react";
import { legalTheme as s } from "../LegalGeneratorTheme";

export interface RewritePreviewProps {
  originalText: string;
  proposedText: string;
  onAccept: () => void;
  onReject: () => void;
  onTryAgain: () => void;
  isRetrying?: boolean;
}

/* Drift redesign palette — matches `redesign-rewrite.jsx` byte-for-byte. */
const REMOVAL_BG = "oklch(0.94 0.06 25 / 0.45)";
const REMOVAL_DECORATION = "oklch(0.55 0.16 25 / 0.7)";
const ADDITION_BG = "oklch(0.92 0.10 145 / 0.4)";
const PROPOSED_PANE_TINT =
  "color-mix(in oklch, oklch(0.78 0.10 145) 4%, transparent)";

interface DiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export function RewritePreviewPanel({
  originalText,
  proposedText,
  onAccept,
  onReject,
  onTryAgain,
  isRetrying = false,
}: RewritePreviewProps) {
  const safeOriginal = typeof originalText === "string" ? originalText : "";
  const safeProposed = typeof proposedText === "string" ? proposedText : "";
  const parts: DiffPart[] = diffWords(safeOriginal, safeProposed);

  const changeCount = parts.filter((p) => p.added === true || p.removed === true).length;
  const subtitle =
    changeCount === 0
      ? "no edits · matches source"
      : `${changeCount} change${changeCount === 1 ? "" : "s"} · pending review`;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        borderRadius: 14,
        border: "1px solid var(--line-2)",
        background: "color-mix(in oklch, var(--panel) 30%, transparent)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        overflow: "hidden",
      }}
    >
      {/* Header — matches redesign `.rd-pipe__head` */}
      <div
        style={{
          padding: "18px 28px 14px",
          borderBottom: "1px solid var(--line-2)",
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 500,
              color: "var(--ink)",
              letterSpacing: "-0.015em",
            }}
          >
            Rewrite{" "}
            <em
              className={s.serif}
              style={{ fontSize: 20, fontWeight: 400 }}
            >
              preview
            </em>
          </h1>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 12,
              color: "var(--ink-3)",
            }}
          >
            {subtitle}
          </p>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className={`${s.btn} ${s.btnGhost} ${s.btnSm}`}
            onClick={onTryAgain}
            disabled={isRetrying}
          >
            <RotateCw
              className={`h-3.5 w-3.5${isRetrying ? " animate-spin" : ""}`}
            />
            Regenerate
          </button>
          <span
            aria-hidden
            style={{
              width: 1,
              height: 20,
              background: "var(--line-2)",
              margin: "0 2px",
            }}
          />
          <button
            type="button"
            className={`${s.btn} ${s.btnOutline} ${s.btnSm}`}
            onClick={onReject}
            disabled={isRetrying}
          >
            <X className="h-3.5 w-3.5" />
            Reject section
          </button>
          <button
            type="button"
            className={`${s.btn} ${s.btnAccent} ${s.btnSm}`}
            onClick={onAccept}
            disabled={isRetrying}
          >
            <Check className="h-3.5 w-3.5" />
            Accept section
          </button>
        </div>
      </div>

      {/* Body — 50/50 split, flat panes, vertical hairline divider */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          minHeight: 280,
          maxHeight: 520,
        }}
      >
        {/* Original · v-prev */}
        <div
          style={{
            borderRight: "1px solid var(--line-2)",
            overflow: "auto",
            padding: "20px 28px 32px",
          }}
        >
          <div className={s.eyebrow} style={{ marginBottom: 14 }}>
            Original
          </div>
          <DiffProse
            parts={parts}
            mode="original"
            emptyHint="No source text to compare."
          />
        </div>

        {/* Proposed · v-next */}
        <div
          style={{
            overflow: "auto",
            padding: "20px 28px 32px",
            background: PROPOSED_PANE_TINT,
          }}
        >
          <div
            className={s.eyebrow}
            style={{
              marginBottom: 14,
              color: "var(--success)",
            }}
          >
            <span aria-hidden style={{ background: "var(--success)" }} />
            Proposed
          </div>
          <DiffProse
            parts={parts}
            mode="proposed"
            emptyHint="The rewrite is empty."
          />

          {/* "Why this change" card — exact redesign treatment */}
          {changeCount > 0 && (
            <div
              style={{
                marginTop: 16,
                padding: 12,
                borderRadius: 10,
                background:
                  "color-mix(in oklch, var(--panel) 90%, transparent)",
                border: "1px solid var(--line-2)",
                fontSize: 12,
                color: "var(--ink-3)",
                lineHeight: 1.55,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: "var(--accent)",
                  marginBottom: 6,
                  fontWeight: 500,
                  fontSize: 11,
                }}
              >
                <Sparkles className="h-3 w-3" />
                <span>Why this change</span>
              </div>
              {summarizeRewrite(parts)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* Renders one side of the diff as inline-highlighted prose. The redesign
   keeps line-throughs on the original side and green-wash highlights on
   the proposed side; unchanged text stays in body color. */
function DiffProse({
  parts,
  mode,
  emptyHint,
}: {
  parts: DiffPart[];
  mode: "original" | "proposed";
  emptyHint: string;
}) {
  const isOriginal = mode === "original";
  const visibleParts = parts.filter((p) =>
    isOriginal ? !p.added : !p.removed,
  );

  const hasContent = visibleParts.some((p) => p.value.length > 0);
  if (!hasContent) {
    return (
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "var(--ink-4)",
          fontStyle: "italic",
        }}
      >
        {emptyHint}
      </p>
    );
  }

  return (
    <div
      style={{
        fontSize: 14,
        lineHeight: 1.7,
        color: isOriginal ? "var(--ink-2)" : "var(--ink)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {visibleParts.map((part, i) => {
        if (isOriginal && part.removed) {
          return (
            <span
              key={i}
              style={{
                background: REMOVAL_BG,
                textDecoration: "line-through",
                textDecorationColor: REMOVAL_DECORATION,
                padding: "0 2px",
              }}
            >
              {part.value}
            </span>
          );
        }
        if (!isOriginal && part.added) {
          return (
            <span
              key={i}
              style={{
                background: ADDITION_BG,
                borderRadius: 4,
                padding: "0 3px",
              }}
            >
              {part.value}
            </span>
          );
        }
        return <span key={i}>{part.value}</span>;
      })}
    </div>
  );
}

function summarizeRewrite(parts: DiffPart[]): string {
  let added = 0;
  let removed = 0;
  for (const part of parts) {
    const words = part.value.trim() ? part.value.trim().split(/\s+/).length : 0;
    if (part.added) added += words;
    else if (part.removed) removed += words;
  }
  const delta = added - removed;
  const editCount = parts.filter((p) => p.added === true || p.removed === true).length;

  if (editCount === 0) {
    return "No edits proposed — the rewrite matches the source word-for-word.";
  }
  if (delta > 0) {
    return `Expanded by ${delta} word${delta === 1 ? "" : "s"} across ${editCount} edit${editCount === 1 ? "" : "s"}. Review the highlighted spans before accepting.`;
  }
  if (delta < 0) {
    return `Tightened by ${Math.abs(delta)} word${Math.abs(delta) === 1 ? "" : "s"} across ${editCount} edit${editCount === 1 ? "" : "s"}. Review the highlighted spans before accepting.`;
  }
  return `${editCount} edit${editCount === 1 ? "" : "s"} proposed without changing the overall length. Review the highlighted spans before accepting.`;
}
