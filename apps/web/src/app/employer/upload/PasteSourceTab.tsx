"use client";

import React, { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

interface PasteSourceTabProps {
  onFilesAdded: (files: File[]) => void;
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--ink-2)",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 9,
  border: "1px solid var(--line)",
  background: "var(--panel)",
  fontSize: 14,
  color: "var(--ink)",
  outline: "none",
  fontFamily: "inherit",
};

export function PasteSourceTab({ onFilesAdded }: PasteSourceTabProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const handleAddToQueue = () => {
    const trimmedTitle = title.trim() || "Untitled Document";
    const trimmedContent = content.trim();

    if (!trimmedContent) {
      toast.error("Please enter some content");
      return;
    }

    const sanitized = trimmedTitle
      .replace(/[^a-zA-Z0-9\s-_]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 100);
    const filename = `${sanitized || "document"}.md`;

    const file = new File([trimmedContent], filename, {
      type: "text/markdown",
    });

    onFilesAdded([file]);
    setTitle("");
    setContent("");
    toast.success(`"${trimmedTitle}" added to upload queue`);
  };

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const disabled = !content.trim();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <label htmlFor="paste-title" style={labelStyle}>
          Document title
        </label>
        <input
          id="paste-title"
          type="text"
          placeholder="e.g. Meeting notes, research summary…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={inputStyle}
        />
      </div>

      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 6,
          }}
        >
          <label htmlFor="paste-content" style={{ ...labelStyle, marginBottom: 0 }}>
            Content
          </label>
          {wordCount > 0 && (
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--ink-3)" }}
            >
              {wordCount} word{wordCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <textarea
          id="paste-content"
          placeholder="Paste your text or markdown content here…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          style={{
            ...inputStyle,
            minHeight: 260,
            resize: "vertical",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, 'JetBrains Mono', monospace",
            fontSize: 13,
            lineHeight: 1.55,
          }}
        />
      </div>

      <button
        onClick={handleAddToQueue}
        disabled={disabled}
        style={{
          width: "100%",
          padding: "12px",
          borderRadius: 10,
          background: disabled ? "var(--line)" : "var(--accent)",
          color: disabled ? "var(--ink-3)" : "white",
          fontSize: 13.5,
          fontWeight: 600,
          border: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          boxShadow: disabled ? "none" : "0 1px 4px var(--accent-glow)",
        }}
      >
        <Plus size={14} />
        Add to upload queue
      </button>
    </div>
  );
}
