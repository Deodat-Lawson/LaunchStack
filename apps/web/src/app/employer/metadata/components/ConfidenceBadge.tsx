"use client";

import React from "react";

interface ConfidenceBadgeProps {
  confidence: number;
  showLabel?: boolean;
}

export function ConfidenceBadge({
  confidence,
  showLabel = false,
}: ConfidenceBadgeProps) {
  const percentage = Math.round(confidence * 100);

  let tone: { bg: string; fg: string };
  if (percentage >= 80) {
    tone = {
      bg: "oklch(from var(--success) l c h / 0.14)",
      fg: "var(--success)",
    };
  } else if (percentage >= 60) {
    tone = {
      bg: "oklch(from var(--warn) l c h / 0.16)",
      fg: "var(--warn)",
    };
  } else {
    tone = {
      bg: "oklch(from var(--danger) l c h / 0.12)",
      fg: "var(--danger)",
    };
  }

  return (
    <span
      className="inline-flex items-center gap-1"
      style={{
        padding: "2px 6px",
        borderRadius: 6,
        fontSize: 10,
        fontWeight: 600,
        background: tone.bg,
        color: tone.fg,
      }}
    >
      {percentage}%
      {showLabel && " confidence"}
    </span>
  );
}
