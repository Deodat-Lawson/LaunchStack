"use client";

import React, { useState } from "react";
import {
  Upload,
  Github,
  ClipboardPaste,
  Globe,
  Youtube,
  type LucideIcon,
} from "lucide-react";

export type SourceType = "github" | "paste" | "website" | "youtube";

interface SourceGridProps {
  onSelectSource: (source: SourceType) => void;
  onFileClick: () => void;
  onFolderClick: () => void;
}

interface CardProps {
  Icon: LucideIcon;
  iconColor?: string;
  title: string;
  subtitle: string;
  onClick: () => void;
  children?: React.ReactNode;
}

function SourceCard({
  Icon,
  iconColor = "var(--accent)",
  title,
  subtitle,
  onClick,
  children,
}: CardProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        padding: "18px 14px",
        borderRadius: 12,
        border: `1px solid ${hover ? "var(--accent)" : "var(--line)"}`,
        background: hover ? "var(--accent-soft)" : "var(--panel)",
        textAlign: "center",
        cursor: "pointer",
        transition: "background 120ms, border-color 120ms",
        fontFamily: "inherit",
      }}
    >
      <Icon size={22} color={iconColor} />
      <span
        style={{
          fontSize: 13.5,
          fontWeight: 600,
          color: "var(--ink)",
        }}
      >
        {title}
      </span>
      <span
        style={{
          fontSize: 11.5,
          color: "var(--ink-3)",
          lineHeight: 1.35,
        }}
      >
        {subtitle}
      </span>
      {children}
    </button>
  );
}

export function SourceGrid({ onSelectSource, onFileClick, onFolderClick }: SourceGridProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: 10,
        maxWidth: 680,
        margin: "0 auto",
      }}
    >
      <SourceCard
        Icon={Upload}
        title="Files & folders"
        subtitle="PDF, DOCX, images, ZIP"
        onClick={onFileClick}
      >
        <span
          role="button"
          onClick={(e) => {
            e.stopPropagation();
            onFolderClick();
          }}
          style={{
            fontSize: 11,
            color: "var(--accent-ink)",
            fontWeight: 600,
            textDecoration: "underline",
            marginTop: 2,
            cursor: "pointer",
          }}
        >
          or select folder
        </span>
      </SourceCard>

      <SourceCard
        Icon={Github}
        iconColor="var(--ink)"
        title="GitHub repo"
        subtitle="Clone & index a repository"
        onClick={() => onSelectSource("github")}
      />

      <SourceCard
        Icon={ClipboardPaste}
        title="Paste text"
        subtitle="Markdown or plain text"
        onClick={() => onSelectSource("paste")}
      />

      <SourceCard
        Icon={Globe}
        iconColor="oklch(0.55 0.18 240)"
        title="Website"
        subtitle="Fetch a single web page"
        onClick={() => onSelectSource("website")}
      />

      <SourceCard
        Icon={Youtube}
        iconColor="oklch(0.58 0.2 25)"
        title="YouTube & video"
        subtitle="Transcribe a video URL"
        onClick={() => onSelectSource("youtube")}
      />
    </div>
  );
}
