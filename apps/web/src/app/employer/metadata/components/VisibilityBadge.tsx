"use client";

import React from "react";
import { Eye, EyeOff, Users, Lock } from "lucide-react";
import type { Visibility } from "@launchstack/features/company-metadata";

interface VisibilityBadgeProps {
  visibility: Visibility;
}

const visibilityConfig: Record<
  Visibility,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    bg: string;
    fg: string;
  }
> = {
  public: {
    label: "Public",
    icon: Eye,
    bg: "oklch(from var(--success) l c h / 0.14)",
    fg: "var(--success)",
  },
  partner: {
    label: "Partner",
    icon: Users,
    bg: "var(--accent-soft)",
    fg: "var(--accent-ink)",
  },
  private: {
    label: "Private",
    icon: EyeOff,
    bg: "oklch(from var(--warn) l c h / 0.16)",
    fg: "var(--warn)",
  },
  internal: {
    label: "Internal",
    icon: Lock,
    bg: "oklch(from var(--danger) l c h / 0.12)",
    fg: "var(--danger)",
  },
};

export function VisibilityBadge({ visibility }: VisibilityBadgeProps) {
  const config = visibilityConfig[visibility];
  const Icon = config.icon;

  return (
    <span
      className="inline-flex items-center gap-1"
      style={{
        padding: "2px 6px",
        borderRadius: 6,
        fontSize: 10,
        fontWeight: 600,
        background: config.bg,
        color: config.fg,
      }}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}
