"use client";

import React, { useEffect } from "react";
import { X } from "lucide-react";
import { GitHubSourceTab } from "./GitHubSourceTab";
import { PasteSourceTab } from "./PasteSourceTab";
import { WebsiteSourceTab } from "./WebsiteSourceTab";
import { YouTubeSourceTab } from "./YouTubeSourceTab";

import type { SourceType } from "./SourceGrid";

interface SourceDialogProps {
  open: SourceType | null;
  onClose: () => void;
  categories: { id: string; name: string }[];
  defaultCategory?: string;
  onFilesAdded: (files: File[]) => void;
}

const titles: Record<SourceType, { title: string; description: string; wide: boolean }> = {
  github: {
    title: "Index a GitHub repository",
    description: "Enter a repository URL to clone and index it into your knowledge base.",
    wide: true,
  },
  paste: {
    title: "Paste text",
    description: "Paste markdown or plain text to add as a document.",
    wide: false,
  },
  website: {
    title: "Import from website",
    description: "Fetch a single web page and add its content to your knowledge base.",
    wide: true,
  },
  youtube: {
    title: "Import from YouTube or video platforms",
    description:
      "Paste a video URL — audio will be extracted and transcribed into a searchable document.",
    wide: false,
  },
};

export function SourceDialog({
  open,
  onClose,
  categories,
  defaultCategory,
  onFilesAdded,
}: SourceDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const info = titles[open];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 150,
        background: "var(--scrim)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: info.wide ? 720 : 560,
          maxWidth: "92vw",
          maxHeight: "88vh",
          background: "var(--panel)",
          borderRadius: 16,
          boxShadow: "0 30px 80px var(--scrim-shadow), 0 0 0 1px var(--line)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            padding: "20px 24px 16px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "var(--ink)" }}>
              {info.title}
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--ink-3)",
                marginTop: 4,
                lineHeight: 1.45,
              }}
            >
              {info.description}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: "transparent",
              border: "none",
              color: "var(--ink-3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              marginLeft: 12,
              flexShrink: 0,
            }}
          >
            <X size={16} />
          </button>
        </div>
        <div
          style={{
            padding: "20px 24px 24px",
            overflowY: "auto",
          }}
        >
          {open === "github" && (
            <GitHubSourceTab
              categories={categories}
              defaultCategory={defaultCategory}
            />
          )}
          {open === "paste" && (
            <PasteSourceTab
              onFilesAdded={(files) => {
                onFilesAdded(files);
                onClose();
              }}
            />
          )}
          {open === "website" && (
            <WebsiteSourceTab
              categories={categories}
              defaultCategory={defaultCategory}
            />
          )}
          {open === "youtube" && (
            <YouTubeSourceTab
              categories={categories}
              defaultCategory={defaultCategory}
              onSuccess={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}
