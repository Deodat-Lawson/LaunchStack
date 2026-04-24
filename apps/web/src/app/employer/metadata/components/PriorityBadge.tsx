"use client";

import React from "react";
import { Pin } from "lucide-react";
import type { Priority } from "@launchstack/features/company-metadata";

interface PriorityBadgeProps {
  priority: Priority;
}

export function PriorityBadge({ priority }: PriorityBadgeProps) {
  if (priority !== "manual_override") return null;

  return (
    <span
      className="inline-flex items-center gap-1"
      style={{
        padding: "2px 6px",
        borderRadius: 6,
        fontSize: 10,
        fontWeight: 600,
        background: "var(--accent-soft)",
        color: "var(--accent-ink)",
      }}
    >
      <Pin className="h-3 w-3" />
      Manual
    </span>
  );
}
