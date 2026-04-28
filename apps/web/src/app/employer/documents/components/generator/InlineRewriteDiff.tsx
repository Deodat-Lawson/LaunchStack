"use client";

import React from "react";
import { diffWords } from "diff";
import { Check, X, RotateCw, Sparkles } from "lucide-react";

export interface InlineRewriteDiffProps {
  originalText: string;
  proposedText: string;
  onAccept: () => void;
  onReject: () => void;
  onTryAgain: () => void;
  isRetrying?: boolean;
}

const ADDITION_BG = "oklch(0.92 0.10 145 / 0.5)";
const ADDITION_INK = "oklch(0.34 0.14 145)";
const REMOVAL_BG = "oklch(0.94 0.06 25 / 0.45)";
const REMOVAL_INK = "oklch(0.45 0.18 25)";
const REMOVAL_DECO = "oklch(0.55 0.16 25 / 0.7)";

const monoFont =
  'var(--font-jetbrains-mono, "JetBrains Mono"), ui-monospace, monospace';

/**
 * Inline before/after diff shown directly in the document at the selection.
 * Uses the Drift redesign palette so it sits cleanly on top of the ambient
 * canvas without fighting the document's typography.
 */
export function InlineRewriteDiff({
  originalText,
  proposedText,
  onAccept,
  onReject,
  onTryAgain,
  isRetrying = false,
}: InlineRewriteDiffProps) {
  const changes = diffWords(originalText, proposedText);
  const editCount = changes.filter((p) => p.added || p.removed).length;

  return (
    <span
      className="my-2 inline-block w-full align-baseline"
      style={
        {
          ["--inline-accent" as string]: "var(--accent, oklch(0.54 0.24 285))",
        } as React.CSSProperties
      }
    >
      <span
        className="inline-flex w-full max-w-full flex-col gap-3 rounded-xl p-3"
        style={{
          background:
            "color-mix(in oklch, var(--panel, white) 88%, transparent)",
          border: "1px solid var(--line-2, oklch(0.93 0.006 285))",
          boxShadow: "0 1px 2px oklch(0.2 0.02 285 / 0.04)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
      >
        {/* Header row — eyebrow + edit count */}
        <span className="flex items-center gap-2">
          <Sparkles
            className="h-3 w-3"
            style={{ color: "var(--inline-accent)" }}
          />
          <span
            style={{
              fontFamily: monoFont,
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--inline-accent)",
              fontWeight: 500,
            }}
          >
            Rewrite preview
          </span>
          <span
            style={{
              flex: 1,
              height: 1,
              background:
                "linear-gradient(to right, var(--line-2, oklch(0.93 0.006 285)), transparent)",
            }}
          />
          <span
            style={{
              fontFamily: monoFont,
              fontSize: 10,
              letterSpacing: "0.04em",
              color: "var(--ink-3, oklch(0.58 0.015 285))",
            }}
          >
            {editCount} {editCount === 1 ? "edit" : "edits"}
          </span>
        </span>

        {/* Diff body */}
        <span
          className="leading-relaxed"
          style={{
            fontSize: 14,
            lineHeight: 1.65,
            color: "var(--ink, oklch(0.22 0.02 285))",
          }}
        >
          {changes.map((part, i) => {
            if (part.added) {
              return (
                <span
                  key={i}
                  style={{
                    background: ADDITION_BG,
                    color: ADDITION_INK,
                    padding: "0 3px",
                    borderRadius: 4,
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
                    background: REMOVAL_BG,
                    color: REMOVAL_INK,
                    padding: "0 3px",
                    borderRadius: 4,
                    textDecoration: "line-through",
                    textDecorationColor: REMOVAL_DECO,
                  }}
                >
                  {part.value}
                </span>
              );
            }
            return <span key={i}>{part.value}</span>;
          })}
        </span>

        {/* Controls — flat Drift buttons */}
        <span className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onAccept}
            disabled={isRetrying}
            style={btnStyle("accent", isRetrying)}
          >
            <Check className="h-3 w-3" />
            Accept
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={isRetrying}
            style={btnStyle("outline", isRetrying)}
          >
            <X className="h-3 w-3" />
            Reject
          </button>
          <button
            type="button"
            onClick={onTryAgain}
            disabled={isRetrying}
            style={btnStyle("ghost", isRetrying)}
          >
            <RotateCw
              className={`h-3 w-3${isRetrying ? " animate-spin" : ""}`}
            />
            Try again
          </button>
        </span>
      </span>
    </span>
  );
}

function btnStyle(
  variant: "accent" | "outline" | "ghost",
  disabled: boolean,
): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "5px 10px",
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: "-0.005em",
    borderRadius: 6,
    border: "1px solid transparent",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    fontFamily: "inherit",
    transition:
      "background-color 160ms ease, border-color 160ms ease, color 160ms ease",
  };
  if (variant === "accent") {
    return {
      ...base,
      background: "var(--inline-accent)",
      color: "white",
    };
  }
  if (variant === "outline") {
    return {
      ...base,
      background: "var(--panel, white)",
      color: "var(--ink, oklch(0.22 0.02 285))",
      borderColor: "var(--line, oklch(0.88 0.008 285))",
    };
  }
  return {
    ...base,
    background: "transparent",
    color: "var(--ink-2, oklch(0.42 0.02 285))",
  };
}
